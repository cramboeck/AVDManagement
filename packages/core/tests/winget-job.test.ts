/**
 * Tests fuer die winget-Vorlage und den Job device.winget-install
 */

import { describe, it, expect, vi } from 'vitest';
import { renderWingetInstall } from '../src/scripts/templates.js';
import { registerWingetJobs } from '../src/jobs/winget-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { RemediationOperations, RemediationRunState_ } from '../src/providers/remediation-provider.js';
import type { CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const base = { jobId: 'job-12345678' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
const payload = { managedDeviceId: 'md-1', deviceName: 'PC01', packageId: '7zip.7zip', mode: 'upgrade', version: null, displayName: '7-Zip', installedVersion: '23.01', availableVersion: '24.08', reason: null };

function state(output: Record<string, unknown>): RemediationRunState_ {
  return { detectionState: 'success', remediationState: 'skipped', preOutput: JSON.stringify(output), postOutput: null, detectionError: null, remediationError: null, updatedAt: '2026-09-26T10:00:00Z', syncedAt: null, source: 'device' } as unknown as RemediationRunState_;
}

function ops(result: RemediationRunState_ | null): RemediationOperations {
  return { runTransient: vi.fn(async () => result) } as unknown as RemediationOperations;
}

describe('renderWingetInstall', () => {
  it('embeds validated parameters and rejects bad ones', () => {
    const r = renderWingetInstall({ packageId: '7zip.7zip', mode: 'install', version: '24.08' });
    expect(r.content).toContain("$packageId = '7zip.7zip'");
    expect(r.content).toContain("$mode = 'install'");
    expect(r.content).toContain("$requestedVersion = '24.08'");
    expect(r.content).not.toContain('__PACKAGE_ID__');
    expect(() => renderWingetInstall({ packageId: "7zip'; Remove-Item", mode: 'install' })).toThrow(/ungueltig/);
    expect(() => renderWingetInstall({ packageId: '7zip.7zip', mode: 'remove' as 'install' })).toThrow(/Modus/);
    expect(() => renderWingetInstall({ packageId: '7zip.7zip', mode: 'install', version: '1.0; bad' })).toThrow(/Version/);
  });
});

describe('device.winget-install', () => {
  it('previews before/after and reports success from the script json', async () => {
    const o = ops(state({ schema: 'zsc.winget-install/1', success: true, exitCode: 0, installedVersion: '24.08' }));
    registerWingetJobs(o);
    const job = getRegisteredJob('device.winget-install')!;
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes[0]).toMatchObject({ before: { software: '7-Zip (7zip.7zip) 23.01' }, after: { software: '7-Zip (7zip.7zip) 24.08', mode: 'upgrade' } });
    expect(preview.warnings.some((w) => w.includes('SYSTEM'))).toBe(true);
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ packageId: '7zip.7zip', mode: 'upgrade', outputJson: { installedVersion: '24.08' } });
    const call = (o.runTransient as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toBe('winget-job-1234');
    expect(String(call[3])).toContain("$packageId = '7zip.7zip'");
  });

  it('fails with the winget note when the exit code is not success and on timeout', async () => {
    registerWingetJobs(ops(state({ schema: 'zsc.winget-install/1', success: false, exitCode: -1978335212, note: 'no package found matching the id', message: 'No package found' })));
    const failed = await getRegisteredJob('device.winget-install')!.handler({ ...base, payload });
    expect(failed.success).toBe(false);
    expect(failed.error?.message).toMatch(/no package found/);
    registerWingetJobs(ops(null));
    const timeout = await getRegisteredJob('device.winget-install')!.handler({ ...base, payload });
    expect(timeout.error?.code).toBe('WINGET_TIMEOUT');
  });
});
