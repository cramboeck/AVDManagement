/**
 * Audit-Log-Routen
 */

import { Hono } from 'hono';
import { eq, and, desc, gte, lte, like } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { db, auditEntries, mspUsers } from '../db/index.js';
import type { AuditEntry, MspId, TenantId, UserId, CorrelationId } from '@zerostress/types';

const app = new Hono();

app.use('*', authMiddleware);

// Audit-Eintraege auflisten
app.get('/', async (c) => {
  const auth = c.get('auth');

  const tenantId = c.req.query('tenantId');
  const action = c.req.query('action');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  const conditions = [eq(auditEntries.mspId, auth.mspId)];

  if (tenantId) {
    conditions.push(eq(auditEntries.tenantId, tenantId));
  }

  if (action) {
    conditions.push(like(auditEntries.action, `%${action}%`));
  }

  if (from) {
    conditions.push(gte(auditEntries.timestamp, new Date(from)));
  }

  if (to) {
    conditions.push(lte(auditEntries.timestamp, new Date(to)));
  }

  const rows = await db.query.auditEntries.findMany({
    where: and(...conditions),
    orderBy: [desc(auditEntries.timestamp)],
    limit,
  });

  // Benutzer-IDs sammeln fuer Display-Namen
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = await db.query.mspUsers.findMany({
    where: (u, { inArray }) => inArray(u.id, userIds),
  });
  const userMap = new Map(users.map((u) => [u.id, u.displayName]));

  const items: AuditEntry[] = rows.map((row) => ({
    id: row.id,
    mspId: row.mspId as MspId,
    tenantId: row.tenantId as TenantId | null,
    timestamp: row.timestamp,
    userId: row.userId as UserId,
    userDisplayName: userMap.get(row.userId) ?? 'Unknown',
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetDisplayName: row.targetDisplayName ?? '',
    beforeState: row.beforeState as Record<string, unknown> | null,
    afterState: row.afterState as Record<string, unknown> | null,
    result: row.result as 'success' | 'failure' | 'partial',
    errorMessage: row.errorMessage,
    correlationId: row.correlationId as CorrelationId,
  }));

  return c.json({ items });
});

// Einzelner Audit-Eintrag
app.get('/:entryId', async (c) => {
  const auth = c.get('auth');
  const entryId = c.req.param('entryId');

  const row = await db.query.auditEntries.findFirst({
    where: and(
      eq(auditEntries.id, entryId),
      eq(auditEntries.mspId, auth.mspId)
    ),
  });

  if (!row) {
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/not-found',
        title: 'Audit entry not found',
        status: 404,
      },
      404
    );
  }

  const user = await db.query.mspUsers.findFirst({
    where: eq(mspUsers.id, row.userId),
  });

  const entry: AuditEntry = {
    id: row.id,
    mspId: row.mspId as MspId,
    tenantId: row.tenantId as TenantId | null,
    timestamp: row.timestamp,
    userId: row.userId as UserId,
    userDisplayName: user?.displayName ?? 'Unknown',
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetDisplayName: row.targetDisplayName ?? '',
    beforeState: row.beforeState as Record<string, unknown> | null,
    afterState: row.afterState as Record<string, unknown> | null,
    result: row.result as 'success' | 'failure' | 'partial',
    errorMessage: row.errorMessage,
    correlationId: row.correlationId as CorrelationId,
  };

  return c.json(entry);
});

export { app as auditRouter };
