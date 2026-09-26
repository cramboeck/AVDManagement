/**
 * Tests fuer den Softwareabgleich und die Sammelaktion
 */

import { describe, it, expect, vi } from 'vitest';
import { buildSoftwareOverview, matchBlockRule, matchWingetId, versionStatus } from '../src/apps/software-catalog.js';
import { WINGET_BASE_SET } from '../src/apps/winget.js';
import { registerWingetBulkJob } from '../src/jobs/winget-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { RemediationOperations, RemediationRunState_ } from '../src/providers/remediation-provider.js';
import type { CorrelationId, JobId, MspId, SoftwareBlockRule, SoftwareInventoryItem, TenantId, UserId } from '@zerostress/types';

const packages = [{ id: 'p1', name: 'UniGetUI', wingetId: 'Devolutions.UnigetUI', version: '2026.3.0', latestVersion: '2026.4.0' }];
const rules: SoftwareBlockRule[] = [
  { id: 'r1', kind: 'name', pattern: 'teamviewer', note: null, createdByEmail: 'x', createdAt: 'c' },
  { id: 'r2', kind: 'winget-id', pattern: 'Zoom.Zoom', note: null, createdByEmail: 'x', createdAt: 'c' },
];

describe('software catalogue matching', () => {
  it('matches names to packages first, then the base set', () => {
    expect(matchWingetId('UniGetUI 2026.3.0', packages, WINGET_BASE_SET)).toEqual({ wingetId: 'Devolutions.UnigetUI', packageId: 'p1' });
    expect(matchWingetId('Google Chrome', [], WINGET_BASE_SET)).toEqual({ wingetId: 'Google.Chrome', packageId: null });
    expect(matchWingetId('7-Zip 24.08 (x64 edition)', [], WINGET_BASE_SET)).toEqual({ wingetId: '7zip.7zip', packageId: null });
    expect(matchWingetId('Ab', [], WINGET_BASE_SET)).toBeNull();
  });

  it('compares versions and applies block rules', () => {
    expect(versionStatus('129.0.1', '130.0')).toBe('outdated');
    expect(versionStatus('130.0.6723.117', '130.0')).toBe('current');
    expect(versionStatus(null, '1.0')).toBe('unknown');
    expect(matchBlockRule('TeamViewer 15', null, rules)?.id).toBe('r1');
    expect(matchBlockRule('Zoom Workplace', 'Zoom.Zoom', rules)?.id).toBe('r2');
    expect(matchBlockRule('Notepad++', 'Notepad++.Notepad++', rules)).toBeNull();
  });

  it('groups versions per software with outdated device counts and totals', () => {
    const items: SoftwareInventoryItem[] = [
      { id: 'a1', displayName: 'Google Chrome', version: '129.0.6668.59', publisher: 'Google LLC', platform: 'windows', sizeBytes: null, deviceCount: 4 },
      { id: 'a2', displayName: 'Google Chrome', version: '131.0.6778.86', publisher: 'Google LLC', platform: 'windows', sizeBytes: null, deviceCount: 10 },
      { id: 'a3', displayName: 'TeamViewer', version: '15.1', publisher: 'TeamViewer', platform: 'windows', sizeBytes: null, deviceCount: 2 },
      { id: 'a4', displayName: 'Branchenapp', version: '3.2', publisher: 'Firma', platform: 'windows', sizeBytes: null, deviceCount: 6 },
    ];
    const overview = buildSoftwareOverview(items, packages, WINGET_BASE_SET, new Map([['Google.Chrome', '131.0.6778.86']]), rules);
    const chrome = overview.rows.find((r) => r.displayName === 'Google Chrome')!;
    expect(chrome).toMatchObject({ wingetId: 'Google.Chrome', deviceCount: 14, status: 'outdated', outdatedDevices: 4, latestVersion: '131.0.6778.86' });
    expect(chrome.versions.map((v) => v.version)).toEqual(['131.0.6778.86', '129.0.6668.59']);
    expect(overview.rows.find((r) => r.displayName === 'TeamViewer')?.blockedBy).toBe('teamviewer');
    expect(overview.rows.find((r) => r.displayName === 'Branchenapp')).toMatchObject({ wingetId: null, status: 'unknown' });
    expect(overview.totals).toEqual({ software: 3, matched: 2, outdated: 1, blocked: 1 });
    expect(overview.rows[0].displayName).toBe('TeamViewer');
  });
});

describe('device.winget-bulk', () => {
  const base = { jobId: 'job-abcdef12' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
  const devices = [
    { managedDeviceId: 'md-1', deviceName: 'PC01' },
    { managedDeviceId: 'md-2', deviceName: 'PC02' },
    { managedDeviceId: 'md-3', deviceName: 'PC03' },
  ];
  function state(output: Record<string, unknown>): RemediationRunState_ {
    return { detectionState: 'success', remediationState: 'skipped', preOutput: JSON.stringify(output), postOutput: null, detectionError: null, remediationError: null, updatedAt: null, syncedAt: null, source: 'device' } as unknown as RemediationRunState_;
  }

  it('previews one change per device and reports per-device outcomes', async () => {
    const runTransient = vi.fn(async (_ctx: unknown, deviceId: string) => (deviceId === 'md-2' ? null : state({ schema: 'zsc.winget-install/1', success: deviceId !== 'md-3', exitCode: deviceId === 'md-3' ? -1978334967 : 0, note: deviceId === 'md-3' ? 'installer failed; see message' : null, installedVersion: '24.08' })));
    registerWingetBulkJob({ runTransient } as unknown as RemediationOperations);
    const job = getRegisteredJob('device.winget-bulk')!;
    const payload = { packageId: '7zip.7zip', mode: 'upgrade', version: null, displayName: '7-Zip', devices, reason: null };
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes).toHaveLength(3);
    expect(preview.changes[1]).toMatchObject({ objectDisplayName: 'PC02', after: { software: '7-Zip (7zip.7zip) aktualisiert' } });
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('WINGET_BULK_PARTIAL');
    expect(result.data).toMatchObject({ total: 3, succeeded: 1, failed: 2 });
    const outcomes = (result.data as { outcomes: Array<{ deviceName: string; success: boolean; message: string | null }> }).outcomes;
    expect(outcomes.find((o) => o.deviceName === 'PC01')).toMatchObject({ success: true });
    expect(outcomes.find((o) => o.deviceName === 'PC02')?.message).toMatch(/nicht gemeldet/);
    expect(outcomes.find((o) => o.deviceName === 'PC03')?.message).toMatch(/installer failed/);
    expect(runTransient).toHaveBeenCalledTimes(3);
  });

  it('rejects too many devices in the preview', async () => {
    registerWingetBulkJob({ runTransient: vi.fn() } as unknown as RemediationOperations);
    const many = Array.from({ length: 26 }, (_, i) => ({ managedDeviceId: `md-${i}`, deviceName: `PC${i}` }));
    await expect(getRegisteredJob('device.winget-bulk')!.previewGenerator!({ ...base, payload: { packageId: '7zip.7zip', mode: 'uninstall', version: null, displayName: null, devices: many, reason: null } })).rejects.toThrow(/Hoechstens 25/);
  });
});
