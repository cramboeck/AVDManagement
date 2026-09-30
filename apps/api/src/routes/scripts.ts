/**
 * Skriptbibliothek: Stand der Bibliothek gegen den Tenant
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { getJobQueue } from '../services/job-queue.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getLibraryScript, loadScriptLibrary, toLibraryEntry } from '@zerostress/core';
import { getRemediationProvider } from '../services/microsoft-clients.js';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Die Bibliothek selbst, ohne Tenant-Abgleich (fuer Run Command auf VMs)
app.get('/library', async (c) => {
  return c.json({ items: loadScriptLibrary().map(toLibraryEntry) });
});

// Welche Bibliotheksskripte im Tenant fehlen, veraltet oder aktuell sind
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const status = await getRemediationProvider().getLibraryStatus({
    tenantId: tenant.id,
    correlationId: c.req.header('X-Correlation-ID') ?? randomUUID(),
  });
  return c.json(status);
});

// Geraete-Monitor: Stand der Zuweisung und der Meldungen je Geraet
app.get('/monitor', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const ctx = { tenantId: tenant.id, correlationId: c.req.header('X-Correlation-ID') ?? randomUUID() };
  const provider = getRemediationProvider();
  const schedule = await provider.getScheduleStatus(ctx, 'monitor');
  if (!schedule.tenantScriptId) return c.json({ enabled: false, tenantScriptId: null, devices: 0, reportedLast24h: 0, withIssues: 0 });
  const states = await provider.listRunStates(ctx, schedule.tenantScriptId);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const reportedLast24h = states.filter((s) => (s.state.updatedAt ? Date.parse(s.state.updatedAt) : 0) >= dayAgo).length;
  const withIssues = states.filter((s) => s.state.detectionState === 'fail').length;
  return c.json({ enabled: schedule.hourly && schedule.allDevices, tenantScriptId: schedule.tenantScriptId, devices: states.length, reportedLast24h, withIssues });
});

app.post('/monitor/:action{enable|disable}', requireRole('engineer'), requireConnectedTenant, async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const action = c.req.param('action');
  const job = await getJobQueue().createJob({
    type: action === 'enable' ? 'tenant.monitor-enable' : 'tenant.monitor-disable',
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: { tenantDisplayName: tenant.displayName, reason: null, targetType: 'tenant', targetId: tenant.microsoftTenantId, targetDisplayName: `${tenant.displayName}: Geraete-Monitor ${action === 'enable' ? 'einschalten' : 'ausschalten'}` },
  });
  return c.json(job, 202);
});

// Diagnose: was Intune fuer dieses Skript auf diesem Geraet gerade kennt, ohne zu warten
app.get('/:scriptId/state', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const scriptId = c.req.param('scriptId');
  const managedDeviceId = c.req.query('managedDeviceId');
  const script = getLibraryScript(scriptId);
  if (!script || !managedDeviceId) {
    return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'scriptId and managedDeviceId required', status: 400 }, 400);
  }
  const ctx = { tenantId: tenant.id, correlationId: c.req.header('X-Correlation-ID') ?? randomUUID() };
  const provider = getRemediationProvider();
  const status = await provider.getLibraryStatus(ctx);
  if (!status.available) {
    return c.json(status);
  }
  const tenantScriptId = status.data.find((s) => s.id === script.id)?.tenantScriptId ?? null;
  if (!tenantScriptId) {
    return c.json({ available: true, data: { tenantScriptId: null, state: null } });
  }
  const state = await provider.getRunState(ctx, managedDeviceId, tenantScriptId);
  return c.json({ available: true, data: { tenantScriptId, state } });
});

export { app as scriptsRouter };
