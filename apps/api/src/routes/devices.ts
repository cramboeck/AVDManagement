/**
 * Geraete-Routen (Intune + Defender for Endpoint)
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getDeviceProvider } from '../services/microsoft-clients.js';
import { getDeviceInventory, findDevice } from '../services/inventory.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { CorrelationId, DeviceSecurityPosture, TenantId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

// Aufdecken von Geheimnissen verlangt eine Begruendung, die im Audit landet
const revealSchema = z.object({
  reason: z.string().trim().min(10, 'Begruendung mit mindestens 10 Zeichen erforderlich').max(500),
});

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

// Geraetebestand beider Quellen aus dem Snapshot (mit Stand)
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  return c.json(await getDeviceInventory(tenant));
});

app.get('/:deviceId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const deviceId = c.req.param('deviceId');

  const device = await findDevice(tenant, deviceId);
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

  const device = await findDevice(tenant, deviceId);
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
    const posture: DeviceSecurityPosture = {
      vulnerabilities: notOnboarded,
      missingKbs: notOnboarded,
      missingKbsSource: null,
      software: notOnboarded,
    };
    return c.json(posture);
  }

  return c.json(await getDeviceProvider().getSecurityPosture(ctx, device.defender.machineId));
});

// Wiederherstellung: nur Metadaten (welche Schluessel existieren)
app.get('/:deviceId/recovery', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const deviceId = c.req.param('deviceId');
  const ctx = ctxFor(tenant.id, c.req.header('X-Correlation-ID'));

  const device = await findDevice(tenant, deviceId);
  if (!device) {
    return c.json(notFound(deviceId), 404);
  }

  return c.json(await getDeviceProvider().getRecoveryMetadata(ctx, device.azureAdDeviceId));
});

app.post(
  '/:deviceId/recovery/bitlocker/:keyId/reveal',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', revealSchema),
  async (c) => {
    const tenant = c.get('tenant');
    const auth = c.get('auth');
    const deviceId = c.req.param('deviceId');
    const keyId = c.req.param('keyId');
    const { reason } = c.req.valid('json');
    const correlationId = (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId;
    const ctx = { tenantId: tenant.id, correlationId };
    const provider = getDeviceProvider();

    const device = await findDevice(tenant, deviceId);
    if (!device) {
      return c.json(notFound(deviceId), 404);
    }

    // Der Schluessel muss zu diesem Geraet gehoeren; Schluessel-IDs sind global
    const metadata = await provider.getRecoveryMetadata(ctx, device.azureAdDeviceId);
    const known = metadata.bitlocker.available && metadata.bitlocker.data.some((k) => k.id === keyId);
    const auditBase = {
      mspId: auth.mspId,
      tenantId: tenant.id,
      userId: auth.user.id,
      action: 'security.recovery.bitlocker.reveal',
      targetType: 'device',
      targetId: device.id,
      targetDisplayName: device.name,
      afterState: { keyId, reason },
      correlationId,
    };

    if (!known) {
      await audit.log({ ...auditBase, result: 'failure', errorMessage: 'Key does not belong to device' });
      return c.json(notFound(`${deviceId}/bitlocker/${keyId}`), 404);
    }

    try {
      const revealed = await provider.revealBitLockerKey(ctx, keyId);
      await audit.log({ ...auditBase, result: 'success' });
      return c.json(revealed);
    } catch (error) {
      await audit.log({ ...auditBase, result: 'failure', errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
);

app.post(
  '/:deviceId/recovery/laps/reveal',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', revealSchema),
  async (c) => {
    const tenant = c.get('tenant');
    const auth = c.get('auth');
    const deviceId = c.req.param('deviceId');
    const { reason } = c.req.valid('json');
    const correlationId = (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId;
    const ctx = { tenantId: tenant.id, correlationId };
    const provider = getDeviceProvider();

    const device = await findDevice(tenant, deviceId);
    if (!device) {
      return c.json(notFound(deviceId), 404);
    }
    if (!device.azureAdDeviceId) {
      return c.json(
        {
          type: 'https://api.zerostress.io/problems/validation',
          title: 'Device has no Entra device id',
          status: 400,
          detail: 'LAPS credentials are stored per Entra device object',
        },
        400
      );
    }

    const auditBase = {
      mspId: auth.mspId,
      tenantId: tenant.id,
      userId: auth.user.id,
      action: 'security.recovery.laps.reveal',
      targetType: 'device',
      targetId: device.id,
      targetDisplayName: device.name,
      afterState: { reason },
      correlationId,
    };

    try {
      const revealed = await provider.revealLocalCredentials(ctx, device.azureAdDeviceId);
      await audit.log({ ...auditBase, result: 'success' });
      return c.json(revealed);
    } catch (error) {
      await audit.log({ ...auditBase, result: 'failure', errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
);

export { app as devicesRouter };
