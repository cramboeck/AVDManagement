/**
 * Netzwerk: abgeleitete Topologie aus dem Geraete-Snapshot
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { buildNetworkTopology } from '@zerostress/core';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getDeviceInventory } from '../services/inventory.js';
import { getHuntingProvider } from '../services/microsoft-clients.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { CorrelationId, NetworkTopology } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Standorte (externe IP) und Subnetze (/24) aus den zuletzt gesehenen Adressen
app.get('/topology', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const inventory = await getDeviceInventory(tenant);
  const topology: NetworkTopology = {
    ...buildNetworkTopology(inventory.items),
    snapshot: inventory.snapshot ?? null,
    generatedAt: new Date().toISOString(),
  };
  return c.json(topology);
});

// Ziele aller Geraete aus Advanced Hunting: extern (oeffentliche Adressen) oder intern (private Adressen)
app.get('/connections', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const days = Number(c.req.query('days') ?? '7');
  const scope = c.req.query('scope') === 'internal' ? 'internal' : 'external';
  const correlationId = (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId;
  const report = await getHuntingProvider().getTenantConnections({ tenantId: tenant.id, correlationId }, days, scope);
  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'network.connections.view',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    afterState: report.available ? { days: report.data.days, scope, destinations: report.data.items.length } : undefined,
    result: report.available ? 'success' : 'failure',
    errorMessage: report.available ? undefined : report.reason,
    correlationId,
  });
  return c.json(report);
});

export { app as networkRouter };
