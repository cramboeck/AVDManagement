/**
 * Azure-VMs: Bestand, Detail, Aktionen als Jobs, Bereitstellung aus Vorlagen
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { loadVmTemplates, toTemplateSummary } from '@zerostress/core';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getVmProvider } from '../services/microsoft-clients.js';
import { getJobQueue } from '../services/job-queue.js';
import { estimateVmCost } from '../services/azure-prices.js';
import type { TenantId } from '@zerostress/types';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

const SUBSCRIPTION = z.string().regex(/^[0-9a-fA-F-]{36}$/);
const LOCATION = z.string().regex(/^[a-z0-9]{3,30}$/);
const VM_ID = z.string().regex(/^\/subscriptions\/[0-9a-fA-F-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Compute\/virtualMachines\/[^/]+$/i);

function ctxFor(tenantId: TenantId, header: string | undefined) {
  return { tenantId, correlationId: header ?? randomUUID() };
}

function toArmResourceId(param: string): string {
  return '/' + param.replace(/^\/+/, '');
}

app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const result = await getVmProvider().listVms(ctxFor(tenant.id, c.req.header('X-Correlation-ID')));
  return c.json({ ...result, generatedAt: new Date().toISOString() });
});

// ---- Metadaten fuer Formulare (vor /:resourceId, damit die Pfade nicht als Id gelesen werden) ----

app.get('/meta/templates', (c) => c.json({ items: loadVmTemplates().map(toTemplateSummary) }));

app.get('/meta/subscriptions', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  return c.json({ items: await getVmProvider().listSubscriptions(ctxFor(tenant.id, c.req.header('X-Correlation-ID'))) });
});

app.get('/meta/resource-groups', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const sub = SUBSCRIPTION.safeParse(c.req.query('subscriptionId'));
  if (!sub.success) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'subscriptionId fehlt', status: 400 }, 400);
  return c.json({ items: await getVmProvider().listResourceGroups(ctxFor(tenant.id, c.req.header('X-Correlation-ID')), sub.data) });
});

app.get('/meta/subnets', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const sub = SUBSCRIPTION.safeParse(c.req.query('subscriptionId'));
  if (!sub.success) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'subscriptionId fehlt', status: 400 }, 400);
  return c.json({ items: await getVmProvider().listSubnets(ctxFor(tenant.id, c.req.header('X-Correlation-ID')), sub.data) });
});

app.get('/meta/sizes', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const sub = SUBSCRIPTION.safeParse(c.req.query('subscriptionId'));
  const loc = LOCATION.safeParse(c.req.query('location'));
  if (!sub.success || !loc.success) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'subscriptionId und location noetig', status: 400 }, 400);
  return c.json({ items: await getVmProvider().listSizes(ctxFor(tenant.id, c.req.header('X-Correlation-ID')), sub.data, loc.data) });
});

app.get('/meta/cost', async (c) => {
  const size = c.req.query('vmSize') ?? '';
  const loc = c.req.query('location') ?? '';
  const os = c.req.query('osType') === 'Linux' ? 'Linux' : 'Windows';
  return c.json({ estimate: await estimateVmCost(size, loc, os) });
});

// ---- Aktionen als Jobs ----

const actionSchema = z.object({ vmResourceId: VM_ID, vmName: z.string().min(1).max(64) });
const resizeSchema = actionSchema.extend({ vmSize: z.string().regex(/^[A-Za-z0-9_]{3,40}$/) });
const deploySchema = z.object({
  templateId: z.string().regex(/^[a-z0-9-]{3,40}$/),
  subscriptionId: SUBSCRIPTION,
  subscriptionName: z.string().max(200).default(''),
  resourceGroup: z.string().regex(/^[A-Za-z0-9._()-]{1,90}$/),
  location: LOCATION,
  parameters: z.record(z.unknown()).default({}),
});

const actionTypes: Record<string, string> = { start: 'vm.start', stop: 'vm.stop', restart: 'vm.restart' };

app.post('/actions/:action{start|stop|restart}', requireRole('engineer'), requireConnectedTenant, zValidator('json', actionSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const body = c.req.valid('json');
  const job = await getJobQueue().createJob({
    type: actionTypes[c.req.param('action')],
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: { ...body, targetType: 'vm', targetId: body.vmResourceId, targetDisplayName: body.vmName },
  });
  return c.json(job, 202);
});

app.post('/actions/resize', requireRole('engineer'), requireConnectedTenant, zValidator('json', resizeSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const body = c.req.valid('json');
  const job = await getJobQueue().createJob({
    type: 'vm.resize',
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: { ...body, targetType: 'vm', targetId: body.vmResourceId, targetDisplayName: `${body.vmName} -> ${body.vmSize}` },
  });
  return c.json(job, 202);
});

app.post('/actions/deploy', requireRole('engineer'), requireConnectedTenant, zValidator('json', deploySchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const body = c.req.valid('json');
  const vmName = typeof body.parameters.vmName === 'string' ? body.parameters.vmName : 'VM';
  const job = await getJobQueue().createJob({
    type: 'vm.deploy',
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: { ...body, targetType: 'vm', targetId: `${body.resourceGroup}/${vmName}`, targetDisplayName: `${vmName} aus ${body.templateId}` },
  });
  return c.json(job, 202);
});

app.get('/:resourceId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const id = toArmResourceId(c.req.param('resourceId'));
  if (!VM_ID.safeParse(id).success) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'Keine VM-Ressourcen-Id', status: 400 }, 400);
  const vm = await getVmProvider().getVm(ctxFor(tenant.id, c.req.header('X-Correlation-ID')), id);
  if (!vm) return c.json({ type: 'https://api.zerostress.io/problems/not-found', title: 'VM not found', status: 404 }, 404);
  return c.json(vm);
});

export { app as vmsRouter };
