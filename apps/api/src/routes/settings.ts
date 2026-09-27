/**
 * MSP-Einstellungen: Vier-Augen-Prinzip
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getAllRegisteredJobs } from '@zerostress/core';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { getMspSettings, updateMspSettings } from '../services/msp-settings.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
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
  return c.json({ settings, jobTypes });
});

const schema = z.object({
  fourEyes: z.object({
    enabled: z.boolean(),
    minObjects: z.number().int().min(0).max(10000),
    jobTypes: z.array(z.string().regex(/^[a-z0-9.-]{3,60}$/)).max(100),
  }),
});

// Nur Owner: die Regel schuetzt vor dem Engineer-Konto selbst
app.put('/', requireRole('owner'), zValidator('json', schema), async (c) => {
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
