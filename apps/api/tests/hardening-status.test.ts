/**
 * Tests fuer den Haertungsstatus je Tenant (Provider gemockt, keine DB)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TenantId } from '@zerostress/types';

const provider = {
  getScheduleStatus: vi.fn(),
  listRunStates: vi.fn(),
};

vi.mock('../src/services/microsoft-clients.js', () => ({ getRemediationProvider: () => provider }));

const { getHardeningStatus } = await import('../src/services/hardening.js');

const report = JSON.stringify({ schema: 'zsc.hardening/1', collectedAt: '2026-11-25T11:00:00Z', passed: 25, failed: 'smb1-disabled', notApplicable: [], unreadable: [] });

function state(output: string | null, updatedAt: string | null) {
  return { detectionState: 'fail', remediationState: 'unknown', preOutput: output, postOutput: null, detectionError: null, remediationError: null, updatedAt, syncedAt: null, source: 'script' };
}

describe('getHardeningStatus', () => {
  beforeEach(() => {
    provider.getScheduleStatus.mockReset();
    provider.listRunStates.mockReset();
  });

  it('reports disabled without reading device states when the script is absent', async () => {
    provider.getScheduleStatus.mockResolvedValue({ tenantScriptId: null, hourly: false, daily: false, allDevices: false });
    const status = await getHardeningStatus('tenant-a' as TenantId, 'corr');
    expect(status).toMatchObject({ enabled: false, tenantScriptId: null, summary: null });
    expect(status.catalog.length).toBeGreaterThan(20);
    expect(provider.listRunStates).not.toHaveBeenCalled();
  });

  it('summarizes the device reports of the tenant it was asked for', async () => {
    provider.getScheduleStatus.mockResolvedValue({ tenantScriptId: 'ts-h', hourly: false, daily: true, allDevices: true });
    provider.listRunStates.mockResolvedValue([{ managedDeviceId: 'd1', deviceName: 'PC01', state: state(report, new Date().toISOString()) }]);
    const status = await getHardeningStatus('tenant-a' as TenantId, 'corr');
    expect(status.enabled).toBe(true);
    expect(status.summary?.devices[0]).toMatchObject({ deviceName: 'PC01', failedIds: ['smb1-disabled'] });
    expect(provider.getScheduleStatus).toHaveBeenCalledWith({ tenantId: 'tenant-a', correlationId: 'corr' }, 'hardening');
    expect(provider.listRunStates).toHaveBeenCalledWith({ tenantId: 'tenant-a', correlationId: 'corr' }, 'ts-h');
  });

  it('keeps the last results readable after the assignment was removed', async () => {
    provider.getScheduleStatus.mockResolvedValue({ tenantScriptId: 'ts-h', hourly: false, daily: false, allDevices: false });
    provider.listRunStates.mockResolvedValue([{ managedDeviceId: 'd1', deviceName: 'PC01', state: state(report, null) }]);
    const status = await getHardeningStatus('tenant-a' as TenantId);
    expect(status.enabled).toBe(false);
    expect(status.summary?.staleDevices).toBe(1);
  });

  it('passes Graph errors (403, 429) through to the caller', async () => {
    provider.getScheduleStatus.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
    await expect(getHardeningStatus('tenant-a' as TenantId)).rejects.toThrow('Forbidden');
  });
});
