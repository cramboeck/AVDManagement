/**
 * Dashboard-Aggregation
 *
 * Jede Quelle laeuft einzeln mit Zeitlimit; ein Ausfall wird zur Kachel mit
 * Grund, nie zum Gesamtfehler. Es werden nur Kennzahlen geliefert, keine
 * personenbezogenen Daten, daher kein Audit-Eintrag pro Aufruf.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import type {
  AvdOverview,
  DashboardTile,
  JobStats,
  ManagedTenant,
  SecurityOverview,
  TenantDashboard,
  TenantId,
  UserStats,
} from '@zerostress/types';
import { db, jobs } from '../db/index.js';
import { getAvdProvider, getIdentityProvider } from './microsoft-clients.js';
import { getAlertStats } from './alerting.js';

const SECURITY_WINDOW_HOURS = 24;
const FAILURE_ATTENTION_THRESHOLD = 5;
const MODERN_CLIENTS = new Set(['Browser', 'Mobile Apps and Desktop clients']);

class TimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out`);
    this.name = 'TimeoutError';
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ok = <T>(data: T): DashboardTile<T> => ({ status: 'ok', data, reason: null });
const unavailable = <T>(reason: string): DashboardTile<T> => ({ status: 'unavailable', data: null, reason });

async function tile<T>(load: () => Promise<DashboardTile<T>>): Promise<DashboardTile<T>> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof TimeoutError) {
      return { status: 'error', data: null, reason: 'timeout' };
    }
    return { status: 'error', data: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function buildTenantDashboard(tenant: ManagedTenant): Promise<TenantDashboard> {
  const ctx = { tenantId: tenant.id, correlationId: randomUUID() };
  const connected = tenant.connectionStatus === 'connected';

  const [avd, users, security, jobStats, alertStats] = await Promise.all([
    connected
      ? tile(() => withTimeout(getAvdProvider().getAvdOverview(ctx), 20000, 'avd').then(ok))
      : unavailable<AvdOverview>('tenant-not-connected'),
    connected
      ? tile(() => withTimeout(getIdentityProvider().getUserStats(ctx), 10000, 'users').then(ok))
      : unavailable<UserStats>('tenant-not-connected'),
    connected ? tile(() => loadSecurity(ctx)) : unavailable<SecurityOverview>('tenant-not-connected'),
    tile(() => loadJobStats(tenant.id).then(ok)),
    tile(() => getAlertStats(tenant.id).then(ok)),
  ]);

  const dashboard: TenantDashboard = {
    tenant,
    avd,
    users,
    security,
    jobs: jobStats,
    alerts: alertStats,
    attention: 0,
    generatedAt: new Date().toISOString(),
  };
  dashboard.attention = countAttention(dashboard);
  return dashboard;
}

async function loadSecurity(ctx: { tenantId: TenantId; correlationId: string }): Promise<DashboardTile<SecurityOverview>> {
  const since = new Date(Date.now() - SECURITY_WINDOW_HOURS * 3600 * 1000).toISOString();
  const result = await withTimeout(
    getIdentityProvider().listSignIns(ctx, { top: 500, since }),
    15000,
    'security'
  );

  if (!result.available) {
    return unavailable(result.reason);
  }

  const events = result.data;
  const failures = events.filter((e) => e.outcome === 'failure');
  const successes = events.filter((e) => e.outcome === 'success');

  return ok({
    windowHours: SECURITY_WINDOW_HOURS,
    signIns: events.length,
    failures: failures.length,
    usersWithFailures: new Set(failures.map((e) => e.userId)).size,
    legacyAuthSuccesses: successes.filter((e) => e.clientAppUsed && !MODERN_CLIENTS.has(e.clientAppUsed)).length,
    riskySuccesses: successes.filter((e) => e.riskLevel === 'medium' || e.riskLevel === 'high').length,
  });
}

async function loadJobStats(tenantId: string): Promise<JobStats> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  const rows = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(
      and(
        eq(jobs.tenantId, tenantId),
        or(inArray(jobs.status, ['pending_approval', 'queued', 'running']), gte(jobs.createdAt, since))
      )
    );

  const stats: JobStats = { pendingApproval: 0, running: 0, failedLast24h: 0, completedLast24h: 0 };
  for (const row of rows) {
    switch (row.status) {
      case 'pending_approval':
        stats.pendingApproval += 1;
        break;
      case 'queued':
      case 'running':
        stats.running += 1;
        break;
      case 'failed':
        stats.failedLast24h += 1;
        break;
      case 'completed':
        stats.completedLast24h += 1;
        break;
    }
  }
  return stats;
}

function countAttention(d: TenantDashboard): number {
  let count = 0;
  if (d.tenant.connectionStatus !== 'connected') count += 1;
  for (const t of [d.avd, d.users, d.security, d.jobs, d.alerts]) {
    if (t.status === 'error') count += 1;
  }
  if (d.alerts.data && d.alerts.data.open > 0) count += 1;
  if (d.avd.data) {
    if (d.avd.data.unavailableHosts > 0) count += 1;
    if (d.avd.data.warnings.length > 0) count += 1;
  }
  if (d.security.data) {
    if (d.security.data.failures >= FAILURE_ATTENTION_THRESHOLD) count += 1;
    if (d.security.data.legacyAuthSuccesses > 0) count += 1;
    if (d.security.data.riskySuccesses > 0) count += 1;
  }
  if (d.jobs.data) {
    if (d.jobs.data.pendingApproval > 0) count += 1;
    if (d.jobs.data.failedLast24h > 0) count += 1;
  }
  return count;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
