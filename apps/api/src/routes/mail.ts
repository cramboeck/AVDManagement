/**
 * Exchange Online: Postfaecher und Mailaktivitaet aus den Graph-Berichten,
 * Postfachdetail und Regeln live, Aenderungen als Jobs
 */

import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getMailOverview } from '../services/inventory.js';
import { getMailboxDetail, scanForwarding } from '../services/mailboxes.js';
import { getExchangeFacts, listExchangeJobs } from '../services/exchange.js';
import { workerTokenConfigured } from '../services/builds.js';
import { getJobQueue } from '../services/job-queue.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

const UPN = /^[^\s@\/\\]{1,64}@[A-Za-z0-9.-]{1,255}$/;

// Postfachliste ist personenbezogen (wer wie viel Mail), daher jeder Abruf im Audit
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const overview = await getMailOverview(tenant);

  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'mail.usage.view',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    result: overview.available ? 'success' : 'failure',
    errorMessage: overview.available ? undefined : overview.reason,
    correlationId: (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId,
  });

  return c.json(overview);
});

// Weiterleitungs-Scan ueber alle Postfaecher (Posteingangsregeln mit Weiterleitung/Umleitung)
app.get('/forwarding-scan', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const correlationId = (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId;
  const scan = await scanForwarding(tenant, correlationId);
  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'mail.forwarding.scan',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    afterState: scan.available ? { scanned: scan.data.scannedMailboxes, findings: scan.data.findings.length, external: scan.data.externalCount } : undefined,
    result: scan.available ? 'success' : 'failure',
    errorMessage: scan.available ? undefined : scan.reason,
    correlationId,
  });
  return c.json(scan);
});

// Postfachdetail: Einstellungen und Regeln live; Inhalt ist personenbezogen, daher Audit
app.get('/mailboxes/:upn', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const upn = c.req.param('upn');
  if (!UPN.test(upn)) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'UPN ungueltig', status: 400 }, 400);
  const correlationId = (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId;
  const detail = await getMailboxDetail(tenant, upn, correlationId);
  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'mail.mailbox.view',
    targetType: 'mailbox',
    targetId: upn,
    targetDisplayName: detail?.displayName ?? upn,
    result: detail ? 'success' : 'failure',
    errorMessage: detail ? undefined : 'not found',
    correlationId,
  });
  if (!detail) return c.json({ type: 'https://api.zerostress.io/problems/not-found', title: 'Mailbox not found', status: 404 }, 404);
  return c.json(detail);
});

// Aenderungen: Jobs mit Vorschau und Freigabe
const autoReplySchema = z.object({
  displayName: z.string().min(1).max(200),
  status: z.enum(['disabled', 'alwaysEnabled', 'scheduled']),
  externalAudience: z.enum(['none', 'contactsOnly', 'all']).default('none'),
  scheduledStart: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).nullable().default(null),
  scheduledEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).nullable().default(null),
  internalMessage: z.string().max(8000).default(''),
  externalMessage: z.string().max(8000).default(''),
  timeZone: z.string().min(1).max(100).default('W. Europe Standard Time'),
});

const forwardRuleSchema = z.object({
  displayName: z.string().min(1).max(200),
  ruleName: z.string().min(1).max(100),
  addresses: z.array(z.string().email()).min(1).max(10),
  keepCopy: z.boolean().default(true),
});

const ruleSchema = z.object({ displayName: z.string().min(1).max(200), ruleName: z.string().min(1).max(200) });

async function createMailboxJob(c: Context, type: string, upn: string, payload: Record<string, unknown>, targetDisplayName: string) {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const job = await getJobQueue().createJob({
    type,
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: { ...payload, userPrincipalName: upn, targetType: 'mailbox', targetId: upn, targetDisplayName },
  });
  return c.json(job, 202);
}

app.post('/mailboxes/:upn/auto-reply', requireRole('engineer'), requireConnectedTenant, zValidator('json', autoReplySchema), async (c) => {
  const upn = c.req.param('upn');
  if (!UPN.test(upn)) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'UPN ungueltig', status: 400 }, 400);
  const body = c.req.valid('json');
  return createMailboxJob(c, 'mailbox.set-auto-reply', upn, body, `${body.displayName}: Abwesenheit ${body.status === 'disabled' ? 'aus' : 'an'}`);
});

app.post('/mailboxes/:upn/rules', requireRole('engineer'), requireConnectedTenant, zValidator('json', forwardRuleSchema), async (c) => {
  const upn = c.req.param('upn');
  if (!UPN.test(upn)) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'UPN ungueltig', status: 400 }, 400);
  const body = c.req.valid('json');
  return createMailboxJob(c, 'mailbox.create-forward-rule', upn, body, `${body.displayName}: Weiterleitung an ${body.addresses.join(', ')}`);
});

const ruleActions: Record<string, string> = { enable: 'mailbox.enable-rule', disable: 'mailbox.disable-rule', delete: 'mailbox.delete-rule' };

