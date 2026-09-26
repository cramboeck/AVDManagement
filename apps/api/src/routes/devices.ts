/**
 * Geraete-Routen (Intune + Defender for Endpoint)
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getDeviceProvider, getTeamViewerProvider, getHuntingProvider } from '../services/microsoft-clients.js';
import { mergeSoftware } from '@zerostress/core';
import { getDeviceInventory, findDevice } from '../services/inventory.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { CorrelationId, DeviceSecurityPosture, DeviceSoftwareInventory, TenantId } from '@zerostress/types';

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

// Netzwerkschnittstellen laut Defender-Sensor
app.get('/:deviceId/network', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const deviceId = c.req.param('deviceId');
  const ctx = ctxFor(tenant.id, c.req.header('X-Correlation-ID'));

  const device = await findDevice(tenant, deviceId);
  if (!device) {
    return c.json(notFound(deviceId), 404);
  }
  if (!device.defender) {
    return c.json({ available: false, reason: 'not-onboarded', missingPermission: null, detail: null });
  }

  return c.json(await getDeviceProvider().getDeviceNetwork(ctx, device.defender.machineId));
});

// Netzwerkverbindungen des Geraets aus Advanced Hunting (Defender for Endpoint Plan 2)
app.get('/:deviceId/connections', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const deviceId = c.req.param('deviceId');
  const days = Number(c.req.query('days') ?? '7');
  const ctx = ctxFor(tenant.id, c.req.header('X-Correlation-ID'));

  const device = await findDevice(tenant, deviceId);
  if (!device) {
    return c.json(notFound(deviceId), 404);
  }
  if (!device.defender) {
    return c.json({ available: false, reason: 'not-onboarded', missingPermission: null, detail: null });
  }
  const report = await getHuntingProvider().getDeviceConnections(ctx, device.defender.machineId, days);
  // Zieladressen und Prozesse koennen Rueckschluesse auf Nutzung zulassen: Abruf im Audit
  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'device.connections.view',
    targetType: 'device',
    targetId: device.id,
    targetDisplayName: device.name,
    afterState: report.available ? { days: report.data.days, destinations: report.data.items.length } : undefined,
    result: report.available ? 'success' : 'failure',
    errorMessage: report.available ? undefined : report.reason,
    correlationId: ctx.correlationId as CorrelationId,
  });
  return c.json(report);
});

// Softwareinventar: Intune (erkannte Apps, mit Version) plus Defender (Vulnerability Management)
app.get('/:deviceId/software', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const deviceId = c.req.param('deviceId');
  const ctx = ctxFor(tenant.id, c.req.header('X-Correlation-ID'));

  const device = await findDevice(tenant, deviceId);
  if (!device) {
    return c.json(notFound(deviceId), 404);
  }
  const notOnboarded = { available: false as const, reason: 'not-onboarded' as const, missingPermission: null, detail: null };
  const provider = getDeviceProvider();
  const [intune, defender] = await Promise.all([
    device.intune ? provider.listDetectedApps(ctx, device.intune.managedDeviceId) : Promise.resolve(notOnboarded),
    device.defender ? provider.listDefenderSoftware(ctx, device.defender.machineId) : Promise.resolve(notOnboarded),
  ]);
  if (!intune.available && !defender.available) {
    const inventory: DeviceSoftwareInventory = intune.reason === 'not-onboarded' ? defender : intune;
    return c.json(inventory);
  }
  const items = mergeSoftware(intune.available ? intune.data : [], defender.available ? defender.data : []);
  const inventory: DeviceSoftwareInventory = {
    available: true,
    data: {
      items,
      intune: intune.available ? { available: true, data: { count: intune.data.length } } : intune,
      defender: defender.available ? { available: true, data: { count: defender.data.length } } : defender,
    },
  };
  return c.json(inventory);
});

// Remotehilfe: Geraet in TeamViewer finden (kein Sitzungsstart)
app.get('/:deviceId/remote-support', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const device = await findDevice(tenant, c.req.param('deviceId'));
  if (!device) return c.json(notFound(c.req.param('deviceId')), 404);
  return c.json(await getTeamViewerProvider().findByHostname(device.name));
});

// Remotehilfe: Sitzungsstart mit Begruendung und Audit; der Client baut die Verbindung auf
app.post('/:deviceId/remote-support/session', requireRole('engineer'), requireConnectedTenant, zValidator('json', revealSchema), async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const deviceId = c.req.param('deviceId');
  const { reason } = c.req.valid('json');
  const correlationId = (c.req.header('X-Correlation-ID') ?? randomUUID()) as CorrelationId;
  const device = await findDevice(tenant, deviceId);
  if (!device) return c.json(notFound(deviceId), 404);

  const auditBase = {
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'remote.session.start',
    targetType: 'device',
    targetId: device.id,
    targetDisplayName: device.name,
    afterState: { provider: 'teamviewer', reason },
    correlationId,
  };
  const match = await getTeamViewerProvider().findByHostname(device.name);
  if (!match.available || !match.data.found || !match.data.uri) {
    await audit.log({ ...auditBase, result: 'failure', errorMessage: match.available ? 'Device not found in TeamViewer' : match.reason });
    return c.json({ type: 'https://api.zerostress.io/problems/not-found', title: 'Device not found in TeamViewer', status: 404 }, 404);
  }
  await audit.log({ ...auditBase, afterState: { ...auditBase.afterState, teamViewerDeviceId: match.data.deviceId }, result: 'success' });
  return c.json({ uri: match.data.uri, alias: match.data.alias, online: match.data.online });
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
