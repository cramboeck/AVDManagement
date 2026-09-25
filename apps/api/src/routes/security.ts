/**
 * Sicherheits-Routen: tenantweite Anmelde- und Verzeichnisprotokolle
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getIdentityProvider } from '../services/microsoft-clients.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import { buildSecurityPosture } from '../services/posture.js';
import type { CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

function parseTop(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Sicherheitslage: Scores, MFA, Alerts, Verteilungen (nur Kennzahlen)
app.get('/posture', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  return c.json(await buildSecurityPosture(tenant.id));
});

// Anmeldungen im Tenant (Sicherheitsmonitoring: woher, womit, mit welchem Ergebnis)
app.get('/sign-ins', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const correlationId = (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId;

  const result = await getIdentityProvider().listSignIns(
    { tenantId: tenant.id, correlationId },
    {
      top: parseTop(c.req.query('top'), 100),
      since: c.req.query('since'),
      failuresOnly: c.req.query('failuresOnly') === 'true',
    }
  );

  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'security.sign-ins.view',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    result: result.available ? 'success' : 'failure',
    errorMessage: result.available ? undefined : result.reason,
    correlationId,
  });

  return c.json(result);
});

// Verzeichnisaenderungen im Tenant
app.get('/audit', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const correlationId = (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId;

  const result = await getIdentityProvider().listDirectoryAudits(
    { tenantId: tenant.id, correlationId },
    {
      top: parseTop(c.req.query('top'), 100),
      since: c.req.query('since'),
    }
  );

  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'security.directory-audit.view',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    result: result.available ? 'success' : 'failure',
    errorMessage: result.available ? undefined : result.reason,
    correlationId,
  });

  return c.json(result);
});

export { app as securityRouter };
