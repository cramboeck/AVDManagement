/**
 * Apps-Routen: Intune-Anwendungen, Installationsstatus, Zuweisungen als Jobs
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getAppProvider } from '../services/microsoft-clients.js';
import { getAppInventory, getGroupInventory } from '../services/inventory.js';
import { getJobQueue } from '../services/job-queue.js';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

function notFound(appId: string) {
  return { type: 'https://api.zerostress.io/problems/not-found', title: 'App not found', status: 404, detail: `App '${appId}' not found` };
}

// Bestand mit Zuweisungen und Installationszahlen aus dem Snapshot
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  return c.json(await getAppInventory(tenant));
});

app.get('/:appId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const appId = c.req.param('appId');
  const inventory = await getAppInventory(tenant);
  if (!inventory.available) return c.json(inventory);
  const item = inventory.data.items.find((a) => a.id === appId);
  if (!item) return c.json(notFound(appId), 404);
  return c.json({ available: true, data: item, snapshot: inventory.snapshot });
});

// Installationsstatus je Geraet, live aus dem Intune-Bericht
app.get('/:appId/devices', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const appId = c.req.param('appId');
  return c.json(await getAppProvider().getDeviceStatuses({ tenantId: tenant.id, correlationId: c.req.header('X-Correlation-ID') ?? randomUUID() }, appId));
});

const assignSchema = z.object({
  appName: z.string().min(1),
  intent: z.enum(['required', 'available', 'uninstall', 'availableWithoutEnrollment']),
  targetType: z.enum(['group', 'exclusionGroup', 'allUsers', 'allDevices']),
  groupId: z.string().nullable().optional(),
  filterId: z.string().nullable().optional(),
  filterType: z.enum(['include', 'exclude']).nullable().optional(),
});

app.post('/:appId/assign', requireRole('engineer'), requireConnectedTenant, zValidator('json', assignSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const appId = c.req.param('appId');
  const body = c.req.valid('json');
  if ((body.targetType === 'group' || body.targetType === 'exclusionGroup') && !body.groupId) {
    return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'groupId required', status: 400 }, 400);
  }

  // Gruppenname und Groesse fuer Preview und Audit aus dem Snapshot
  let groupName: string | null = null;
  let groupMemberCount: number | null = null;
  if (body.groupId) {
    const groups = await getGroupInventory(tenant).catch(() => null);
    const group = groups?.available ? groups.data.items.find((g) => g.id === body.groupId) : undefined;
    groupName = group?.displayName ?? null;
    groupMemberCount = group?.memberCount ?? null;
  }

  const job = await getJobQueue().createJob({
    type: 'apps.assign',
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: {
      appId,
      appName: body.appName,
      intent: body.intent,
      targetType: body.targetType,
      groupId: body.groupId ?? null,
      groupName,
      groupMemberCount,
      filterId: body.filterId ?? null,
      filterType: body.filterType ?? null,
      targetKind: 'app',
      targetId: appId,
      targetDisplayName: `${body.appName} -> ${groupName ?? body.targetType} (${body.intent})`,
    },
  });
  return c.json(job, 202);
});

const unassignSchema = z.object({
  appName: z.string().min(1),
  assignmentId: z.string().min(1),
  groupName: z.string().nullable().optional(),
  intent: z.enum(['required', 'available', 'uninstall', 'availableWithoutEnrollment']),
});

app.post('/:appId/unassign', requireRole('engineer'), requireConnectedTenant, zValidator('json', unassignSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const appId = c.req.param('appId');
  const body = c.req.valid('json');
  const job = await getJobQueue().createJob({
    type: 'apps.unassign',
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: {
      appId,
      appName: body.appName,
      assignmentId: body.assignmentId,
      groupName: body.groupName ?? null,
      intent: body.intent,
      targetId: appId,
      targetDisplayName: `${body.appName} -/-> ${body.groupName ?? body.assignmentId}`,
    },
  });
  return c.json(job, 202);
});

const deploymentGroupsSchema = z.object({
  appName: z.string().min(1),
  prefix: z.string().max(30).default(''),
  autoAssign: z.boolean().default(true),
});

app.post('/:appId/deployment-groups', requireRole('engineer'), requireConnectedTenant, zValidator('json', deploymentGroupsSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const appId = c.req.param('appId');
  const body = c.req.valid('json');
  const job = await getJobQueue().createJob({
    type: 'apps.create-deployment-groups',
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: {
      appId,
      appName: body.appName,
      prefix: body.prefix,
      autoAssign: body.autoAssign,
      targetType: 'app',
      targetId: appId,
      targetDisplayName: body.appName,
    },
  });
  return c.json(job, 202);
});

export { app as appsRouter };
