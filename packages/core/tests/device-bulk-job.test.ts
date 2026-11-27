/**
 * Tests: Sammelaktion auf Geraeten (Vorschau je Geraet, Teilergebnis, Fehlerabbildung)
 */

import { describe, it, expect, vi } from 'vitest';
import { registerDeviceJobs } from '../src/jobs/device-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import { GraphApiError } from '../src/errors.js';
import type { DeviceProvider } from '../src/providers/device-provider.js';
import type { CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const base = { jobId: 'j' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
const devices = [
  { managedDeviceId: 'd1', deviceName: 'PC01' },
  { managedDeviceId: 'd2', deviceName: 'PC02' },
];

describe('device.bulk-action', () => {
  it('previews one change per device and warns before a mass restart', async () => {
    registerDeviceJobs({} as DeviceProvider);
    const preview = await getRegisteredJob('device.bulk-action')!.previewGenerator!({ ...base, payload: { action: 'restart', devices } });
    expect(preview.changes.map((c) => c.objectDisplayName)).toEqual(['PC01', 'PC02']);
    expect(preview.warnings[0]).toContain('ohne Rueckfrage');
  });

  it('keeps going after a failure and maps 404 to a readable message', async () => {
    const syncDevice = vi.fn(async (_c: unknown, id: string) => {
      if (id === 'd2') throw new GraphApiError(404, 'ResourceNotFound', 'gone');
    });
    registerDeviceJobs({ syncDevice } as unknown as DeviceProvider);
    const result = await getRegisteredJob('device.bulk-action')!.handler({ ...base, payload: { action: 'sync', devices } });
    expect(result.error?.code).toBe('DEVICE_BULK_PARTIAL');
    const outcomes = (result.data as { outcomes: Array<{ deviceName: string; success: boolean; message: string | null }> }).outcomes;
    expect(outcomes.find((o) => o.deviceName === 'PC02')?.message).toContain('Ziel nicht gefunden');
    expect(syncDevice).toHaveBeenCalledTimes(2);
  });

  it('refuses more than 50 devices in the preview', async () => {
    registerDeviceJobs({} as DeviceProvider);
    const many = Array.from({ length: 51 }, (_, i) => ({ managedDeviceId: `d${i}`, deviceName: `PC${i}` }));
    await expect(getRegisteredJob('device.bulk-action')!.previewGenerator!({ ...base, payload: { action: 'sync', devices: many } })).rejects.toThrow('Hoechstens 50');
  });
});
