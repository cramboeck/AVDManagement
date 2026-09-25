/**
 * Geraete-Routen (Intune + Defender for Endpoint)
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getDeviceProvider } from '../services/microsoft-clients.js';
import type { DeviceSecurityPosture, TenantId } from '@zerostress/types';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

function ctxFor(tenantId: TenantId, correlationHeader: string | undefined) {
  return { tenantId, correlationId: correlationHeader ?? randomUUID() };
}

function notFound(deviceId: string) {
  return {
    type: 'https://api.zerostress.io/problems/not-found',
    title: 'Device not found',
    status: 404,
    detail: `Device '${deviceId}' not found`,
  };
}

// Geraetebestand beider Quellen
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const inventory = await getDeviceProvider().listDevices(ctxFor(tenant.id, c.req.header('X-Correlation-ID')));
  return c.json(inventory);
});

app.get('/:deviceId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const deviceId = c.req.param('deviceId');

  const device = await getDeviceProvider().getDevice(ctxFor(tenant.id, c.req.header('X-Correlation-ID')), deviceId);
  if (!device) {
    return c.json(notFound(deviceId), 404);
  }
  return c.json(device);
});

// Schwachstellen und fehlende Sicherheitsupdates (nur fuer Defender-onboardete Geraete)
app.get('/:deviceId/security', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const deviceId = c.req.param('deviceId');
  const ctx = ctxFor(tenant.id, c.req.header('X-Correlation-ID'));

  const device = await getDeviceProvider().getDevice(ctx, deviceId);
  if (!device) {
    return c.json(notFound(deviceId), 404);
  }

  if (!device.defender) {
    const notOnboarded = {
      available: false as const,
      reason: 'not-onboarded' as const,
      missingPermission: null,
      detail: null,
    };
    const posture: DeviceSecurityPosture = { vulnerabilities: notOnboarded, missingKbs: notOnboarded };
    return c.json(posture);
  }

  return c.json(await getDeviceProvider().getSecurityPosture(ctx, device.defender.machineId));
});

export { app as devicesRouter };
