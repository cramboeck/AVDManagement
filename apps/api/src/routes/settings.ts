/**
 * MSP-Einstellungen: Vier-Augen-Prinzip, Betriebs-Alerts, Team, Worker-Token
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { getAllRegisteredJobs, isValidTimeZone } from '@zerostress/core';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { getMspSettings, updateMspSettings } from '../services/msp-settings.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import { listTeam, updateTeamMember, TeamError } from '../services/access.js';
import { createWorkerToken, listWorkerTokens, revokeWorkerToken } from '../services/worker-tokens.js';
import type { CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);

app.get('/', async (c) => {
  const auth = c.get('auth');
  const settings = await getMspSettings(auth.mspId);
  // Jobtypen mit Vorschau, damit die Oberflaeche eine Auswahl anbieten kann
  const jobTypes = getAllRegisteredJobs()
    .filter((j) => j.definition.requiresPreview)
    .map((j) => ({ type: j.definition.type, displayName: j.definition.displayName }))
    .sort((a, b) => a.type.localeCompare(b.type));
  return c.json({ settings, jobTypes, me: { id: auth.user.id, email: auth.user.email, role: auth.user.role } });
});

// ---- Team: Rollen und Tenant-Sichtbarkeit ----

app.get('/team', requireRole('engineer'), async (c) => {
  const auth = c.get('auth');
  return c.json({ items: await listTeam(auth.mspId) });
});

const teamSchema = z.object({
  role: z.enum(['owner', 'engineer', 'readonly']).optional(),
  tenantIds: z.array(z.string().uuid()).max(500).optional(),
  isActive: z.boolean().optional(),
});

app.put('/team/:userId', requireRole('owner'), validate('json', teamSchema), async (c) => {
  const auth = c.get('auth');
  const userId = c.req.param('userId');
  const body = c.req.valid('json');
  try {
    const before = (await listTeam(auth.mspId)).find((m) => m.id === userId);
    const member = await updateTeamMember(auth.mspId, auth.user.id, userId, body);
    await audit.log({
      mspId: auth.mspId,
      tenantId: null,
      userId: auth.user.id,
      action: 'team.update',
      targetType: 'msp-user',
      targetId: userId,
      targetDisplayName: member.email,
      beforeState: before ? { role: before.role, tenantIds: before.tenantIds, isActive: before.isActive } : undefined,
      afterState: { role: member.role, tenantIds: member.tenantIds, isActive: member.isActive },
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
    return c.json(member);
  } catch (error) {
    if (error instanceof TeamError) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: error.message, status: error.status }, error.status);
    throw error;
  }
});

// ---- Worker-Token je MSP ----

app.get('/worker-tokens', requireRole('engineer'), async (c) => {
  const auth = c.get('auth');
  return c.json({ items: await listWorkerTokens(auth.mspId), envTokenConfigured: (process.env.WORKER_TOKEN ?? '').length >= 16 });
});

app.post('/worker-tokens', requireRole('owner'), validate('json', z.object({ label: z.string().min(2).max(100) })), async (c) => {
  const auth = c.get('auth');
  const { token, info } = await createWorkerToken(auth.mspId, auth.user.id, c.req.valid('json').label);
  await audit.log({
    mspId: auth.mspId,
    tenantId: null,
    userId: auth.user.id,
    action: 'worker-token.create',
    targetType: 'worker-token',
    targetId: info.id,
    targetDisplayName: info.label,
    result: 'success',
    correlationId: randomUUID() as CorrelationId,
  });
  // Der Klartext erscheint genau hier und nie wieder
  return c.json({ token, info }, 201);
});

app.delete('/worker-tokens/:tokenId', requireRole('owner'), async (c) => {
  const auth = c.get('auth');
  const tokenId = c.req.param('tokenId');
  const revoked = await revokeWorkerToken(auth.mspId, tokenId);
  if (!revoked) return c.json({ type: 'https://api.zerostress.io/problems/not-found', title: 'Token not found or already revoked', status: 404 }, 404);
  await audit.log({
    mspId: auth.mspId,
    tenantId: null,
    userId: auth.user.id,
    action: 'worker-token.revoke',
    targetType: 'worker-token',
    targetId: tokenId,
    targetDisplayName: tokenId,
    result: 'success',
    correlationId: randomUUID() as CorrelationId,
  });
  return c.json({ revoked: true });
});

const schema = z.object({
  fourEyes: z.object({
    enabled: z.boolean(),
    minObjects: z.number().int().min(0).max(10000),
    jobTypes: z.array(z.string().regex(/^[a-z0-9.-]{3,60}$/)).max(100),
  }),
  alerts: z.object({
    outdatedSoftware: z.object({ enabled: z.boolean(), minDevices: z.number().int().min(1).max(10000) }),
    mailboxQuota: z.object({ enabled: z.boolean(), percent: z.number().int().min(50).max(100) }),
    vmOutsideHours: z.object({
      enabled: z.boolean(),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(1).max(24),
      timeZone: z.string().min(1).max(64).refine(isValidTimeZone, 'Unbekannte Zeitzone'),
      weekdaysOnly: z.boolean(),
      excludeSessionHosts: z.boolean(),
      excludeTag: z.string().max(100),
    }),
  }),
});

// Nur Owner: die Regel schuetzt vor dem Engineer-Konto selbst
app.put('/', requireRole('owner'), validate('json', schema), async (c) => {
  const auth = c.get('auth');
  const before = await getMspSettings(auth.mspId);
  const after = await updateMspSettings(auth.mspId, c.req.valid('json'));
  await audit.log({
    mspId: auth.mspId,
    tenantId: null,
    userId: auth.user.id,
    action: 'settings.update',
    targetType: 'msp',
    targetId: auth.mspId,
    targetDisplayName: 'MSP-Einstellungen',
    beforeState: before as unknown as Record<string, unknown>,
    afterState: after as unknown as Record<string, unknown>,
    result: 'success',
    correlationId: randomUUID() as CorrelationId,
  });
  return c.json({ settings: after });
});

export { app as settingsRouter };
