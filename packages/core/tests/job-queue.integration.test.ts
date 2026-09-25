/**
 * Integrationstest der JobQueue gegen ein echtes Redis.
 * Laeuft nur mit TEST_REDIS_URL, z. B. TEST_REDIS_URL=redis://localhost:6379.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { JobQueue, type JobStore, type AuditLogger } from '../src/jobs/job-queue.js';
import { registerJob } from '../src/jobs/job-types.js';
import type { Job, JobId, JobStatus, TenantId, MspId, UserId } from '@zerostress/types';

const redisUrl = process.env.TEST_REDIS_URL;

class MemoryJobStore implements JobStore {
  readonly jobs = new Map<string, Job>();

  async create(job: Job): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }

  async update(id: JobId, updates: Partial<Job>): Promise<void> {
    const existing = this.jobs.get(id);
    if (!existing) throw new Error(`update of unknown job ${id}`);
    this.jobs.set(id, { ...existing, ...updates });
  }

  async findById(id: JobId): Promise<Job | null> {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  async findByTenant(tenantId: TenantId, options?: { limit?: number; status?: JobStatus }): Promise<Job[]> {
    return Array.from(this.jobs.values())
      .filter((j) => j.tenantId === tenantId && (!options?.status || j.status === options.status))
      .slice(0, options?.limit ?? 50);
  }
}

async function waitFor(check: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!redisUrl)('JobQueue with Redis', () => {
  const tenantId = 'tenant-1' as TenantId;
  const mspId = 'msp-1' as MspId;
  const userId = 'user-1' as UserId;
  let redis: Redis;
  let queue: JobQueue;
  let store: MemoryJobStore;
  const auditEntries: Parameters<AuditLogger['log']>[0][] = [];

  beforeAll(() => {
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: null });
    store = new MemoryJobStore();

    registerJob(
      { type: 'test.echo', displayName: 'Echo', maxRetries: 0, timeoutSeconds: 10, concurrencyPerTenant: 1, requiresPreview: true },
      async (ctx) => ({ success: true, data: { echoed: ctx.payload.value } }),
      async (ctx) => ({
        changes: [{ objectType: 'test', objectId: 'x', objectDisplayName: 'x', action: 'update', before: {}, after: { value: ctx.payload.value } }],
        warnings: [],
        estimatedDurationSeconds: 1,
      })
    );
    registerJob(
      { type: 'test.fail', displayName: 'Fail', maxRetries: 0, timeoutSeconds: 10, concurrencyPerTenant: 1, requiresPreview: false },
      async () => ({ success: false, error: { code: 'BOOM', message: 'intentional failure', retryable: false } })
    );

    queue = new JobQueue(
      { redis, queueName: `zerostress-test-${process.pid}-${Date.now()}` },
      store,
      { log: async (entry) => void auditEntries.push(entry) }
    );
    queue.startWorker(1);
  });

  afterAll(async () => {
    await queue.close();
    await redis.quit();
  });

  it('creates a job with preview under the same id the store knows', async () => {
    const job = await queue.createJob({
      type: 'test.echo',
      tenantId,
      mspId,
      userId,
      payload: { value: 42, targetType: 'test', targetId: 'x', targetDisplayName: 'x' },
    });

    expect(job.status).toBe('pending_approval');
    expect(job.preview?.changes[0]?.after).toEqual({ value: 42 });
    expect(store.jobs.get(job.id)?.id).toBe(job.id);
  });

  it('runs an approved job through the worker and writes a success audit entry', async () => {
    const job = await queue.createJob({
      type: 'test.echo',
      tenantId,
      mspId,
      userId,
      payload: { value: 'hello', targetType: 'test', targetId: 'y', targetDisplayName: 'y' },
    });

    await queue.approveJob(job.id, userId);
    await waitFor(() => store.jobs.get(job.id)?.status === 'completed');

    const done = store.jobs.get(job.id)!;
    expect(done.result).toEqual({ echoed: 'hello' });
    expect(done.startedAt).toBeTruthy();
    expect(done.completedAt).toBeTruthy();
    expect(auditEntries.find((e) => e.correlationId === job.correlationId)).toMatchObject({
      action: 'test.echo',
      result: 'success',
      targetId: 'y',
    });
  });

  it('marks a failing job failed and audits the failure', async () => {
    const job = await queue.createJob({
      type: 'test.fail',
      tenantId,
      mspId,
      userId,
      payload: { targetType: 'test', targetId: 'z', targetDisplayName: 'z' },
    });

    await waitFor(() => store.jobs.get(job.id)?.status === 'failed');

    expect(store.jobs.get(job.id)?.error).toBe('intentional failure');
    expect(auditEntries.find((e) => e.correlationId === job.correlationId)).toMatchObject({
      result: 'failure',
      errorMessage: 'intentional failure',
    });
  });

  it('reports redis and worker health', () => {
    expect(queue.getHealth()).toEqual({ redisStatus: 'ready', workerRunning: true });
  });
});
