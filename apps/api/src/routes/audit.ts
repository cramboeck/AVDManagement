/**
 * Audit-Log-Routen
 */

import { Hono } from 'hono';
import { eq, and, or, desc, gte, lte, lt, like, ilike, type SQL } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware } from '../middleware/tenant-context.js';
import { verifyAuditChain } from '../services/audit-verify.js';
import { db, auditEntries, mspUsers } from '../db/index.js';
import type { AuditEntry, MspId, TenantId, UserId, CorrelationId } from '@zerostress/types';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Hash-Kette des ganzen MSP nachrechnen (nur Owner; kann bei grossen Logs einige Sekunden dauern)
app.get('/verify', requireRole('owner'), async (c) => {
  const auth = c.get('auth');
  return c.json(await verifyAuditChain(auth.mspId));
});

// Audit-Eintraege des Tenants aus der URL (Sichtbarkeit je Techniker ueber tenantContextMiddleware)
const MAX_LIMIT = 200;

/** LIKE-Platzhalter im Suchtext wortwoertlich nehmen. */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

interface Cursor {
  ts: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(token: string): Cursor | null {
  try {
    const raw = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof raw.ts !== 'string' || typeof raw.id !== 'string' || Number.isNaN(Date.parse(raw.ts))) return null;
    return { ts: raw.ts, id: raw.id };
  } catch {
    return null;
  }
}

function parseDate(value: string | undefined): Date | null | 'invalid' {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

const OUTCOMES = new Set(['success', 'failure', 'partial']);

app.get('/', async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');

  const action = c.req.query('action')?.trim();
  const outcome = c.req.query('outcome');
  const search = c.req.query('search')?.trim();
  const from = parseDate(c.req.query('from'));
  const to = parseDate(c.req.query('to'));
  const pageToken = c.req.query('pageToken');
  const requested = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : 50;
  const cursor = pageToken ? decodeCursor(pageToken) : null;

  if (from === 'invalid' || to === 'invalid' || (outcome && !OUTCOMES.has(outcome)) || (pageToken && !cursor)) {
    return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'Invalid filter', status: 400, detail: 'from/to muessen Datumswerte sein, outcome success|failure|partial, pageToken aus einer vorherigen Antwort.' }, 400);
  }

  const conditions: SQL[] = [eq(auditEntries.mspId, auth.mspId), eq(auditEntries.tenantId, tenant.id)];
  if (action) conditions.push(like(auditEntries.action, `%${likeEscape(action)}%`));
  if (outcome) conditions.push(eq(auditEntries.result, outcome));
  if (search) {
    const pattern = `%${likeEscape(search)}%`;
    const match = or(ilike(auditEntries.targetDisplayName, pattern), ilike(auditEntries.targetId, pattern), ilike(auditEntries.action, pattern), ilike(auditEntries.correlationId, pattern));
    if (match) conditions.push(match);
  }
  if (from) conditions.push(gte(auditEntries.timestamp, from));
  if (to) conditions.push(lte(auditEntries.timestamp, to));
  if (cursor) {
    // Keyset-Paging: aelter als der letzte Eintrag, bei gleicher Zeit nach Id
    const ts = new Date(cursor.ts);
    const older = or(lt(auditEntries.timestamp, ts), and(eq(auditEntries.timestamp, ts), lt(auditEntries.id, cursor.id)));
    if (older) conditions.push(older);
  }

  const rows = await db.query.auditEntries.findMany({
    where: and(...conditions),
    orderBy: [desc(auditEntries.timestamp), desc(auditEntries.id)],
    limit: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextPageToken = rows.length > limit && last ? encodeCursor({ ts: last.timestamp.toISOString(), id: last.id }) : null;

  // Benutzer-IDs sammeln fuer Display-Namen
  const userIds = [...new Set(page.map((r) => r.userId))];
  const users = userIds.length ? await db.query.mspUsers.findMany({ where: (u, { inArray }) => inArray(u.id, userIds) }) : [];
  const items: AuditEntry[] = page.map((row) => {
    const user = users.find((u) => u.id === row.userId);
    return {
      id: row.id,
      mspId: row.mspId as MspId,
      tenantId: row.tenantId as TenantId | null,
      timestamp: row.timestamp.toISOString(),
      actorId: row.userId as UserId,
      actorEmail: user?.email ?? '',
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      targetDisplayName: row.targetDisplayName ?? '',
      previousValue: row.beforeState as Record<string, unknown> | null,
      newValue: row.afterState as Record<string, unknown> | null,
      outcome: row.result as 'success' | 'failure' | 'partial',
      errorMessage: row.errorMessage,
      correlationId: row.correlationId as CorrelationId,
    };
  });

  return c.json({ items, nextPageToken });
});

// Einzelner Audit-Eintrag
app.get('/:entryId', async (c) => {
  const auth = c.get('auth');
  const entryId = c.req.param('entryId');

  const row = await db.query.auditEntries.findFirst({
    where: and(eq(auditEntries.id, entryId), eq(auditEntries.mspId, auth.mspId), eq(auditEntries.tenantId, c.get('tenant').id)),
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
    timestamp: row.timestamp.toISOString(),
    actorId: row.userId as UserId,
    actorEmail: user?.email ?? '',
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetDisplayName: row.targetDisplayName ?? '',
    previousValue: row.beforeState as Record<string, unknown> | null,
    newValue: row.afterState as Record<string, unknown> | null,
    outcome: row.result as 'success' | 'failure' | 'partial',
    errorMessage: row.errorMessage,
    correlationId: row.correlationId as CorrelationId,
  };

  return c.json(entry);
});

export { app as auditRouter };
