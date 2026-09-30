/**
 * Tests fuer die Vorlage app-uninstall und den Job device.app-uninstall
 */

import { describe, it, expect, vi } from 'vitest';
import { renderAppUninstall } from '../src/scripts/templates.js';
import { registerAppUninstallJob } from '../src/jobs/app-uninstall-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { RemediationOperations, RemediationRunState_ } from '../src/providers/remediation-provider.js';
import type { CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const base = { jobId: 'job-12345678' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
const payload = { managedDeviceId: 'md-1', deviceName: 'PC01', displayName: "O'Reilly Tool (x64)", version: '2.5.1', publisher: 'Example', kind: 'registry', extraArgs: null, reason: null };

function state(output: Record<string, unknown>): RemediationRunState_ {
  return { detectionState: 'success', remediationState: 'skipped', preOutput: JSON.stringify(output), postOutput: null, detectionError: null, remediationError: null, updatedAt: '2026-09-30T10:00:00Z', syncedAt: null, source: 'device' } as unknown as RemediationRunState_;
}

function ops(result: RemediationRunState_ | null): RemediationOperations {
  return { runTransient: vi.fn(async () => result) } as unknown as RemediationOperations;
}

describe('renderAppUninstall', () => {
  it('embeds the display name with escaped quotes and rejects dangerous input', () => {
    const r = renderAppUninstall({ displayName: "O'Reilly Tool (x64)", version: '2.5.1', kind: 'registry', extraArgs: '/S' });
    expect(r.content).toContain("$displayName = 'O''Reilly Tool (x64)'");
    expect(r.content).toContain("$expectedVersion = '2.5.1'");
    expect(r.content).toContain("$kind = 'registry'");
    expect(r.content).toContain("$extraArgs = '/S'");
    expect(r.content).not.toContain('__DISPLAY_NAME__');
    expect(() => renderAppUninstall({ displayName: 'x', version: null, kind: 'registry', extraArgs: null })).toThrow(/Anzeigename/);
    expect(() => renderAppUninstall({ displayName: 'Tool`; Remove-Item C:\\', version: null, kind: 'registry', extraArgs: null })).toThrow(/Anzeigename/);
    expect(() => renderAppUninstall({ displayName: 'Tool', version: null, kind: 'registry', extraArgs: '/S | calc.exe' })).toThrow(/Argumente/);
    expect(() => renderAppUninstall({ displayName: 'Tool', version: null, kind: 'store' as 'registry', extraArgs: null })).toThrow(/Art/);
  });
});

describe('device.app-uninstall', () => {
  it('previews a removal and reports success from the script json', async () => {
    registerAppUninstallJob(ops(state({ schema: 'zsc.app-uninstall/1', found: true, method: 'msi', success: true, exitCode: 0 })));
    const job = getRegisteredJob('device.app-uninstall')!;
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes[0]).toMatchObject({ action: 'delete', before: { software: "O'Reilly Tool (x64) 2.5.1" }, after: { software: "O'Reilly Tool (x64) 2.5.1 entfernt" } });
    expect(preview.warnings.some((w) => w.includes('stillen Schalter'))).toBe(true);
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ kind: 'registry', outputJson: { method: 'msi' } });
  });

  it('asks for arguments when the script found no silent switch', async () => {
    registerAppUninstallJob(ops(state({ schema: 'zsc.app-uninstall/1', found: true, method: 'none', success: false, command: '"C:\\Tool\\remove.exe"', note: 'no silent switch known' })));
    const result = await getRegisteredJob('device.app-uninstall')!.handler({ ...base, payload });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNINSTALL_NEEDS_ARGUMENTS');
    expect(result.error?.message).toContain('remove.exe');
  });

  it('treats a missing entry as success with a note and an offline device as timeout', async () => {
    registerAppUninstallJob(ops(state({ schema: 'zsc.app-uninstall/1', found: false, method: 'none', success: true, note: 'no Uninstall registry entry with this exact display name' })));
    expect((await getRegisteredJob('device.app-uninstall')!.handler({ ...base, payload })).success).toBe(true);
    registerAppUninstallJob(ops(null));
    const timeout = await getRegisteredJob('device.app-uninstall')!.handler({ ...base, payload });
    expect(timeout.error?.code).toBe('UNINSTALL_TIMEOUT');
  });
});
