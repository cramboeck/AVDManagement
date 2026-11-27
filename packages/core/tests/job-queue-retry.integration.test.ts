/**
 * Integrationstest: maxRetries, timeoutSeconds und concurrencyPerTenant der
 * Jobdefinition werden in der Queue angewendet. Laeuft nur mit TEST_REDIS_URL.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { JobQueue, type JobStore, type AuditLogger } from '../src/jobs/job-queue.js';
import { registerJob } from '../src/jobs/job-types.js';
import { GraphApiError } from '../src/errors.js';
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
    return Array.from(this.jobs.values()).filter((j) => j.tenantId === tenantId && (!options?.status || j.status === options.status));
  }
}

async function waitFor(check: () => boolean, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!redisUrl)('JobQueue retries, timeouts and per-tenant limits', () => {
  const tenantId = 'tenant-r' as TenantId;
  const mspId = 'msp-1' as MspId;
  const userId = 'user-1' as UserId;
  let redis: Redis;
  let queue: JobQueue;
  let store: MemoryJobStore;
  const audit: Parameters<AuditLogger['log']>[0][] = [];
  let throttledCalls = 0;
  let serverErrorCalls = 0;
  let parallel = 0;
  let maxParallel = 0;

  beforeAll(() => {
    redis = new Redis(redisUrl!, { maxRetriesPerRequest: null });
    store = new MemoryJobStore();
    registerJob({ type: 'test.throttled', displayName: 'Gedrosselt', maxRetries: 1, timeoutSeconds: 10, concurrencyPerTenant: 1, requiresPreview: false }, async () => {
      throttledCalls += 1;
      return { success: false, error: { code: 'X', message: 'throttled', retryable: true } };
    });
    registerJob({ type: 'test.server-error', displayName: 'Serverfehler', maxRetries: 3, timeoutSeconds: 10, concurrencyPerTenant: 1, requiresPreview: false }, async () => {
      serverErrorCalls += 1;
      throw new GraphApiError(503, 'ServiceUnavailable', 'busy');
    });
    registerJob({ type: 'test.slow', displayName: 'Langsam', maxRetries: 0, timeoutSeconds: 1, concurrencyPerTenant: 1, requiresPreview: false }, async () => {
      await new Promise((r) => setTimeout(r, 3000));
      return { success: true, data: {} };
    });
    registerJob({ type: 'test.limited', displayName: 'Begrenzt', maxRetries: 0, timeoutSeconds: 10, concurrencyPerTenant: 2, requiresPreview: false }, async () => {
      parallel += 1;
      maxParallel = Math.max(maxParallel, parallel);
      await new Promise((r) => setTimeout(r, 300));
      parallel -= 1;
      return { success: true, data: {} };
    });
    // Kurze Wartezeit zwischen den Versuchen, damit der Test schnell bleibt
    queue = new JobQueue({ redis, queueName: `zerostress-retry-${process.pid}-${Date.now()}`, retryBackoffMs: 10 }, store, { log: async (entry) => void audit.push(entry) });
    queue.startWorker(5);
  });

  afterAll(async () => {
    await queue.close();
    await redis.quit();
  });

  const payload = { targetType: 'test', targetId: 'x', targetDisplayName: 'x' };

  it('retries a throttled job exactly maxRetries times and audits only the final failure', async () => {
    const job = await queue.createJob({ type: 'test.throttled', tenantId, mspId, userId, payload });
    await waitFor(() => store.jobs.get(job.id)?.status === 'failed');
    expect(throttledCalls).toBe(2);
    expect(audit.filter((e) => e.correlationId === job.correlationId)).toHaveLength(1);
  });

  it('does not retry a 503 from a handler (outcome unknown) and maps the message', async () => {
    const job = await queue.createJob({ type: 'test.server-error', tenantId, mspId, userId, payload });
    await waitFor(() => store.jobs.get(job.id)?.status === 'failed');
    expect(serverErrorCalls).toBe(1);
    expect(store.jobs.get(job.id)?.error).toContain('Ergebnis im Tenant pruefen');
  });

  it('fails a job that exceeds timeoutSeconds with a clear message', async () => {
    const job = await queue.createJob({ type: 'test.slow', tenantId, mspId, userId, payload });
    await waitFor(() => store.jobs.get(job.id)?.status === 'failed');
    expect(store.jobs.get(job.id)?.error).toContain('Zeitlimit');
  });

  it('runs at most concurrencyPerTenant jobs of one type per tenant at the same time', async () => {
    const jobs = await Promise.all(Array.from({ length: 5 }, () => queue.createJob({ type: 'test.limited', tenantId, mspId, userId, payload })));
    await waitFor(() => jobs.every((j) => store.jobs.get(j.id)?.status === 'completed'));
    expect(maxParallel).toBe(2);
  });
});
