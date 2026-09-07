/**
 * Job-Routen
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import Redis from 'ioredis';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import {
  JobQueue,
  IdentityProvider,
  GraphClient,
  TokenProvider,
  registerIdentityJobs,
} from '@zerostress/core';
import { DrizzleJobStore } from '../services/job-store.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { JobId, TenantId, Job, JobStatus } from '@zerostress/types';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Job-Queue initialisieren (Singleton in Produktion)
let jobQueue: JobQueue | null = null;

function getJobQueue(): JobQueue {
  if (!jobQueue) {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const jobStore = new DrizzleJobStore();
    const auditLogger = new DrizzleAuditLogger();

    // Identity-Provider fuer Job-Handler
    const tokenProvider = new TokenProvider({
      clientId: process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      tenantId: process.env.ENTRA_TENANT_ID!,
    });

    const graphClient = new GraphClient({
      getAccessToken: (tenantId, scopes) => tokenProvider.getAccessToken(tenantId, scopes),
    });

    const identityProvider = new IdentityProvider(graphClient);

    // Jobs registrieren
    registerIdentityJobs(identityProvider);

    jobQueue = new JobQueue({ redis }, jobStore, auditLogger);
    jobQueue.startWorker();
  }
  return jobQueue;
}

// Jobs auflisten
app.get('/', async (c) => {
  const auth = c.get('auth');
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
