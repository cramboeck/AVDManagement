/**
 * Exchange Online: Postfaecher und Mailaktivitaet aus den Graph-Berichten
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getMailOverview } from '../services/inventory.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Postfachliste ist personenbezogen (wer wie viel Mail), daher jeder Abruf im Audit
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const overview = await getMailOverview(tenant);

  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'mail.usage.view',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    result: overview.available ? 'success' : 'failure',
    errorMessage: overview.available ? undefined : overview.reason,
    correlationId: (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId,
  });

  return c.json(overview);
});

export { app as mailRouter };
