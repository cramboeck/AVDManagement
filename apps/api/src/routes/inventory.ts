/**
 * Bestands-Snapshot: Stand je Bestandsart und manuelle Aktualisierung
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { INVENTORY_KINDS } from '@zerostress/core';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getInventoryStatus, requestInventoryRefresh } from '../services/inventory.js';
import { getTokenProvider } from '../services/microsoft-clients.js';
import type { InventoryKind } from '@zerostress/types';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

const refreshSchema = z.object({
  kinds: z.array(z.enum(INVENTORY_KINDS as [InventoryKind, ...InventoryKind[]])).min(1).optional(),
});

app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  return c.json(await getInventoryStatus(tenant));
});

// Lesender Abgleich mit Microsoft; kein Job, weil nichts im Tenant veraendert wird
app.post('/refresh', requireConnectedTenant, zValidator('json', refreshSchema), async (c) => {
  const tenant = c.get('tenant');
  const { kinds } = c.req.valid('json');
  // Manuell heisst meist: Berechtigung oder Consent wurde gerade geaendert
  getTokenProvider().invalidateTokens(tenant.microsoftTenantId);
  await requestInventoryRefresh(tenant, kinds);
  return c.json(await getInventoryStatus(tenant), 202);
});

export { app as inventoryRouter };
