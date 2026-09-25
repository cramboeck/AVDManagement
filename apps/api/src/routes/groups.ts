/**
 * Gruppen-Routen: Teams, Microsoft 365-, Sicherheits- und Verteilergruppen
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { getJobQueue } from '../services/job-queue.js';
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

// Mitglieder und Besitzer aendern: Jobs mit Vorschau und Freigabe
const membershipSchema = z.object({
  groupName: z.string().min(1),
  objectId: z.string().min(1),
  objectDisplayName: z.string().min(1),
  objectUpn: z.string().nullable().optional(),
});

const membershipActions: Record<string, string> = {
  'add-member': 'group.add-member',
  'remove-member': 'group.remove-member',
  'add-owner': 'group.add-owner',
  'remove-owner': 'group.remove-owner',
};

app.post('/:groupId/:action{add-member|remove-member|add-owner|remove-owner}', requireRole('engineer'), requireConnectedTenant, zValidator('json', membershipSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const groupId = c.req.param('groupId');
  const action = membershipActions[c.req.param('action')];
  const body = c.req.valid('json');
  const job = await getJobQueue().createJob({
    type: action,
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: {
      groupId,
      groupName: body.groupName,
      objectId: body.objectId,
      objectDisplayName: body.objectDisplayName,
      objectUpn: body.objectUpn ?? null,
      targetType: 'group',
      targetId: groupId,
      targetDisplayName: `${body.groupName}: ${body.objectDisplayName}`,
    },
  });
  return c.json(job, 202);
});

export { app as groupsRouter };
