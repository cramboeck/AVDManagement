/**
 * Tests fuer Vorlagen und Jobs "Admin auf Zeit" sowie den Einmallauf im Provider
 */

import { describe, it, expect, vi } from 'vitest';
import { renderTempAdminGrant, renderTempAdminRevoke, validateAccountName, validateMinutes, tempAdminTaskName } from '../src/scripts/templates.js';
import { registerTempAdminJobs } from '../src/jobs/temp-admin-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import { RemediationProvider, GRAPH_BETA, type RemediationOperations } from '../src/providers/remediation-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import type { CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

describe('temp admin templates', () => {
  it('accepts local names, Entra accounts and SIDs and rejects injection attempts', () => {
    expect(validateAccountName('helpdesk')).toBe('helpdesk');
    expect(validateAccountName('AzureAD\\max@contoso.com')).toBe('AzureAD\\max@contoso.com');
    expect(validateAccountName('S-1-12-1-1-2-3-4')).toBe('S-1-12-1-1-2-3-4');
    expect(() => validateAccountName("x'; Remove-Item C:\\ -Recurse")).toThrow();
    expect(() => validateAccountName('AzureAD\\not an upn')).toThrow();
    expect(() => validateMinutes(5)).toThrow();
    expect(() => validateMinutes(241)).toThrow();
    expect(validateMinutes(60)).toBe(60);
  });

  it('renders both scripts with the values embedded and a stable task name', () => {
    const grant = renderTempAdminGrant({ account: 'AzureAD\\max@contoso.com', minutes: 60 });
    expect(grant.content).toContain("$account = 'AzureAD\\max@contoso.com'");
    expect(grant.content).toContain('$minutes = 60');
    expect(grant.content).toContain(`$taskName = '${tempAdminTaskName('AzureAD\\max@contoso.com')}'`);
    expect(grant.content).not.toContain('__ACCOUNT__');
    expect(/^[\x00-\x7f]*$/.test(grant.content)).toBe(true);
    const revoke = renderTempAdminRevoke({ account: 'azuread\\MAX@contoso.com' });
    expect(revoke.content).toContain(`$taskName = '${tempAdminTaskName('AzureAD\\max@contoso.com')}'`);
  });
});

describe('RemediationProvider.runTransient', () => {
  it('creates, runs, waits and always deletes the script', async () => {
    const graph = {
      get: vi.fn(async (_t: string, path: string) =>
        path.includes('/deviceHealthScriptStates')
          ? { value: [{ policyId: 'tmp-1', lastStateUpdateDateTime: '2099-01-01T00:00:00Z', detectionState: 'success', preRemediationDetectionScriptOutput: '{"schema":"zsc.temp-admin/1","expiresAt":"x"}' }] }
          : { value: [] }
      ),
      post: vi.fn(async (_t: string, path: string) => (path.endsWith('/deviceHealthScripts') ? { id: 'tmp-1' } : undefined)),
      patch: vi.fn(),
      delete: vi.fn(async () => undefined),
    };
    const provider = new RemediationProvider(graph as unknown as GraphClient);
    const state = await provider.runTransient({ tenantId: 't' as TenantId, correlationId: 'c' }, 'md-1', 'temp-admin-abc', 'Write-Output ok', { pollMs: 1, timeoutMs: 1000 });
    expect(state?.detectionState).toBe('success');
    expect(graph.post.mock.calls[0][1]).toBe(`${GRAPH_BETA}/deviceManagement/deviceHealthScripts`);
    expect(graph.post.mock.calls[0][3].displayName).toBe('ZSC-temp-admin-abc');
    expect(graph.post.mock.calls[1][1]).toContain('/managedDevices/md-1/initiateOnDemandProactiveRemediation');
    expect(graph.delete).toHaveBeenCalledWith('t', `${GRAPH_BETA}/deviceManagement/deviceHealthScripts/tmp-1`, expect.anything());
  });

  it('deletes the script even when the run fails', async () => {
    const graph = {
      get: vi.fn(),
      post: vi.fn(async (_t: string, path: string) => {
        if (path.endsWith('/deviceHealthScripts')) return { id: 'tmp-2' };
        throw new Error('device gone');
      }),
      patch: vi.fn(),
      delete: vi.fn(async () => undefined),
    };
    const provider = new RemediationProvider(graph as unknown as GraphClient);
    await expect(provider.runTransient({ tenantId: 't' as TenantId, correlationId: 'c' }, 'md-1', 'x', 'y')).rejects.toThrow('device gone');
    expect(graph.delete).toHaveBeenCalledTimes(1);
  });
});

describe('temp admin jobs', () => {
  const base = { jobId: 'job-12345678' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
  const payload = { managedDeviceId: 'md-1', deviceName: 'PC-1', account: 'AzureAD\\max@contoso.com', minutes: 60, reason: 'Ticket 4711 Druckertreiber' };

  function ops(state: unknown): RemediationOperations {
    return {
      ensureScript: vi.fn(),
      runOnDemand: vi.fn(),
      getRunState: vi.fn(),
      waitForRunState: vi.fn(),
      runTransient: vi.fn(async () => state as never),
    };
  }

  it('grants and returns the expiry from the device', async () => {
    const o = ops({ detectionState: 'success', remediationState: 'skipped', preOutput: '{"schema":"zsc.temp-admin/1","action":"grant","expiresAt":"2026-09-26T01:00:00Z","error":null}', postOutput: null, detectionError: null, remediationError: null, updatedAt: 'x', syncedAt: null, source: 'script' });
    registerTempAdminJobs(o);
    const job = getRegisteredJob('device.temp-admin')!;
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.warnings[0]).toContain('60 Minuten');
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ expiresAt: '2026-09-26T01:00:00Z', account: payload.account });
    const [, md, name, script] = (o.runTransient as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(md).toBe('md-1');
    expect(name).toBe('temp-admin-job-1234');
    expect(script).toContain("$account = 'AzureAD\\max@contoso.com'");
  });

  it('fails on invalid input without touching the tenant and on device errors', async () => {
    const o = ops(null);
    registerTempAdminJobs(o);
    const bad = await getRegisteredJob('device.temp-admin')!.handler({ ...base, payload: { ...payload, account: 'x; rm' } });
    expect(bad.error?.code).toBe('TEMP_ADMIN_INVALID');
    expect(o.runTransient).not.toHaveBeenCalled();

    registerTempAdminJobs(ops({ detectionState: 'scriptError', remediationState: 'unknown', preOutput: '{"schema":"zsc.temp-admin/1","error":"Access denied"}', postOutput: null, detectionError: null, remediationError: null, updatedAt: 'x', syncedAt: null, source: 'device' }));
    const failed = await getRegisteredJob('device.temp-admin')!.handler({ ...base, payload });
    expect(failed).toMatchObject({ success: false, error: { code: 'TEMP_ADMIN_FAILED', message: 'Access denied' } });

    registerTempAdminJobs(ops(null));
    const timeout = await getRegisteredJob('device.temp-admin-revoke')!.handler({ ...base, payload });
    expect(timeout.error?.code).toBe('TEMP_ADMIN_TIMEOUT');
  });
});
