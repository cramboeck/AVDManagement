/**
 * Job-Handler fuer das Geraete-Modul (Intune-Aktionen)
 */

import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { jobFailure } from './job-types.js';
import { DeviceProvider } from '../providers/device-provider.js';
import { mapWithLimit } from '../providers/arm-client.js';

interface DevicePayload {
  managedDeviceId: string;
  deviceName: string;
  quickScan?: boolean;
}

function failure(code: string, error: unknown): JobResult {
  return jobFailure(code, error);
}

function devicePreview(
  action: string,
  warnings: string[]
): (ctx: PreviewContext) => Promise<PreviewResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as DevicePayload;
    return {
      changes: [
        {
          objectType: 'device',
          objectId: payload.managedDeviceId,
          objectDisplayName: payload.deviceName,
          action: 'update',
          before: {},
          after: { [action]: true },
        },
      ],
      warnings,
      estimatedDurationSeconds: 10,
    };
  };
}

export type DeviceBulkAction = 'sync' | 'restart' | 'defender-scan';
export const DEVICE_BULK_MAX = 50;

interface DeviceBulkPayload {
  action: DeviceBulkAction;
  devices: Array<{ managedDeviceId: string; deviceName: string }>;
}

const bulkActionLabels: Record<DeviceBulkAction, string> = { sync: 'Synchronisieren', restart: 'Neu starten', 'defender-scan': 'Defender-Schnellscan' };

/** Intune-Aktion auf vielen Geraeten: eine Vorschau, ein Ergebnis je Geraet. */
function registerDeviceBulkJob(deviceProvider: DeviceProvider): void {
  registerJob(
    { type: 'device.bulk-action', displayName: 'Sammelaktion auf Geraeten', maxRetries: 0, timeoutSeconds: 900, concurrencyPerTenant: 1, requiresPreview: true },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as DeviceBulkPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      const outcomes = await mapWithLimit(payload.devices.slice(0, DEVICE_BULK_MAX), 5, async (d) => {
        try {
          if (payload.action === 'sync') await deviceProvider.syncDevice(providerCtx, d.managedDeviceId);
          else if (payload.action === 'restart') await deviceProvider.rebootDevice(providerCtx, d.managedDeviceId);
          else await deviceProvider.runDefenderScan(providerCtx, d.managedDeviceId, true);
          return { managedDeviceId: d.managedDeviceId, deviceName: d.deviceName, success: true, message: null as string | null };
        } catch (error) {
          return { managedDeviceId: d.managedDeviceId, deviceName: d.deviceName, success: false, message: jobFailure('X', error).error?.message ?? String(error) };
        }
      });
      const failed = outcomes.filter((o) => !o.success).length;
      const data = { action: payload.action, total: outcomes.length, succeeded: outcomes.length - failed, failed, outcomes } as unknown as Record<string, unknown>;
      if (failed === outcomes.length) return { success: false, data, error: { code: 'DEVICE_BULK_FAILED', message: `Auf allen ${outcomes.length} Geraeten fehlgeschlagen`, retryable: false } };
      if (failed > 0) return { success: false, data, error: { code: 'DEVICE_BULK_PARTIAL', message: `${failed} von ${outcomes.length} Geraeten fehlgeschlagen; Einzelheiten im Ergebnis`, retryable: false } };
      return { success: true, data };
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as DeviceBulkPayload;
      if (!payload.devices?.length) throw new Error('Keine Geraete angegeben');
      if (payload.devices.length > DEVICE_BULK_MAX) throw new Error(`Hoechstens ${DEVICE_BULK_MAX} Geraete je Sammelaktion`);
      const warnings =
        payload.action === 'restart'
          ? [`${payload.devices.length} Geraete starten ohne Rueckfrage neu; nicht gespeicherte Arbeit geht verloren. Fuer Benutzergeraete besser "Neustart mit Vorwarnung" je Geraet.`]
          : payload.action === 'sync'
            ? ['Wirkt erst, wenn die Geraete online sind.']
            : ['Schnellscan durch Defender; laeuft im Hintergrund auf den Geraeten.'];
      return {
        changes: payload.devices.map((d) => ({ objectType: 'device', objectId: d.managedDeviceId, objectDisplayName: d.deviceName, action: 'update' as const, before: {}, after: { aktion: bulkActionLabels[payload.action] } })),
        warnings,
        estimatedDurationSeconds: Math.ceil(payload.devices.length / 5) * 5,
      };
    }
  );
}

export function registerDeviceJobs(deviceProvider: DeviceProvider): void {
  registerDeviceBulkJob(deviceProvider);

  registerJob(
    {
      type: 'device.sync',
      displayName: 'Geraet synchronisieren',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 10,
      requiresPreview: true,
    },
    async (ctx: JobContext) => {
      const payload = ctx.payload as unknown as DevicePayload;
      try {
        await deviceProvider.syncDevice({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, payload.managedDeviceId);
        return { success: true, data: { managedDeviceId: payload.managedDeviceId, requestedAt: new Date().toISOString() } };
      } catch (error) {
        return failure('DEVICE_SYNC_FAILED', error);
      }
    },
    devicePreview('syncRequested', [
      'Intune fordert das Geraet auf, sich zu melden und Richtlinien abzurufen. Wirkt erst, wenn das Geraet online ist.',
    ])
  );

  registerJob(
    {
      type: 'device.restart',
      displayName: 'Geraet neu starten',
      maxRetries: 0,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    async (ctx: JobContext) => {
      const payload = ctx.payload as unknown as DevicePayload;
      try {
        await deviceProvider.rebootDevice({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, payload.managedDeviceId);
        return { success: true, data: { managedDeviceId: payload.managedDeviceId, requestedAt: new Date().toISOString() } };
      } catch (error) {
        return failure('DEVICE_RESTART_FAILED', error);
      }
    },
    devicePreview('restartRequested', [
      'Der Neustart erfolgt ohne Rueckfrage beim Benutzer; nicht gespeicherte Arbeit geht verloren.',
    ])
  );

  registerJob(
    {
      type: 'device.defender-scan',
      displayName: 'Defender-Scan starten',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 10,
      requiresPreview: true,
    },
    async (ctx: JobContext) => {
      const payload = ctx.payload as unknown as DevicePayload;
      try {
        await deviceProvider.runDefenderScan(
          { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
          payload.managedDeviceId,
          payload.quickScan !== false
        );
        return {
          success: true,
          data: { managedDeviceId: payload.managedDeviceId, quickScan: payload.quickScan !== false, requestedAt: new Date().toISOString() },
        };
      } catch (error) {
        return failure('DEVICE_SCAN_FAILED', error);
      }
    },
    async (ctx: PreviewContext) => {
      const payload = ctx.payload as unknown as DevicePayload;
      const quick = payload.quickScan !== false;
      return {
        changes: [
          {
            objectType: 'device',
            objectId: payload.managedDeviceId,
            objectDisplayName: payload.deviceName,
            action: 'update',
            before: {},
            after: { scan: quick ? 'quick' : 'full' },
          },
        ],
        warnings: quick
          ? []
          : ['Ein vollstaendiger Scan kann das Geraet fuer laengere Zeit spuerbar belasten.'],
        estimatedDurationSeconds: 10,
      };
    }
  );
}
