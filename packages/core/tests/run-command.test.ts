/**
 * Tests fuer Run-Command-Rahmen und -Auswertung sowie den Job avd.run-script
 */

import { describe, it, expect, vi } from 'vitest';
import { buildRunCommandScript, parseRunCommandOutput } from '../src/scripts/run-command.js';
import { getLibraryScript } from '../src/scripts/library.js';
import { registerAvdScriptJobs } from '../src/jobs/script-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { CorrelationId, JobId, MspId, ScriptRunResult, TenantId, UserId } from '@zerostress/types';

describe('buildRunCommandScript', () => {
  it('embeds detection only for read-only scripts', () => {
    const lines = buildRunCommandScript(getLibraryScript('system-info')!);
    const text = lines.join('\n');
    expect(text).toContain("system-info.detect.ps1'");
    expect(text).not.toContain('remediate.ps1');
    expect(text).toContain('zsc.system-info/1');
    expect(text).toContain("Write-Output 'ZSC-RESULT-BEGIN'");
    expect(lines.every((l) => /^[\x00-\x7f]*$/.test(l))).toBe(true);
  });

  it('runs remediation only when detection exits 1 and detects again', () => {
    const text = buildRunCommandScript(getLibraryScript('update-scan')!).join('\n');
    expect(text).toContain('update-scan.remediate.ps1');
    expect(text).toContain('if ($first.code -eq 1) {');
    expect(text).toContain('$final = Invoke-Zsc -Path $detectPath');
  });
});

describe('parseRunCommandOutput', () => {
  it('extracts the framed output, exit code and remediation state', () => {
    const stdout = ['noise from profile', 'ZSC-RESULT-BEGIN', '{"schema":"zsc.update-scan/1","pendingCount":3}', 'ZSC-RESULT-END', 'ZSC-EXIT:0', 'ZSC-REMEDIATION:ran:0', ''].join('\r\n');
    expect(parseRunCommandOutput(stdout, '')).toEqual({
      output: '{"schema":"zsc.update-scan/1","pendingCount":3}',
      exitCode: 0,
      remediation: { state: 'ran', exitCode: 0 },
      stderr: null,
    });
  });

  it('keeps raw text when the frame is missing and reports stderr', () => {
    expect(parseRunCommandOutput('Access denied', 'Some error')).toEqual({
      output: 'Access denied',
      exitCode: null,
      remediation: { state: 'none', exitCode: null },
      stderr: 'Some error',
    });
    expect(parseRunCommandOutput(null, null).output).toBeNull();
  });
});

describe('avd.run-script', () => {
  const base = {
    jobId: 'job-1' as JobId,
    tenantId: 'tenant-1' as TenantId,
    mspId: 'msp-1' as MspId,
    userId: 'user-1' as UserId,
    correlationId: 'corr-1' as CorrelationId,
    attempt: 0,
  };
  const payload = {
    hostPoolId: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.DesktopVirtualization/hostPools/hp',
    hostPoolName: 'hp',
    sessionHostId: 'hp/host-1.contoso.local',
    sessionHostName: 'host-1.contoso.local',
    vmResourceId: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/host-1',
    scriptId: 'system-info',
  };

  it('runs the framed script on the VM and parses the result', async () => {
    const runner = {
      runCommand: vi.fn(async () => ({
        stdout: 'ZSC-RESULT-BEGIN\n{"schema":"zsc.system-info/1","uptimeHours":2}\nZSC-RESULT-END\nZSC-EXIT:0\nZSC-REMEDIATION:none:\n',
        stderr: null,
      })),
    };
    registerAvdScriptJobs(runner, { timeoutMs: 1000 });
    const result = await getRegisteredJob('avd.run-script')!.handler({ ...base, payload });
    expect(result.success).toBe(true);
    const data = result.data as unknown as ScriptRunResult;
    expect(data).toMatchObject({ stateSource: 'run-command', detectionState: 'success', remediationState: 'skipped', outputJson: { uptimeHours: 2 } });
    const [, vmId, lines] = runner.runCommand.mock.calls[0];
    expect(vmId).toBe(payload.vmResourceId);
    expect(lines.join('\n')).toContain('ZSC-RESULT-BEGIN');
  });

  it('fails when the VM does not answer or the script errors', async () => {
    registerAvdScriptJobs({ runCommand: vi.fn(async () => ({ stdout: '', stderr: null })) });
    expect((await getRegisteredJob('avd.run-script')!.handler({ ...base, payload })).error?.code).toBe('RUN_COMMAND_NO_OUTPUT');

    registerAvdScriptJobs({ runCommand: vi.fn(async () => ({ stdout: 'ZSC-RESULT-BEGIN\nZSC-RESULT-END\nZSC-EXIT:5\nZSC-REMEDIATION:none:\n', stderr: 'boom' })) });
    expect((await getRegisteredJob('avd.run-script')!.handler({ ...base, payload })).error?.code).toBe('SCRIPT_FAILED_ON_HOST');

    registerAvdScriptJobs({
      runCommand: vi.fn(async () => {
        throw new Error('VM deallocated');
      }),
    });
    expect((await getRegisteredJob('avd.run-script')!.handler({ ...base, payload })).error?.message).toBe('VM deallocated');
  });

  it('previews the transport and the host', async () => {
    registerAvdScriptJobs({ runCommand: vi.fn() });
    const preview = await getRegisteredJob('avd.run-script')!.previewGenerator!({ ...base, payload: { ...payload, scriptId: 'update-scan' } });
    expect(preview.changes[0]).toMatchObject({ objectType: 'session-host', objectId: payload.sessionHostId, after: { transport: 'azure-run-command', remediation: true } });
    expect(preview.warnings.some((w) => w.includes('Azure-VM-Agent'))).toBe(true);
  });
});
