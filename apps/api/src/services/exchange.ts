/**
 * Auftraege fuer den Exchange-Worker und die von ihm gesammelten Postfachdaten
 *
 * Die API spricht nie selbst mit Exchange-PowerShell. Sie legt Auftraege
 * an, der Worker holt sie mit seiner eigenen Identitaet (Zertifikat bleibt
 * beim Worker) und meldet Ergebnis und Protokoll zurueck.
 */

import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { ExchangeOperations } from '@zerostress/core';
import type { ExchangeFacts, ExchangeJobRecord, ExchangeJobStatus, ExchangeMailboxFacts, ExchangeOperation, ExchangeWorkerClaim, MailboxExchangeInfo, TenantId } from '@zerostress/types';
import { db, exchangeJobs, exchangeFacts, managedTenants } from '../db/index.js';
import { getMailboxProvider } from './microsoft-clients.js';

type Row = typeof exchangeJobs.$inferSelect;

export const STALE_EXCHANGE_JOB_MS = 60 * 60 * 1000;
const POLL_MS = 3000;
const MAX_LOG_CHARS = 200_000;
const OPERATIONS: ExchangeOperation[] = ['collect-facts', 'set-quota', 'set-forwarding', 'set-full-access', 'set-send-as', 'enable-archive', 'convert-mailbox', 'set-litigation-hold'];

function toRecord(row: Row): ExchangeJobRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operation: row.operation as ExchangeOperation,
    parameters: row.parameters as Record<string, unknown>,
    status: row.status as ExchangeJobStatus,
    workerId: row.workerId,
    log: row.log,
    error: row.error,
    result: (row.result as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function enqueueExchangeJob(input: { mspId: string; tenantId: string; userId: string; jobId: string | null; operation: ExchangeOperation; parameters: Record<string, unknown> }): Promise<string> {
  if (!OPERATIONS.includes(input.operation)) throw new Error(`Unbekannte Operation ${input.operation}`);
  const [row] = await db
    .insert(exchangeJobs)
    .values({ mspId: input.mspId, tenantId: input.tenantId, operation: input.operation, parameters: input.parameters, status: 'queued', jobId: input.jobId, createdBy: input.userId })
    .returning({ id: exchangeJobs.id });
  return row.id;
}

export async function getExchangeJob(id: string): Promise<ExchangeJobRecord | null> {
  const row = await db.query.exchangeJobs.findFirst({ where: eq(exchangeJobs.id, id) });
  return row ? toRecord(row) : null;
}

export async function listExchangeJobs(tenantId: string, limit = 20): Promise<ExchangeJobRecord[]> {
  const rows = await db.select().from(exchangeJobs).where(eq(exchangeJobs.tenantId, tenantId)).orderBy(desc(exchangeJobs.createdAt)).limit(limit);
  return rows.map(toRecord);
}

/** Auf Abschluss warten; null bei Zeitueberschreitung (Auftrag bleibt bestehen). */
export async function waitForExchangeJob(id: string, timeoutMs: number, pollMs = POLL_MS): Promise<ExchangeJobRecord | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await getExchangeJob(id);
    if (!record) return null;
    if (record.status === 'succeeded' || record.status === 'failed') return record;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

export async function expireStaleExchangeJobs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_EXCHANGE_JOB_MS);
  const rows = await db
    .update(exchangeJobs)
    .set({ status: 'failed', finishedAt: now, error: 'Worker hat sich nicht mehr gemeldet' })
    .where(and(inArray(exchangeJobs.status, ['claimed', 'running']), lt(exchangeJobs.claimedAt, cutoff)))
    .returning({ id: exchangeJobs.id });
  return rows.length;
}

/** Aeltesten wartenden Auftrag atomar dem Worker zuweisen. */
export async function claimExchangeJob(workerId: string): Promise<ExchangeWorkerClaim | null> {
  await expireStaleExchangeJobs();
  const claimed = (await db.execute(sql`
    update exchange_jobs
    set status = 'claimed', worker_id = ${workerId}, claimed_at = now()
    where id = (
      select id from exchange_jobs
      where status = 'queued'
      order by created_at
      limit 1
      for update skip locked
    )
    returning id, tenant_id, operation, parameters
  `)) as unknown as Array<{ id: string; tenant_id: string; operation: string; parameters: Record<string, unknown> }>;
  const row = claimed[0];
  if (!row) return null;
  const tenant = await db.query.managedTenants.findFirst({ where: eq(managedTenants.id, row.tenant_id) });
  if (!tenant) {
    await finishExchangeJob(row.id, workerId, { success: false, log: '', error: 'Tenant nicht mehr vorhanden', result: null });
    return null;
  }
  const initial = await getMailboxProvider().getInitialDomain({ tenantId: tenant.id as TenantId, correlationId: `exchange-${row.id}` });
  const organization = initial ?? (tenant.primaryDomain.endsWith('.onmicrosoft.com') ? tenant.primaryDomain : tenant.microsoftTenantId);
  await db.update(exchangeJobs).set({ status: 'running' }).where(eq(exchangeJobs.id, row.id));
  return { jobId: row.id, tenantId: tenant.id, microsoftTenantId: tenant.microsoftTenantId, organization, operation: row.operation as ExchangeOperation, parameters: row.parameters };
}

export async function getOwnedExchangeJob(id: string, workerId: string): Promise<Row | null> {
  const row = await db.query.exchangeJobs.findFirst({ where: and(eq(exchangeJobs.id, id), eq(exchangeJobs.workerId, workerId), inArray(exchangeJobs.status, ['claimed', 'running'])) });
  return row ?? null;
}

