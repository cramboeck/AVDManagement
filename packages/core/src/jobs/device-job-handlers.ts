/**
 * Job-Handler fuer das Geraete-Modul (Intune-Aktionen)
 */

import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { DeviceProvider } from '../providers/device-provider.js';

interface DevicePayload {
  managedDeviceId: string;
  deviceName: string;
  quickScan?: boolean;
}

function failure(code: string, error: unknown): JobResult {
  return {
    success: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    },
  };
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

export function registerDeviceJobs(deviceProvider: DeviceProvider): void {
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
