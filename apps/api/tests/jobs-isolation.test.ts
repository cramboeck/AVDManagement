/**
 * Tenant-Isolation der Job-Routen: ein Job ist nur ueber den eigenen Tenant
 * und MSP lesbar, freigebbar und abbrechbar. Middleware, Queue und Audit
 * sind gemockt, damit der Test ohne Datenbank und Redis laeuft.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Job } from '@zerostress/types';

const jobs = new Map<string, Partial<Job>>();
const queue = {
  getJob: vi.fn(async (id: string) => (jobs.get(id) as Job | undefined) ?? null),
  approveJob: vi.fn(async (id: string) => ({ ...jobs.get(id), status: 'queued', approvals: [] }) as unknown as Job),
  cancelJob: vi.fn(async (id: string) => ({ ...jobs.get(id), status: 'cancelled' }) as unknown as Job),
};
const auditLog = vi.fn(async () => undefined);

vi.mock('../src/middleware/auth.js', async () => {
  const { createMiddleware } = await import('hono/factory');
  return {
    authMiddleware: createMiddleware(async (c, next) => {
      c.set('auth', { mspId: c.req.header('x-test-msp') ?? 'msp-1', user: { id: 'user-1', email: 'tech@example.test', role: 'owner' } });
      await next();
    }),
    requireRole: () => createMiddleware(async (_c, next) => next()),
  };
});
vi.mock('../src/middleware/tenant-context.js', async () => {
  const { createMiddleware } = await import('hono/factory');
  return {
    tenantContextMiddleware: createMiddleware(async (c, next) => {
      c.set('tenant', { id: c.req.param('tenantId') });
      await next();
    }),
    requireConnectedTenant: createMiddleware(async (_c, next) => next()),
  };
});
vi.mock('../src/services/job-queue.js', () => ({ getJobQueue: () => queue }));
vi.mock('../src/services/audit-logger.js', () => ({ DrizzleAuditLogger: class { log = auditLog; } }));
vi.mock('../src/services/result-crypto.js', () => ({ unsealResult: vi.fn() }));

let app: Hono;

beforeAll(async () => {
  const { jobsRouter } = await import('../src/routes/jobs.js');
  app = new Hono();
  app.route('/tenants/:tenantId/jobs', jobsRouter);
});

beforeEach(() => {
  jobs.clear();
  vi.clearAllMocks();
  jobs.set('job-b', { id: 'job-b' as Job['id'], tenantId: 'tenant-b' as Job['tenantId'], mspId: 'msp-1' as Job['mspId'], type: 'identity.disable-user', status: 'pending_approval', payload: {}, correlationId: 'c' as Job['correlationId'] });
});

describe('job routes tenant isolation', () => {
  it('serves a job through its own tenant', async () => {
    const res = await app.request('/tenants/tenant-b/jobs/job-b');
    expect(res.status).toBe(200);
  });

  it('answers 404 when tenant A asks for a job of tenant B', async () => {
    const res = await app.request('/tenants/tenant-a/jobs/job-b');
    expect(res.status).toBe(404);
  });

  it('answers 404 for a job of another MSP, even with the right tenant id', async () => {
    const res = await app.request('/tenants/tenant-b/jobs/job-b', { headers: { 'x-test-msp': 'msp-2' } });
    expect(res.status).toBe(404);
  });

  it('does not approve a foreign job', async () => {
    const res = await app.request('/tenants/tenant-a/jobs/job-b/approve', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(queue.approveJob).not.toHaveBeenCalled();
  });

  it('does not cancel a foreign job, and audits a real cancel', async () => {
    const foreign = await app.request('/tenants/tenant-a/jobs/job-b/cancel', { method: 'POST' });
    expect(foreign.status).toBe(404);
    expect(queue.cancelJob).not.toHaveBeenCalled();

    const own = await app.request('/tenants/tenant-b/jobs/job-b/cancel', { method: 'POST' });
    expect(own.status).toBe(200);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'job.cancel', result: 'success', tenantId: 'tenant-b' }));
  });

  it('does not reveal a sealed result of a foreign job', async () => {
    const res = await app.request('/tenants/tenant-a/jobs/job-b/reveal', { method: 'POST', body: JSON.stringify({ reason: 'Pruefung durch den Test' }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(404);
  });
});
