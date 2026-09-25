/**
 * Gruppen-Routen: Teams, Microsoft 365-, Sicherheits- und Verteilergruppen
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getGroupProvider } from '../services/microsoft-clients.js';
import { getGroupInventory } from '../services/inventory.js';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Alle Gruppen mit Zaehlungen und Auffaelligkeiten aus dem Snapshot
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  return c.json(await getGroupInventory(tenant));
});

// Detail live: Besitzer und Mitglieder
app.get('/:groupId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const groupId = c.req.param('groupId');
  const detail = await getGroupProvider().getGroupDetail(
    { tenantId: tenant.id, correlationId: c.req.header('X-Correlation-ID') ?? randomUUID() },
    groupId
  );
  if (!detail) {
    return c.json(
      { type: 'https://api.zerostress.io/problems/not-found', title: 'Group not found', status: 404, detail: `Group '${groupId}' not found` },
      404
    );
  }
  return c.json(detail);
});

export { app as groupsRouter };
