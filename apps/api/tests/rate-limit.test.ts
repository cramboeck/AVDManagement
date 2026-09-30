/**
 * Tests fuer Rate-Limits und Groessenbegrenzung
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { bodyLimits, createRateLimiter, rateKey } from '../src/middleware/security.js';

function appWith(limiter: ReturnType<typeof createRateLimiter>) {
  const app = new Hono();
  app.use('/x/*', limiter.middleware);
  app.get('/x/ping', (c) => c.json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  beforeEach(() => {
    delete process.env.RATE_LIMIT_DISABLED;
  });

  it('allows up to the limit and then answers 429 with Retry-After', async () => {
    const limiter = createRateLimiter({ name: 't', limit: 3, windowMs: 60_000, key: () => 'same' });
    const app = appWith(limiter);
    for (let i = 0; i < 3; i += 1) {
      const res = await app.request('/x/ping');
      expect(res.status).toBe(200);
      expect(res.headers.get('RateLimit-Remaining')).toBe(String(2 - i));
    }
    const blocked = await app.request('/x/ping');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = (await blocked.json()) as { type: string };
    expect(body.type).toContain('rate-limited');
  });

  it('keeps separate buckets per key and resets after the window', async () => {
    let now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const limiter = createRateLimiter({ name: 't', limit: 1, windowMs: 1000 });
      const app = appWith(limiter);
      const a = await app.request('/x/ping', { headers: { Authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaa' } });
      const b = await app.request('/x/ping', { headers: { Authorization: 'Bearer bbbbbbbbbbbbbbbbbbbbbbbb' } });
      const a2 = await app.request('/x/ping', { headers: { Authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaa' } });
      expect([a.status, b.status, a2.status]).toEqual([200, 200, 429]);
      now += 1500;
      const a3 = await app.request('/x/ping', { headers: { Authorization: 'Bearer aaaaaaaaaaaaaaaaaaaaaaaa' } });
      expect(a3.status).toBe(200);
    } finally {
      Date.now = realNow;
    }
  });

  it('can be switched off for load tests', async () => {
    process.env.RATE_LIMIT_DISABLED = 'true';
    const limiter = createRateLimiter({ name: 't', limit: 1, windowMs: 60_000, key: () => 'same' });
    const app = appWith(limiter);
    await app.request('/x/ping');
    expect((await app.request('/x/ping')).status).toBe(200);
  });

  it('never uses the raw token as key', async () => {
    const app = new Hono();
    let key = '';
    app.get('/k', (c) => {
      key = rateKey(c);
      return c.text('ok');
    });
    await app.request('/k', { headers: { Authorization: 'Bearer supersecrettokenvalue123' } });
    expect(key.startsWith('t:')).toBe(true);
    expect(key).not.toContain('supersecret');
  });
});

describe('bodyLimits', () => {
  it('rejects JSON bodies above 1 MB but accepts large uploads on upload paths', async () => {
    const app = new Hono();
    app.use('*', bodyLimits);
    app.post('/tenants/t/jobs', async (c) => c.json({ size: (await c.req.text()).length }));
    app.put('/packages/p/artifact', async (c) => c.json({ size: (await c.req.text()).length }));
    const big = 'x'.repeat(1024 * 1024 + 1);
    const rejected = await app.request('/tenants/t/jobs', { method: 'POST', body: big, headers: { 'Content-Length': String(big.length) } });
    expect(rejected.status).toBe(413);
    const accepted = await app.request('/packages/p/artifact', { method: 'PUT', body: big, headers: { 'Content-Length': String(big.length) } });
    expect(accepted.status).toBe(200);
  });
});
