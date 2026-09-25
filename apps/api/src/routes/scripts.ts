/**
 * Skriptbibliothek: Stand der Bibliothek gegen den Tenant
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
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