export async function appendExchangeLog(id: string, workerId: string, line: string): Promise<boolean> {
  const row = await getOwnedExchangeJob(id, workerId);
  if (!row) return false;
  const next = `${row.log ?? ''}${row.log ? '\n' : ''}[${new Date().toISOString()}] ${line.slice(0, 2000)}`.slice(-MAX_LOG_CHARS);
  await db.update(exchangeJobs).set({ log: next, claimedAt: new Date() }).where(eq(exchangeJobs.id, id));
  return true;
}

/**
 * Abschluss vom Worker. Bei collect-facts wandern die Postfachdaten in
 * exchange_facts; im Auftrag bleibt nur die Anzahl.
 */
export async function finishExchangeJob(id: string, workerId: string, input: { success: boolean; log: string; error: string | null; result: Record<string, unknown> | null }): Promise<boolean> {
  const row = await getOwnedExchangeJob(id, workerId);
  if (!row) return false;
  const now = new Date();
  let result = input.result;
  if (input.success && row.operation === 'collect-facts') {
    const facts = normalizeFacts(input.result, workerId, now);
    if (!facts) {
      input = { ...input, success: false, error: 'Worker lieferte keine verwertbaren Postfachdaten' };
    } else {
      await db
        .insert(exchangeFacts)
        .values({ tenantId: row.tenantId, payload: facts, collectedAt: now, workerId })
        .onConflictDoUpdate({ target: exchangeFacts.tenantId, set: { payload: facts, collectedAt: now, workerId } });
      result = { mailboxes: facts.mailboxes.length, autoForwardingMode: facts.autoForwardingMode };
    }
  }
  const mergedLog = [row.log, input.log].filter((s) => s && s.trim()).join('\n').slice(-MAX_LOG_CHARS) || null;
  await db
    .update(exchangeJobs)
    .set({ status: input.success ? 'succeeded' : 'failed', finishedAt: now, log: mergedLog, error: input.success ? null : (input.error ?? 'Fehler ohne Meldung'), result })
    .where(eq(exchangeJobs.id, id));
  return true;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().toLowerCase()) : [];
}

export function normalizeFacts(raw: Record<string, unknown> | null, workerId: string, now: Date): ExchangeFacts | null {
  if (!raw || !Array.isArray(raw.mailboxes)) return null;
  const mailboxes: ExchangeMailboxFacts[] = [];
  for (const m of raw.mailboxes as Array<Record<string, unknown>>) {
    const upn = str(m.userPrincipalName)?.toLowerCase();
    if (!upn) continue;
    mailboxes.push({
      userPrincipalName: upn,
      displayName: str(m.displayName) ?? upn,
      primarySmtpAddress: str(m.primarySmtpAddress)?.toLowerCase() ?? upn,
      recipientTypeDetails: str(m.recipientTypeDetails) ?? 'unknown',
      forwardingSmtpAddress: str(m.forwardingSmtpAddress)?.replace(/^smtp:/i, '').toLowerCase() ?? null,
      forwardingAddress: str(m.forwardingAddress),
      deliverToMailboxAndForward: m.deliverToMailboxAndForward === true,
      issueWarningQuota: str(m.issueWarningQuota),
      prohibitSendQuota: str(m.prohibitSendQuota),
      prohibitSendReceiveQuota: str(m.prohibitSendReceiveQuota),
      archiveStatus: str(m.archiveStatus),
      litigationHoldEnabled: m.litigationHoldEnabled === true,
      litigationHoldDuration: str(m.litigationHoldDuration),
      retentionPolicy: str(m.retentionPolicy),
      hiddenFromAddressLists: m.hiddenFromAddressLists === true,
      auditEnabled: typeof m.auditEnabled === 'boolean' ? m.auditEnabled : null,
      fullAccess: list(m.fullAccess),
      sendAs: list(m.sendAs),
      sendOnBehalf: list(m.sendOnBehalf),
    });
  }
  return { collectedAt: now.toISOString(), workerId, autoForwardingMode: str(raw.autoForwardingMode), mailboxes };
}

export async function getExchangeFacts(tenantId: string): Promise<ExchangeFacts | null> {
  const row = await db.query.exchangeFacts.findFirst({ where: eq(exchangeFacts.tenantId, tenantId) });
  return row ? (row.payload as ExchangeFacts) : null;
}

export async function mailboxExchangeInfo(tenantId: string, upn: string): Promise<MailboxExchangeInfo> {
  const facts = await getExchangeFacts(tenantId);
  if (!facts) return { collectedAt: null, autoForwardingMode: null, facts: null };
  const lower = upn.toLowerCase();
  return { collectedAt: facts.collectedAt, autoForwardingMode: facts.autoForwardingMode, facts: facts.mailboxes.find((m) => m.userPrincipalName === lower || m.primarySmtpAddress === lower) ?? null };
}

export const exchangeOperations: ExchangeOperations = {
  enqueue: (input) => enqueueExchangeJob(input),
  wait: (id, timeoutMs) => waitForExchangeJob(id, timeoutMs),
  factsFor: (tenantId, upn) => mailboxExchangeInfo(tenantId, upn),
  tenantDomains: (tenantId) => getMailboxProvider().getTenantDomains({ tenantId: tenantId as TenantId, correlationId: `exchange-preview-${tenantId}` }, []),
};
