/**
 * Schwachstellen-Routen: Tenant-Sicht (Defender) plus oeffentliche
 * Anreicherung und KI-Erklaerung
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getDeviceProvider } from '../services/microsoft-clients.js';
import { enrichCve, CVE_PATTERN } from '../services/cve-enrichment.js';
import { explainCve, getCachedExplanation, isExplainerConfigured } from '../services/cve-explainer.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { CorrelationId, CveDetail, VulnerabilitySeverity } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

const SEVERITIES: VulnerabilitySeverity[] = ['Critical', 'High', 'Medium', 'Low'];

function invalidCve(cveId: string) {
  return {
    type: 'https://api.zerostress.io/problems/validation',
    title: 'Invalid CVE id',
    status: 400,
    detail: `'${cveId}' is not a CVE identifier`,
  };
}

// Schwachstellen im Tenant, nach CVE zusammengefasst
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const severityParam = c.req.query('severity');
  const severity = SEVERITIES.find((s) => s === severityParam);

  const result = await getDeviceProvider().getTenantVulnerabilities(
    { tenantId: tenant.id, correlationId: c.req.header('X-Correlation-ID') ?? randomUUID() },
    { severity, top: parseInt(c.req.query('top') ?? '300', 10) }
  );

  return c.json(result);
});

// Detail: Defender-Sicht, betroffene Geraete, KEV/EPSS/NVD, gecachte Erklaerung
app.get('/:cveId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const cveId = c.req.param('cveId').toUpperCase();
  if (!CVE_PATTERN.test(cveId)) {
    return c.json(invalidCve(cveId), 400);
  }

  const ctx = { tenantId: tenant.id, correlationId: c.req.header('X-Correlation-ID') ?? randomUUID() };
  const provider = getDeviceProvider();

  const [defender, machines, enrichment, explanation] = await Promise.all([
    provider.getVulnerability(ctx, cveId),
    provider.getVulnerabilityMachines(ctx, cveId),
    enrichCve(cveId),
    getCachedExplanation(cveId),
  ]);

  const detail: CveDetail = {
    cveId,
    defender,
    machines,
    enrichment,
    explanation,
    explanationAvailable: isExplainerConfigured(),
  };

  return c.json(detail);
});

// KI-Erklaerung erzeugen (oeffentliche Daten, Ergebnis global gecacht)
app.post('/:cveId/explain', requireRole('engineer'), requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const cveId = c.req.param('cveId').toUpperCase();
  if (!CVE_PATTERN.test(cveId)) {
    return c.json(invalidCve(cveId), 400);
  }

  if (!isExplainerConfigured()) {
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/ai-not-configured',
        title: 'AI explanation not configured',
        status: 503,
        detail: 'ANTHROPIC_API_KEY is not set on the API server',
      },
      503
    );
  }

  const correlationId = (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId;
  const ctx = { tenantId: tenant.id, correlationId };
  const provider = getDeviceProvider();

  const [defender, enrichment] = await Promise.all([provider.getVulnerability(ctx, cveId), enrichCve(cveId)]);

  try {
    const explanation = await explainCve({
      cveId,
      defender: defender.available ? defender.data : null,
      enrichment,
    });

    await audit.log({
      mspId: auth.mspId,
      tenantId: tenant.id,
      userId: auth.user.id,
      action: 'security.cve.explain',
      targetType: 'cve',
      targetId: cveId,
      targetDisplayName: cveId,
      afterState: { model: explanation.model, urgency: explanation.urgency },
      result: 'success',
      correlationId,
    });

    return c.json(explanation);
  } catch (error) {
    await audit.log({
      mspId: auth.mspId,
      tenantId: tenant.id,
      userId: auth.user.id,
      action: 'security.cve.explain',
      targetType: 'cve',
      targetId: cveId,
      targetDisplayName: cveId,
      result: 'failure',
      errorMessage: error instanceof Error ? error.message : String(error),
      correlationId,
    });
    throw error;
  }
});

export { app as vulnerabilitiesRouter };
