/**
 * Alerts: Auswertung der Anmeldungen aller verbundenen Tenants im
 * Zehn-Minuten-Takt, Ablage je Fingerabdruck, optionale Mail.
 *
 * Kein Job im Sinne des Job-Modells (lesend, kein Ziel im Tenant), aber ein
 * eigener BullMQ-Takt, damit nur eine Instanz auswertet. Die Mail geht ueber
 * Graph sendMail aus dem eigenen Partnertenant; ohne ALERT_MAIL_FROM bleibt
 * es bei der Liste in der Konsole.
 */

import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { evaluateSignIns, GraphClient } from '@zerostress/core';
import type { Alert, AlertStats, AlertStatus, AnomalyFinding, TenantId } from '@zerostress/types';
import { db, alerts, managedTenants } from '../db/index.js';
import { getIdentityProvider, getTokenProvider, rememberMicrosoftTenantId } from './microsoft-clients.js';

const TICK_MS = 10 * 60 * 1000;
// Fenster grosszuegiger als der Takt, damit Nachzuegler von Graph nicht verloren gehen
const WINDOW_MS = 2 * 60 * 60 * 1000;
const SAMPLE = 500;

type AlertRow = typeof alerts.$inferSelect;

export function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    ruleId: row.ruleId as Alert['ruleId'],
    severity: row.severity as Alert['severity'],
    status: row.status as AlertStatus,
    title: row.title,
    summary: row.summary,
    userId: row.userId,
    userPrincipalName: row.userPrincipalName,
    evidence: (row.evidence as Record<string, unknown>) ?? {},
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    occurrences: row.occurrences,
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Befunde ablegen: neue Fingerabdruecke anlegen, bekannte fortschreiben.
 * Rueckgabe: die neu angelegten Alerts (fuer die Benachrichtigung).
 */
export async function storeFindings(mspId: string, tenantId: string, findings: AnomalyFinding[]): Promise<Alert[]> {
  const created: Alert[] = [];
  for (const f of findings) {
    const existing = await db.query.alerts.findFirst({ where: and(eq(alerts.tenantId, tenantId), eq(alerts.fingerprint, f.fingerprint)) });
    if (existing) {
      if (existing.status !== 'resolved') {
        await db
          .update(alerts)
          .set({ lastSeenAt: new Date(f.lastSeenAt), occurrences: Math.max(existing.occurrences, f.occurrences), summary: f.summary, evidence: f.evidence })
          .where(eq(alerts.id, existing.id));
      }
      continue;
    }
    const [row] = await db
      .insert(alerts)
      .values({
        mspId,
        tenantId,
        ruleId: f.ruleId,
        severity: f.severity,
        fingerprint: f.fingerprint,
        title: f.title.slice(0, 255),
        summary: f.summary,
        userId: f.userId,
        userPrincipalName: f.userPrincipalName,
        evidence: f.evidence,
        firstSeenAt: new Date(f.firstSeenAt),
        lastSeenAt: new Date(f.lastSeenAt),
        occurrences: f.occurrences,
      })
      .onConflictDoNothing()
      .returning();
    if (row) created.push(toAlert(row));
  }
  return created;
}

export async function evaluateTenant(target: { id: string; mspId: string; displayName: string }): Promise<Alert[]> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const result = await getIdentityProvider().listSignIns({ tenantId: target.id as TenantId, correlationId: randomUUID() }, { top: SAMPLE, since });
  if (!result.available) return [];
  const findings = evaluateSignIns(result.data);
  const created = await storeFindings(target.mspId, target.id, findings);
  if (created.length > 0) {
    await notify(target.displayName, created).catch((error: Error) => console.error(`Alert mail failed for tenant ${target.id}:`, error.message));
  }
  return created;
}

let mailClient: GraphClient | null = null;

function getMailClient(): GraphClient {
  if (!mailClient) {
    // Mail geht aus dem eigenen Partnertenant, nicht aus dem Kundentenant
    const homeTenant = process.env.ENTRA_TENANT_ID ?? '';
    mailClient = new GraphClient({ getAccessToken: (_tenantId, scopes) => getTokenProvider().getAccessToken(homeTenant, scopes) });
  }
  return mailClient;
}

