/**
 * Netzwerk: abgeleitete Topologie aus dem Geraete-Snapshot
 */

import { Hono } from 'hono';
import { buildNetworkTopology } from '@zerostress/core';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getDeviceInventory } from '../services/inventory.js';
import type { NetworkTopology } from '@zerostress/types';

const app = new Hono();

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

export { app as networkRouter };
