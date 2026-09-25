/**
 * Alerts: Liste je Tenant, Bestaetigen und Schliessen (mit Audit), manuelle Auswertung
 */

import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import { evaluateTenant, getAlertStats, listAlerts, setAlertStatus } from '../services/alerting.js';
import type { AlertStatus, CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

app.get('/', async (c) => {
  const tenant = c.get('tenant');
  const statusParam = c.req.query('status');
  const status = statusParam === 'open' || statusParam === 'acknowledged' || statusParam === 'resolved' ? statusParam : undefined;
  const [items, stats] = await Promise.all([listAlerts(tenant.id, status), getAlertStats(tenant.id)]);
  return c.json({ items, stats });
});

// Sofort auswerten statt auf den Takt zu warten
app.post('/evaluate', requireRole('engineer'), requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const created = await evaluateTenant({ id: tenant.id, mspId: tenant.mspId, displayName: tenant.displayName });
  return c.json({ created: created.length });
});

async function transition(c: Context, status: AlertStatus) {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const alertId = c.req.param('alertId');
  const updated = await setAlertStatus(tenant.id, alertId, status, auth.user.id);
  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: `alert.${status}`,
    targetType: 'alert',
    targetId: alertId,
    targetDisplayName: updated?.title ?? alertId,
    afterState: { status },
    result: updated ? 'success' : 'failure',
    errorMessage: updated ? undefined : 'Alert not found',
    correlationId: randomUUID() as CorrelationId,
  });
  if (!updated) {
    return c.json({ type: 'https://api.zerostress.io/problems/not-found', title: 'Alert not found', status: 404 }, 404);
  }
  return c.json(updated);
}

app.post('/:alertId/acknowledge', requireRole('engineer'), (c) => transition(c, 'acknowledged'));
app.post('/:alertId/resolve', requireRole('engineer'), (c) => transition(c, 'resolved'));
app.post('/:alertId/reopen', requireRole('engineer'), (c) => transition(c, 'open'));

export { app as alertsRouter };