export function isAlertMailConfigured(): boolean {
  return !!process.env.ALERT_MAIL_FROM && !!process.env.ALERT_MAIL_TO;
}

async function notify(tenantName: string, created: Alert[]): Promise<void> {
  if (!isAlertMailConfigured()) return;
  const from = process.env.ALERT_MAIL_FROM as string;
  const to = (process.env.ALERT_MAIL_TO as string)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3002';
  const lines = created.map((a) => `- [${a.severity.toUpperCase()}] ${a.title}\n  ${a.summary}`).join('\n');
  const body = `Neue Alerts im Tenant ${tenantName}:\n\n${lines}\n\nDetails: ${appUrl}/alerts\n\nDiese Mail enthaelt Kontonamen und ist vertraulich.`;
  await getMailClient().post(
    'home',
    `/users/${encodeURIComponent(from)}/sendMail`,
    ['https://graph.microsoft.com/.default'],
    {
      message: {
        subject: `[ZeroStress] ${created.length} neue Alert(s) in ${tenantName}`,
        body: { contentType: 'Text', content: body },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }
  );
  await db.update(alerts).set({ notifiedAt: new Date() }).where(inArray(alerts.id, created.map((a) => a.id)));
}

export async function listAlerts(tenantId: string, status?: AlertStatus, limit = 200): Promise<Alert[]> {
  const rows = await db.query.alerts.findMany({
    where: status ? and(eq(alerts.tenantId, tenantId), eq(alerts.status, status)) : eq(alerts.tenantId, tenantId),
    orderBy: [desc(alerts.lastSeenAt)],
    limit,
  });
  return rows.map(toAlert);
}

export async function getAlertStats(tenantId: string): Promise<AlertStats> {
  const rows = await db
    .select({ severity: alerts.severity, count: sql<number>`count(*)::int` })
    .from(alerts)
    .where(and(eq(alerts.tenantId, tenantId), eq(alerts.status, 'open')))
    .groupBy(alerts.severity);
  const stats: AlertStats = { open: 0, high: 0, medium: 0, low: 0 };
  for (const r of rows) {
    stats.open += r.count;
    if (r.severity === 'high' || r.severity === 'medium' || r.severity === 'low') stats[r.severity] += r.count;
  }
  return stats;
}

export async function setAlertStatus(tenantId: string, alertId: string, status: AlertStatus, userId: string): Promise<Alert | null> {
  const [row] = await db
    .update(alerts)
    .set({ status, acknowledgedBy: status === 'open' ? null : userId, acknowledgedAt: status === 'open' ? null : new Date() })
    .where(and(eq(alerts.tenantId, tenantId), eq(alerts.id, alertId)))
    .returning();
  return row ? toAlert(row) : null;
}

// ---- Takt ----

let queue: Queue | null = null;
let worker: Worker | null = null;

export async function startAlerting(): Promise<void> {
  if (worker) return;
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  redis.on('error', (error: Error) => console.error('Redis connection error (alerts):', error.message));
  queue = new Queue('alerts', { connection: redis, defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true } });
  worker = new Worker(
    'alerts',
    async () => {
      await runAlertTick();
    },
    { connection: redis, concurrency: 1 }
  );
  worker.on('error', (error: Error) => console.error('Alert worker error:', error.message));
  await queue.upsertJobScheduler('alert-tick', { every: TICK_MS }, { name: 'tick', data: {} });
}

export async function runAlertTick(): Promise<number> {
  const tenants = await db
    .select({ id: managedTenants.id, mspId: managedTenants.mspId, displayName: managedTenants.displayName, microsoftTenantId: managedTenants.microsoftTenantId })
    .from(managedTenants)
    .where(and(eq(managedTenants.isActive, true), eq(managedTenants.connectionStatus, 'connected')));
  let created = 0;
  for (const t of tenants) {
    rememberMicrosoftTenantId(t.id, t.microsoftTenantId);
    try {
      created += (await evaluateTenant(t)).length;
    } catch (error) {
      console.error(`Alert evaluation failed for tenant ${t.id}:`, error instanceof Error ? error.message : String(error));
    }
  }
  return created;
}

export function getAlertingHealth(): { worker: boolean; mail: boolean } {
  return { worker: worker !== null && worker.isRunning(), mail: isAlertMailConfigured() };
}
