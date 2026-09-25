/**
 * Job-Routen
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { randomUUID } from 'node:crypto';
import { getJobQueue } from '../services/job-queue.js';
import { unsealResult } from '../services/result-crypto.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { JobId, Job, JobStatus, CorrelationId, SealedCipher } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Jobs auflisten
app.get('/', async (c) => {
  const tenant = c.get('tenant');
  const queue = getJobQueue();

  const status = c.req.query('status') as JobStatus | undefined;
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  let jobs: Job[];
  if (tenant) {
    jobs = await queue.listJobs(tenant.id, { status, limit });
  } else {
    // Alle Jobs fuer MSP (TODO: separater Endpunkt)
    jobs = [];
  }

  return c.json({ items: jobs });
});

// Job-Details
app.get('/:jobId', async (c) => {
  const jobId = c.req.param('jobId') as JobId;
  const queue = getJobQueue();

  const job = await queue.getJob(jobId);

  if (!job) {
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/not-found',
        title: 'Job not found',
        status: 404,
      },
      404
    );
  }

  return c.json(job);
});

// Job erstellen (Lizenz zuweisen)
const createLicenseJobSchema = z.object({
  userId: z.string(),
  userDisplayName: z.string(),
  skuId: z.string(),
  skuDisplayName: z.string(),
});

app.post(
  '/assign-license',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', createLicenseJobSchema),
  async (c) => {
    const auth = c.get('auth');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const queue = getJobQueue();

    const job = await queue.createJob({
      type: 'identity.assign-license',
      tenantId: tenant.id,
      mspId: auth.mspId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      payload: {
        userId: body.userId,
        userDisplayName: body.userDisplayName,
        skuId: body.skuId,
        skuDisplayName: body.skuDisplayName,
        targetType: 'user-license',
        targetId: body.userId,
        targetDisplayName: `${body.userDisplayName} - ${body.skuDisplayName}`,
      },
    });

    return c.json(job, 202);
  }
);

// Konto-Aktionen (deaktivieren, aktivieren, Sitzungen widerrufen, Passwort)
const accountActionSchema = z.object({
  userId: z.string().min(1),
  userDisplayName: z.string().min(1),
  userPrincipalName: z.string().min(1),
  revokeSessions: z.boolean().optional(),
});

const accountActions: Record<string, { type: string; targetType: string }> = {
  'disable-user': { type: 'identity.disable-user', targetType: 'user' },
  'enable-user': { type: 'identity.enable-user', targetType: 'user' },
  'revoke-sessions': { type: 'identity.revoke-sessions', targetType: 'user' },
  'reset-password': { type: 'identity.reset-password', targetType: 'user' },
};

app.post(
  '/:action{disable-user|enable-user|revoke-sessions|reset-password}',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', accountActionSchema),
  async (c) => {
    const auth = c.get('auth');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const action = accountActions[c.req.param('action')];
    const queue = getJobQueue();

    const job = await queue.createJob({
      type: action.type,
      tenantId: tenant.id,
      mspId: auth.mspId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      payload: {
        userId: body.userId,
        userDisplayName: body.userDisplayName,
        userPrincipalName: body.userPrincipalName,
        revokeSessions: body.revokeSessions ?? true,
        targetType: action.targetType,
        targetId: body.userId,
        targetDisplayName: `${body.userDisplayName} (${body.userPrincipalName})`,
      },
    });

    return c.json(job, 202);
  }
);

// Geraete-Aktionen (Intune)
const deviceActionSchema = z.object({
  managedDeviceId: z.string().min(1),
  deviceName: z.string().min(1),
  quickScan: z.boolean().optional(),
});

const deviceActions: Record<string, string> = {
  'sync-device': 'device.sync',
  'restart-device': 'device.restart',
  'defender-scan': 'device.defender-scan',
};

app.post(
  '/:action{sync-device|restart-device|defender-scan}',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', deviceActionSchema),
  async (c) => {
    const auth = c.get('auth');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const queue = getJobQueue();

    const job = await queue.createJob({
      type: deviceActions[c.req.param('action')],
      tenantId: tenant.id,
      mspId: auth.mspId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      payload: {
        managedDeviceId: body.managedDeviceId,
        deviceName: body.deviceName,
        quickScan: body.quickScan ?? true,
        targetType: 'device',
        targetId: body.managedDeviceId,
        targetDisplayName: body.deviceName,
      },
    });

    return c.json(job, 202);
  }
);

// Bibliotheksskript auf einem Geraet ausfuehren (nur Skript-Ids aus der Bibliothek)
const runScriptSchema = z.object({
  managedDeviceId: z.string().min(1),
  deviceName: z.string().min(1),
  scriptId: z.enum(['update-status', 'update-scan', 'system-info', 'winget-updates', 'network-info', 'storage-info', 'local-admins']),
});

app.post('/run-script', requireRole('engineer'), requireConnectedTenant, zValidator('json', runScriptSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const body = c.req.valid('json');
  const queue = getJobQueue();

  const job = await queue.createJob({
    type: 'device.run-script',
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: {
      managedDeviceId: body.managedDeviceId,
      deviceName: body.deviceName,
      scriptId: body.scriptId,
      targetType: 'device',
      targetId: body.managedDeviceId,
      targetDisplayName: `${body.deviceName} - ${body.scriptId}`,
    },
  });

  return c.json(job, 202);
});

// Job bestaetigen (nach Preview)
app.post('/:jobId/approve', requireRole('engineer'), async (c) => {
  const auth = c.get('auth');
  const jobId = c.req.param('jobId') as JobId;
  const queue = getJobQueue();

  try {
    const job = await queue.approveJob(jobId, auth.user.id);
    return c.json(job);
  } catch (error) {
    if ((error as { type?: string }).type === 'job-error') {
      return c.json(
        {
          type: 'https://api.zerostress.io/problems/job-error',
          title: (error as Error).message,
          status: 409,
        },
        409
      );
    }
    throw error;
  }
});

// Versiegeltes Ergebnis anzeigen: Begruendung, Rolle Engineer, Audit; der Klartext verlaesst nie die Antwort
const revealSchema = z.object({ reason: z.string().trim().min(10).max(500) });

app.post('/:jobId/reveal', requireRole('engineer'), requireConnectedTenant, zValidator('json', revealSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const jobId = c.req.param('jobId') as JobId;
  const { reason } = c.req.valid('json');
  const correlationId = randomUUID() as CorrelationId;
  const job = await getJobQueue().getJob(jobId);
  if (!job || job.tenantId !== tenant.id) {
    return c.json({ type: 'https://api.zerostress.io/problems/not-found', title: 'Job not found', status: 404 }, 404);
  }
  const result = job.result as { sealed?: boolean; cipher?: SealedCipher | null; purged?: boolean; scriptId?: string } | null;
  const auditBase = {
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'job.result.reveal',
    targetType: 'job',
    targetId: job.id,
    targetDisplayName: String(job.payload.targetDisplayName ?? job.type),
    afterState: { reason, scriptId: result?.scriptId ?? null },
    correlationId,
  };
  if (!result?.sealed) {
    return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'Result is not sealed', status: 400 }, 400);
  }
  if (result.purged || !result.cipher) {
    await audit.log({ ...auditBase, result: 'failure', errorMessage: 'Result purged after retention' });
    return c.json({ type: 'https://api.zerostress.io/problems/gone', title: 'Result purged', status: 410, detail: 'Der Klartext wurde nach 30 Tagen geloescht.' }, 410);
  }
  try {
    const revealed = unsealResult(result.cipher);
    await audit.log({ ...auditBase, result: 'success' });
    return c.json(revealed);
  } catch (error) {
    await audit.log({ ...auditBase, result: 'failure', errorMessage: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

// Job abbrechen
app.post('/:jobId/cancel', requireRole('engineer'), async (c) => {
  const jobId = c.req.param('jobId') as JobId;
  const queue = getJobQueue();

  try {
    const job = await queue.cancelJob(jobId);
    return c.json(job);
  } catch (error) {
    if ((error as { type?: string }).type === 'job-error') {
      return c.json(
        {
          type: 'https://api.zerostress.io/problems/job-error',
          title: (error as Error).message,
          status: 409,
        },
        409
      );
    }
    throw error;
  }
});

export { app as jobsRouter };
