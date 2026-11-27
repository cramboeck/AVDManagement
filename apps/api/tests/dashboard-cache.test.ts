/**
 * Tests: Dashboard-Zwischenspeicher je Tenant (frisch, veraltet, getrennt)
 */

import { describe, it, expect, vi } from 'vitest';
import { DashboardCache } from '../src/services/dashboard-cache.js';
import type { ManagedTenant, TenantDashboard } from '@zerostress/types';

const tenant = (id: string) => ({ id, displayName: id }) as unknown as ManagedTenant;
const dashboard = (id: string, n: number) => ({ tenant: { id }, attention: n, generatedAt: `t${n}` }) as unknown as TenantDashboard;

describe('DashboardCache', () => {
  it('serves a fresh entry without rebuilding and shares concurrent loads', async () => {
    let n = 0;
    const build = vi.fn(async (t: ManagedTenant) => dashboard(t.id, ++n));
    const cache = new DashboardCache(build, { now: () => 0 });
    const [a, b] = await Promise.all([cache.get(tenant('A')), cache.get(tenant('A'))]);
    expect(a).toBe(b);
    expect(await cache.get(tenant('A'))).toBe(a);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('returns the stale value immediately and refreshes in the background', async () => {
    let clock = 0;
    let n = 0;
    const build = vi.fn(async (t: ManagedTenant) => dashboard(t.id, ++n));
    const cache = new DashboardCache(build, { now: () => clock, maxAgeMs: 100, staleMs: 1000 });
    const first = await cache.get(tenant('A'));
    clock = 500;
    expect(await cache.get(tenant('A'))).toBe(first);
    await new Promise((r) => setTimeout(r, 0));
    expect(build).toHaveBeenCalledTimes(2);
    expect((await cache.get(tenant('A'))).generatedAt).toBe('t2');
  });

  it('waits for a rebuild when the entry is too old or refresh is requested', async () => {
    let clock = 0;
    let n = 0;
    const cache = new DashboardCache(async (t) => dashboard(t.id, ++n), { now: () => clock, maxAgeMs: 100, staleMs: 1000 });
    await cache.get(tenant('A'));
    clock = 5000;
    expect((await cache.get(tenant('A'))).generatedAt).toBe('t2');
    expect((await cache.get(tenant('A'), { refresh: true })).generatedAt).toBe('t3');
  });

  it('keeps tenants apart', async () => {
    const cache = new DashboardCache(async (t) => dashboard(t.id, 1), { now: () => 0 });
    const a = await cache.get(tenant('A'));
    const b = await cache.get(tenant('B'));
    expect((a.tenant as unknown as { id: string }).id).toBe('A');
    expect((b.tenant as unknown as { id: string }).id).toBe('B');
  });

  it('does not cache failures', async () => {
    const build = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce(dashboard('A', 1));
    const cache = new DashboardCache(build, { now: () => 0 });
    await expect(cache.get(tenant('A'))).rejects.toThrow('429');
    expect((await cache.get(tenant('A'))).attention).toBe(1);
  });
});
