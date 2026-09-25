/**
 * Tests fuer den Job device.run-script (Provider nachgebildet)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerScriptJobs } from '../src/jobs/script-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { RemediationOperations } from '../src/providers/remediation-provider.js';
import type { CorrelationId, JobId, MspId, ScriptRunResult, TenantId, UserId } from '@zerostress/types';

const base = {
  jobId: 'job-1' as JobId,
  tenantId: 'tenant-1' as TenantId,
  mspId: 'msp-1' as MspId,
  userId: 'user-1' as UserId,
  correlationId: 'corr-1' as CorrelationId,
  attempt: 0,
};

function fakeRemediations(overrides: Partial<RemediationOperations> = {}): RemediationOperations {
  return {
    ensureScript: vi.fn(async () => ({ tenantScriptId: 'remote-1', action: 'unchanged' as const })),
    runOnDemand: vi.fn(async () => undefined),
    waitForRunState: vi.fn(async () => ({
      detectionState: 'success' as const,
      remediationState: 'skipped' as const,
      preOutput: '{"schema":"zsc.system-info/1","uptimeHours":12}',
      postOutput: null,
      detectionError: null,
      remediationError: null,
      updatedAt: '2026-09-25T10:05:00Z',
    })),
    ...overrides,
  };
}

describe('device.run-script', () => {
  beforeEach(() => {
    registerScriptJobs(fakeRemediations(), { timeoutMs: 1, pollMs: 1 });
  });

  it('previews script identity, hash and read-only nature', async () => {
    const registered = getRegisteredJob('device.run-script')!;
    const preview = await registered.previewGenerator!({ ...base, payload: { managedDeviceId: 'md-1', deviceName: 'PC-1', scriptId: 'system-info' } });
    expect(preview.changes[0]).toMatchObject({ objectId: 'md-1', after: { scriptId: 'system-info', version: '1.0.0', runAs: 'system', remediation: false } });
    expect(String(preview.changes[0].after?.hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.warnings.some((w) => w.startsWith('Nur lesend'))).toBe(true);
  });

  it('warns about the change a remediation makes', async () => {
    const registered = getRegisteredJob('device.run-script')!;
    const preview = await registered.previewGenerator!({ ...base, payload: { managedDeviceId: 'md-1', deviceName: 'PC-1', scriptId: 'update-scan' } });
    expect(preview.warnings.some((w) => w.startsWith('Aendert etwas auf dem Geraet'))).toBe(true);
  });

  it('publishes, runs, waits and returns parsed output', async () => {
    const remediations = fakeRemediations();
    registerScriptJobs(remediations, { timeoutMs: 1, pollMs: 1 });
    const registered = getRegisteredJob('device.run-script')!;

    const result = await registered.handler({ ...base, payload: { managedDeviceId: 'md-1', deviceName: 'PC-1', scriptId: 'system-info' } });

    expect(result.success).toBe(true);
    const data = result.data as unknown as ScriptRunResult;
    expect(data.tenantScriptId).toBe('remote-1');
    expect(data.outputJson).toEqual({ schema: 'zsc.system-info/1', uptimeHours: 12 });
    expect(remediations.runOnDemand).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1' }), 'md-1', 'remote-1');
  });

  it('fails clearly when the device does not answer in time', async () => {
    registerScriptJobs(fakeRemediations({ waitForRunState: vi.fn(async () => null) }), { timeoutMs: 1, pollMs: 1 });
    const result = await getRegisteredJob('device.run-script')!.handler({ ...base, payload: { managedDeviceId: 'md-1', deviceName: 'PC-1', scriptId: 'update-status' } });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SCRIPT_RESULT_TIMEOUT');
  });

  it('fails when the script itself errored on the device', async () => {
    registerScriptJobs(
      fakeRemediations({
        waitForRunState: vi.fn(async () => ({
          detectionState: 'scriptError' as const,
          remediationState: 'unknown' as const,
          preOutput: null,
          postOutput: null,
          detectionError: 'Access is denied',
          remediationError: null,
          updatedAt: '2026-09-25T10:05:00Z',
        })),
      }),
      { timeoutMs: 1, pollMs: 1 }
    );
    const result = await getRegisteredJob('device.run-script')!.handler({ ...base, payload: { managedDeviceId: 'md-1', deviceName: 'PC-1', scriptId: 'update-status' } });
    expect(result).toMatchObject({ success: false, error: { code: 'SCRIPT_FAILED_ON_DEVICE', message: 'Access is denied' } });
  });

  it('rejects unknown script ids without touching the tenant', async () => {
    const remediations = fakeRemediations();
    registerScriptJobs(remediations, { timeoutMs: 1, pollMs: 1 });
    const result = await getRegisteredJob('device.run-script')!.handler({ ...base, payload: { managedDeviceId: 'md-1', deviceName: 'PC-1', scriptId: 'rm-rf' } });
    expect(result.error?.code).toBe('SCRIPT_UNKNOWN');
    expect(remediations.ensureScript).not.toHaveBeenCalled();
  });
});
