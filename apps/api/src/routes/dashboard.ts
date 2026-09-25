/**
 * Dashboard-Routen: pro Tenant und ueber alle Tenants der MSP
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db, managedTenants } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware } from '../middleware/tenant-context.js';
import { buildTenantDashboard, mapWithConcurrency } from '../services/dashboard.js';
import { toManagedTenant } from '../services/tenant-mapper.js';

const TENANT_CONCURRENCY = 3;

const tenantDashboardRouter = new Hono();
tenantDashboardRouter.use('*', authMiddleware);
tenantDashboardRouter.use('*', tenantContextMiddleware);

tenantDashboardRouter.get('/', async (c) => {
  const tenant = c.get('tenant');
  return c.json(await buildTenantDashboard(tenant));
});

const dashboardRouter = new Hono();
dashboardRouter.use('*', authMiddleware);

// MSP-Sicht: alle aktiven Tenants, nach Aufmerksamkeitsbedarf sortiert
dashboardRouter.get('/', async (c) => {
  const auth = c.get('auth');

  const rows = await db.query.managedTenants.findMany({
    where: and(eq(managedTenants.mspId, auth.mspId), eq(managedTenants.isActive, true)),
    orderBy: (t, { asc }) => [asc(t.displayName)],
  });

  const items = await mapWithConcurrency(rows.map(toManagedTenant), TENANT_CONCURRENCY, buildTenantDashboard);
  items.sort(
    (a, b) => b.attention - a.attention || a.tenant.displayName.localeCompare(b.tenant.displayName, 'de')
  );

  return c.json({ items, generatedAt: new Date().toISOString() });
});

export { tenantDashboardRouter, dashboardRouter };
