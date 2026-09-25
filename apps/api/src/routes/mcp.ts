/**
 * MCP-Server (Model Context Protocol) ueber Streamable HTTP
 *
 * Duenne JSON-RPC-Schicht ueber denselben Diensten wie die Web-Oberflaeche:
 * dieselbe Authentifizierung (Bearer-Token), dieselbe Tenant-Isolation,
 * dieselben Jobs mit Preview und Freigabe, dasselbe Audit. Kein Streaming
 * (GET liefert 405), nur POST mit einer JSON-RPC-Nachricht oder einem Batch.
 * Ohne SDK, damit keine weitere Abhaengigkeit ins Repo kommt.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { getAllRegisteredJobs } from '@zerostress/core';
import type { CorrelationId, JobId, JobStatus, ManagedTenant, TenantId } from '@zerostress/types';
import { db, managedTenants } from '../db/index.js';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { toManagedTenant } from '../services/tenant-mapper.js';
import { rememberMicrosoftTenantId } from '../services/microsoft-clients.js';
import { getDeviceInventory, findDevice, getGroupInventory, getAppInventory, getMailOverview } from '../services/inventory.js';
import { buildSecurityChecks } from '../services/checks.js';
import { listAlerts, getAlertStats } from '../services/alerting.js';
import { getJobQueue } from '../services/job-queue.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'zerostress-cockpit', version: '0.1.0' };

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // readonly: kein Audit noetig; personal: Blick in personenbezogene Daten wird protokolliert
  kind: 'readonly' | 'personal' | 'write';
  run: (auth: AuthContext, args: Record<string, unknown>) => Promise<unknown>;
}

class ToolError extends Error {}

function str(args: Record<string, unknown>, key: string, required = true): string {
  const value = args[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (required) throw new ToolError(`Parameter '${key}' fehlt`);
  return '';
}

async function loadTenant(auth: AuthContext, tenantId: string): Promise<ManagedTenant> {
  const row = await db.query.managedTenants.findFirst({
    where: and(eq(managedTenants.id, tenantId), eq(managedTenants.mspId, auth.mspId), eq(managedTenants.isActive, true)),
  });
  if (!row) throw new ToolError(`Tenant '${tenantId}' nicht gefunden oder kein Zugriff`);
  rememberMicrosoftTenantId(row.id, row.microsoftTenantId);
  const tenant = toManagedTenant(row);
  if (tenant.connectionStatus !== 'connected') throw new ToolError(`Tenant '${tenant.displayName}' ist nicht verbunden (${tenant.connectionStatus})`);
  return tenant;
}

const tenantParam = { tenantId: { type: 'string', description: 'Id des Tenants aus list_tenants' } };

const tools: ToolDefinition[] = [
  {
    name: 'list_tenants',
    description: 'Alle Kundentenants dieser MSP-Organisation mit Verbindungsstatus.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    kind: 'readonly',
    run: async (auth) => {
      const rows = await db.query.managedTenants.findMany({ where: and(eq(managedTenants.mspId, auth.mspId), eq(managedTenants.isActive, true)) });
      return rows.map((r) => ({ id: r.id, displayName: r.displayName, primaryDomain: r.primaryDomain, connectionStatus: r.connectionStatus, lastSyncAt: r.lastSyncAt }));
    },
  },
  {
    name: 'list_devices',
    description: 'Geraetebestand eines Tenants aus Intune und Defender (Snapshot) mit Compliance, Exposure und Risiko.',
    inputSchema: { type: 'object', properties: { ...tenantParam, search: { type: 'string', description: 'Filter auf Name oder Benutzer' } }, required: ['tenantId'], additionalProperties: false },
    kind: 'readonly',
    run: async (auth, args) => {
      const tenant = await loadTenant(auth, str(args, 'tenantId'));
      const inventory = await getDeviceInventory(tenant);
      const q = str(args, 'search', false).toLowerCase();
      const items = inventory.items.filter((d) => !q || d.name.toLowerCase().includes(q) || (d.primaryUser ?? '').toLowerCase().includes(q));
      return {
        snapshot: inventory.snapshot,
        intune: inventory.intune,
        defender: inventory.defender,
        count: items.length,
        items: items.slice(0, 200).map((d) => ({
          id: d.id,
          name: d.name,
          os: [d.operatingSystem, d.osVersion].filter(Boolean).join(' '),
          primaryUser: d.primaryUser,
          lastActivityAt: d.lastActivityAt,
          compliance: d.intune?.complianceState ?? null,
          exposure: d.defender?.exposureLevel ?? null,
          risk: d.defender?.riskScore ?? null,
        })),
      };
    },
  },
  {
    name: 'get_device',
    description: 'Ein Geraet mit allen Intune- und Defender-Feldern.',
    inputSchema: { type: 'object', properties: { ...tenantParam, deviceId: { type: 'string' } }, required: ['tenantId', 'deviceId'], additionalProperties: false },
    kind: 'readonly',
    run: async (auth, args) => {
      const tenant = await loadTenant(auth, str(args, 'tenantId'));
      const device = await findDevice(tenant, str(args, 'deviceId'));
      if (!device) throw new ToolError('Geraet nicht gefunden');
      return device;
    },
  },
  {
    name: 'list_groups',
    description: 'Gruppen eines Tenants mit Auffaelligkeiten (ohne Besitzer, oeffentliches Team, Gaeste).',
    inputSchema: { type: 'object', properties: { ...tenantParam, flag: { type: 'string', enum: ['ownerless', 'single-owner', 'public-team', 'has-guests', 'dynamic', 'empty'] } }, required: ['tenantId'], additionalProperties: false },
    kind: 'readonly',
    run: async (auth, args) => {
      const tenant = await loadTenant(auth, str(args, 'tenantId'));
      const groups = await getGroupInventory(tenant);
      if (!groups.available) return groups;
      const flag = str(args, 'flag', false);
      const items = groups.data.items.filter((g) => !flag || g.flags.includes(flag as (typeof g.flags)[number]));
      return { stats: groups.data.stats, count: items.length, items: items.slice(0, 300) };
    },
  },
  {
    name: 'list_apps',
    description: 'Intune-Apps eines Tenants mit Zuweisungen und Installationszahlen.',
    inputSchema: { type: 'object', properties: tenantParam, required: ['tenantId'], additionalProperties: false },
    kind: 'readonly',
    run: async (auth, args) => getAppInventory(await loadTenant(auth, str(args, 'tenantId'))),
  },
  {
    name: 'security_checks',
    description: 'Best-Practice-Checks eines Tenants (MFA, Legacy-Auth, Gaeste, Admins, SPF/DKIM/DMARC) mit Befund und Empfehlung.',
    inputSchema: { type: 'object', properties: tenantParam, required: ['tenantId'], additionalProperties: false },
    kind: 'readonly',
    run: async (auth, args) => buildSecurityChecks(await loadTenant(auth, str(args, 'tenantId'))),
  },
  {
    name: 'list_alerts',
    description: 'Alerts aus dem Anmelde-Regelwerk eines Tenants.',
    inputSchema: { type: 'object', properties: { ...tenantParam, status: { type: 'string', enum: ['open', 'acknowledged', 'resolved'] } }, required: ['tenantId'], additionalProperties: false },
    kind: 'personal',
    run: async (auth, args) => {
      const tenant = await loadTenant(auth, str(args, 'tenantId'));
      const status = str(args, 'status', false);
      return { stats: await getAlertStats(tenant.id), items: await listAlerts(tenant.id, status === 'open' || status === 'acknowledged' || status === 'resolved' ? status : undefined) };
    },
  },
  {
    name: 'mailbox_usage',
    description: 'Exchange-Postfaecher mit Groesse, Kontingent und Aktivitaet (personenbezogen, Abruf wird protokolliert).',
    inputSchema: { type: 'object', properties: { ...tenantParam, top: { type: 'number', description: 'Anzahl groesster Postfaecher, Standard 50' } }, required: ['tenantId'], additionalProperties: false },
    kind: 'personal',
    run: async (auth, args) => {
      const tenant = await loadTenant(auth, str(args, 'tenantId'));
      const overview = await getMailOverview(tenant);
      if (!overview.available) return overview;
      const top = typeof args.top === 'number' ? Math.max(1, Math.min(500, args.top)) : 50;
      return { snapshot: overview.snapshot, totals: overview.data.totals, refreshedAt: overview.data.refreshedAt, mailboxes: overview.data.mailboxes.slice(0, top) };
    },
  },
  {
    name: 'list_jobs',
    description: 'Jobs eines Tenants (Status, Typ, Ergebnis).',
    inputSchema: { type: 'object', properties: { ...tenantParam, status: { type: 'string', enum: ['pending_approval', 'queued', 'running', 'completed', 'failed', 'cancelled'] } }, required: ['tenantId'], additionalProperties: false },
    kind: 'readonly',
    run: async (auth, args) => {
      const tenant = await loadTenant(auth, str(args, 'tenantId'));
      const status = str(args, 'status', false);
      return getJobQueue().listJobs(tenant.id, { limit: 50, status: status ? (status as JobStatus) : undefined });
    },
  },
  {
    name: 'list_job_types',
    description: 'Verfuegbare Job-Typen (schreibende Aktionen) mit Anzeigenamen; jeder Job braucht eine Freigabe nach Preview.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    kind: 'readonly',
    run: async () => getAllRegisteredJobs().map((j) => ({ type: j.definition.type, displayName: j.definition.displayName, requiresPreview: j.definition.requiresPreview })),
  },
  {
    name: 'create_job',
    description:
      'Schreibende Aktion als Job anlegen. Der Job wird NICHT ausgefuehrt, sondern liefert eine Preview (was passiert mit welchen Objekten). Ausfuehrung erst nach approve_job. Payload wie in der Web-API der jeweiligen Aktion (z. B. device.sync: managedDeviceId, deviceName).',
    inputSchema: {
      type: 'object',
      properties: { ...tenantParam, type: { type: 'string', description: 'Job-Typ aus list_job_types' }, payload: { type: 'object', description: 'Nutzlast des Jobs' } },
      required: ['tenantId', 'type', 'payload'],
      additionalProperties: false,
    },
    kind: 'write',
    run: async (auth, args) => {
      if (auth.user.role === 'readonly') throw new ToolError('Rolle Engineer erforderlich');
      const tenant = await loadTenant(auth, str(args, 'tenantId'));
      const type = str(args, 'type');
      if (!getAllRegisteredJobs().some((j) => j.definition.type === type)) throw new ToolError(`Unbekannter Job-Typ '${type}'`);
      const payload = args.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ToolError("Parameter 'payload' muss ein Objekt sein");
      const job = await getJobQueue().createJob({
        type,
        tenantId: tenant.id,
        mspId: auth.mspId,
        userId: auth.user.id,
        userEmail: auth.user.email,
        payload: { ...(payload as Record<string, unknown>), source: 'mcp' },
      });
      return { job, next: job.status === 'pending_approval' ? 'Preview pruefen, dann approve_job mit dieser jobId aufrufen' : 'Job laeuft' };
    },
  },
  {
    name: 'approve_job',
    description: 'Job nach Preview freigeben; erst dann wird geschrieben. Rolle Engineer.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
    kind: 'write',
    run: async (auth, args) => {
      if (auth.user.role === 'readonly') throw new ToolError('Rolle Engineer erforderlich');
      const jobId = str(args, 'jobId') as JobId;
      const job = await getJobQueue().getJob(jobId);
      if (!job || job.mspId !== auth.mspId) throw new ToolError('Job nicht gefunden');
      return getJobQueue().approveJob(jobId, auth.user.id);
    },
  },
  {
    name: 'get_job',
    description: 'Job mit Status, Preview und Ergebnis lesen.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
    kind: 'readonly',
    run: async (auth, args) => {
      const job = await getJobQueue().getJob(str(args, 'jobId') as JobId);
      if (!job || job.mspId !== auth.mspId) throw new ToolError('Job nicht gefunden');
      return job;
    },
  },
];

function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function handle(auth: AuthContext, req: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  if (req.method === 'notifications/initialized' || req.method.startsWith('notifications/')) return null;
  switch (req.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id: req.id ?? null, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO } };
    case 'ping':
      return { jsonrpc: '2.0', id: req.id ?? null, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id: req.id ?? null, result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } };
    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : '';
      const tool = tools.find((t) => t.name === name);
      if (!tool) return rpcError(req.id, -32602, `Unbekanntes Tool '${name}'`);
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const correlationId = randomUUID() as CorrelationId;
      try {
        const result = await tool.run(auth, args);
        if (tool.kind !== 'readonly') {
          await audit.log({
            mspId: auth.mspId,
            tenantId: (typeof args.tenantId === 'string' ? args.tenantId : null) as TenantId | null,
            userId: auth.user.id,
            action: `mcp.${tool.name}`,
            targetType: 'mcp-tool',
            targetId: tool.name,
            targetDisplayName: tool.name,
            afterState: tool.kind === 'write' ? { args } : undefined,
            result: 'success',
            correlationId,
          });
        }
        return { jsonrpc: '2.0', id: req.id ?? null, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (tool.kind !== 'readonly') {
          await audit.log({
            mspId: auth.mspId,
            tenantId: (typeof args.tenantId === 'string' ? args.tenantId : null) as TenantId | null,
            userId: auth.user.id,
            action: `mcp.${tool.name}`,
            targetType: 'mcp-tool',
            targetId: tool.name,
            targetDisplayName: tool.name,
            result: 'failure',
            errorMessage: message,
            correlationId,
          });
        }
        return { jsonrpc: '2.0', id: req.id ?? null, result: { content: [{ type: 'text', text: message }], isError: true } };
      }
    }
    default:
      return rpcError(req.id, -32601, `Methode '${req.method}' nicht unterstuetzt`);
  }
}

app.get('/', (c) => c.json({ error: 'Streamable HTTP ohne Server-Streaming: bitte POST verwenden' }, 405));

app.post('/', async (c) => {
  const auth = c.get('auth');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(rpcError(null, -32700, 'Ungueltiges JSON'), 400);
  }
  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcRequest[];
  const responses: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      responses.push(rpcError(null, -32600, 'Ungueltige JSON-RPC-Nachricht'));
      continue;
    }
    const response = await handle(auth, message);
    if (response) responses.push(response);
  }
  if (responses.length === 0) return c.body(null, 202);
  return c.json(Array.isArray(body) ? responses : responses[0]);
});

export { app as mcpRouter };