app.post('/mailboxes/:upn/rules/:ruleId/:action{enable|disable|delete}', requireRole('engineer'), requireConnectedTenant, zValidator('json', ruleSchema), async (c) => {
  const upn = c.req.param('upn');
  if (!UPN.test(upn)) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'UPN ungueltig', status: 400 }, 400);
  const body = c.req.valid('json');
  const ruleId = c.req.param('ruleId');
  return createMailboxJob(c, ruleActions[c.req.param('action')], upn, { ...body, ruleId }, `${body.displayName}: Regel ${body.ruleName}`);
});

// ---- Exchange-Worker: Datenstand, Sammeln, Aenderungen auf Postfachebene ----

app.get('/exchange', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const facts = await getExchangeFacts(tenant.id);
  const jobs = await listExchangeJobs(tenant.id, 10);
  return c.json({
    workerConfigured: workerTokenConfigured(),
    collectedAt: facts?.collectedAt ?? null,
    workerId: facts?.workerId ?? null,
    mailboxes: facts?.mailboxes.length ?? 0,
    autoForwardingMode: facts?.autoForwardingMode ?? null,
    mailboxForwarders: facts ? facts.mailboxes.filter((m) => m.forwardingSmtpAddress || m.forwardingAddress).map((m) => ({ userPrincipalName: m.userPrincipalName, displayName: m.displayName, target: m.forwardingSmtpAddress ?? m.forwardingAddress, keepCopy: m.deliverToMailboxAndForward })) : [],
    recentJobs: jobs,
  });
});

app.post('/exchange/collect', requireRole('engineer'), requireConnectedTenant, async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const job = await getJobQueue().createJob({
    type: 'exchange.collect-facts',
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: { targetType: 'tenant', targetId: tenant.microsoftTenantId, targetDisplayName: `${tenant.displayName}: Exchange-Postfachdaten sammeln` },
  });
  return c.json(job, 202);
});

const exchangeBase = { displayName: z.string().min(1).max(200), reason: z.string().trim().max(500).nullable().default(null) };
const exchangeSchemas: Record<string, { type: string; schema: z.ZodTypeAny; label: (b: Record<string, unknown>) => string }> = {
  quota: { type: 'mailbox.set-quota', schema: z.object({ ...exchangeBase, issueWarningGb: z.number(), prohibitSendGb: z.number(), prohibitSendReceiveGb: z.number() }), label: (b) => `Kontingent ${String(b.prohibitSendGb)} GB` },
  forwarding: { type: 'mailbox.set-forwarding', schema: z.object({ ...exchangeBase, forwardingSmtpAddress: z.string().email().nullable(), deliverToMailboxAndForward: z.boolean().default(true) }), label: (b) => (b.forwardingSmtpAddress ? `Weiterleitung an ${String(b.forwardingSmtpAddress)}` : 'Weiterleitung entfernen') },
  'full-access': { type: 'mailbox.set-full-access', schema: z.object({ ...exchangeBase, trustee: z.string().email(), grant: z.boolean(), autoMapping: z.boolean().default(true) }), label: (b) => `Vollzugriff ${b.grant ? 'fuer' : 'entziehen'} ${String(b.trustee)}` },
  'send-as': { type: 'mailbox.set-send-as', schema: z.object({ ...exchangeBase, trustee: z.string().email(), grant: z.boolean() }), label: (b) => `Senden als ${b.grant ? 'fuer' : 'entziehen'} ${String(b.trustee)}` },
  archive: { type: 'mailbox.enable-archive', schema: z.object({ ...exchangeBase }), label: () => 'Archiv aktivieren' },
  convert: { type: 'mailbox.convert', schema: z.object({ ...exchangeBase, toShared: z.boolean() }), label: (b) => (b.toShared ? 'In freigegebenes Postfach umwandeln' : 'In Benutzerpostfach umwandeln') },
  hold: { type: 'mailbox.set-litigation-hold', schema: z.object({ ...exchangeBase, enabled: z.boolean(), durationDays: z.number().int().nullable().default(null) }), label: (b) => (b.enabled ? 'Beweissicherung aktivieren' : 'Beweissicherung aufheben') },
};

app.post('/mailboxes/:upn/exchange/:action{quota|forwarding|full-access|send-as|archive|convert|hold}', requireRole('engineer'), requireConnectedTenant, async (c) => {
  const upn = c.req.param('upn');
  if (!UPN.test(upn)) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'UPN ungueltig', status: 400 }, 400);
  const def = exchangeSchemas[c.req.param('action')];
  const parsed = def.schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'Eingabe ungueltig', status: 400, detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  const body = parsed.data as Record<string, unknown> & { displayName: string };
  return createMailboxJob(c, def.type, upn, body, `${body.displayName}: ${def.label(body)}`);
});

export { app as mailRouter };
