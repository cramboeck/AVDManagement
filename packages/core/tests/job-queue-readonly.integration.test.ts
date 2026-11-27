/**
 * Integrationstest: Nur-Lese-Sperre in der JobQueue gegen ein echtes Redis.
 * Laeuft nur mit TEST_REDIS_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { JobQueue, type JobStore, type AuditLogger } from '../src/jobs/job-queue.js';
import { registerJob } from '../src/jobs/job-types.js';
import { createWriteGuard } from '../src/jobs/write-guard.js';
import { ReadOnlyModeError } from '../src/errors.js';
import type { Job, JobId, JobStatus, TenantAccessMode, TenantId, MspId, UserId } from '@zerostress/types';

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
    return Array.from(this.jobs.values()).filter((j) => j.tenantId === tenantId && (!options?.status || j.status === options.status));
  }
}

async function waitFor(check: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!redisUrl)('JobQueue read-only mode', () => {
  const tenantA = 'tenant-a' as TenantId;
  const tenantB = 'tenant-b' as TenantId;
  const mspId = 'msp-1' as MspId;
  const userId = 'user-1' as UserId;
  const modes = new Map<TenantId, TenantAccessMode>();
  let consoleReadOnly = false;
  let redis: Redis;
  let queue: JobQueue;
  let store: MemoryJobStore;
  const audit: Parameters<AuditLogger['log']>[0][] = [];
  const executed: string[] = [];

  beforeAll(() => {
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: null });
    store = new MemoryJobStore();
    registerJob(
      { type: 'test.write', displayName: 'Testaenderung', maxRetries: 0, timeoutSeconds: 10, concurrencyPerTenant: 1, requiresPreview: true },
      async (ctx) => {
        executed.push(ctx.jobId);
        return { success: true, data: {} };
      },
      async () => ({ changes: [], warnings: [], estimatedDurationSeconds: 1 })
    );
    registerJob(
      { type: 'test.undo', displayName: 'Ruecknahme', maxRetries: 0, timeoutSeconds: 10, concurrencyPerTenant: 1, requiresPreview: false, allowedInReadOnly: true },
      async () => ({ success: true, data: {} })
    );
    queue = new JobQueue(
      { redis, queueName: `zerostress-ro-${process.pid}-${Date.now()}`, writeGuard: createWriteGuard(() => consoleReadOnly, async (id) => modes.get(id) ?? 'full') },
      store,
      { log: async (entry) => void audit.push(entry) }
    );
    queue.startWorker(1);
  });

  afterAll(async () => {
    await queue.close();
    await redis.quit();
  });

  const payload = { targetType: 'user', targetId: 'u-1', targetDisplayName: 'Testbenutzer' };

  it('refuses to create a write job for a read-only tenant and audits the attempt', async () => {
    modes.set(tenantA, 'read-only');
    const before = store.jobs.size;
    await expect(queue.createJob({ type: 'test.write', tenantId: tenantA, mspId, userId, payload })).rejects.toBeInstanceOf(ReadOnlyModeError);
    expect(store.jobs.size).toBe(before);
    expect(audit.at(-1)).toMatchObject({ action: 'test.write', tenantId: tenantA, result: 'failure', errorMessage: 'read-only-mode (tenant)' });
  });

  it('keeps other tenants writable (tenant isolation)', async () => {
    modes.set(tenantA, 'read-only');
    const job = await queue.createJob({ type: 'test.write', tenantId: tenantB, mspId, userId, payload });
    expect(job.status).toBe('pending_approval');
  });

  it('blocks the approval when the tenant was switched after creation', async () => {
    modes.set(tenantB, 'full');
    const job = await queue.createJob({ type: 'test.write', tenantId: tenantB, mspId, userId, payload });
    modes.set(tenantB, 'read-only');
    await expect(queue.approveJob(job.id, userId)).rejects.toMatchObject({ statusCode: 403, scope: 'tenant' });
    expect(store.jobs.get(job.id)?.status).toBe('pending_approval');
    modes.set(tenantB, 'full');
  });

  it('fails an already queued job when the console is switched before it runs', async () => {
    await queue.stopWorker();
    const job = await queue.createJob({ type: 'test.write', tenantId: tenantB, mspId, userId, payload });
    await queue.approveJob(job.id, userId);
    consoleReadOnly = true;
    queue.startWorker(1);
    await waitFor(() => store.jobs.get(job.id)?.status === 'failed');
    expect(executed).not.toContain(job.id);
    expect(store.jobs.get(job.id)?.error).toContain('Nur-Lese-Betrieb');
    expect(audit.find((e) => e.correlationId === job.correlationId && e.errorMessage === 'read-only-mode (console)')).toBeTruthy();
    consoleReadOnly = false;
  });

  it('does not run a queued job that was cancelled', async () => {
    await queue.stopWorker();
    const job = await queue.createJob({ type: 'test.write', tenantId: tenantB, mspId, userId, payload });
    await queue.approveJob(job.id, userId);
    const cancelled = await queue.cancelJob(job.id);
    expect(cancelled.status).toBe('cancelled');
    queue.startWorker(1);
    await new Promise((r) => setTimeout(r, 500));
    expect(executed).not.toContain(job.id);
    expect(store.jobs.get(job.id)?.status).toBe('cancelled');
  });

  it('refuses to cancel a running job instead of pretending', async () => {
    const job = await queue.createJob({ type: 'test.write', tenantId: tenantB, mspId, userId, payload });
    await store.update(job.id, { status: 'running' });
    await expect(queue.cancelJob(job.id)).rejects.toMatchObject({ errorCode: 'ALREADY_RUNNING' });
  });

  it('still runs undo jobs in read-only mode', async () => {
    consoleReadOnly = true;
    const job = await queue.createJob({ type: 'test.undo', tenantId: tenantA, mspId, userId, payload });
    await waitFor(() => store.jobs.get(job.id)?.status === 'completed');
    consoleReadOnly = false;
  });
});
