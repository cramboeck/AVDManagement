/**
 * Tests: AVD-Sammelaktion (eine Vorschau, Ergebnis je Host) und Vorschauen
 * fuer Drain, Trennen und Abmelden
 */

import { describe, it, expect, vi } from 'vitest';
import { registerAvdJobs } from '../src/jobs/avd-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { AvdProvider } from '../src/providers/avd-provider.js';
import type { CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const base = { jobId: 'j' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
const pool = '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg/providers/Microsoft.DesktopVirtualization/hostPools/pool';

function provider() {
  return {
    listSessionHosts: vi.fn(async () => [
      { name: 'pool/h1', status: 'Available', allowNewSession: true, sessions: 3 },
      { name: 'pool/h2', status: 'Available', allowNewSession: true, sessions: 0 },
    ]),
    getSessionHost: vi.fn(async () => ({ name: 'pool/h1', status: 'Available', allowNewSession: true, sessions: 3 })),
    resolveSessionHostVm: vi.fn(async (_c: unknown, _p: string, name: string) => (name === 'h2' ? null : `/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/${name}`)),
    stopVm: vi.fn(async () => undefined),
    startVm: vi.fn(async () => undefined),
    setDrainMode: vi.fn(async () => undefined),
  };
}

describe('avd.bulk-host-action', () => {
  it('previews all hosts with one listing and warns about running sessions', async () => {
    const p = provider();
    registerAvdJobs(p as unknown as AvdProvider);
    const payload = { hostPoolId: pool, hostPoolName: 'pool', action: 'stop', hosts: [{ sessionHostId: 'a', sessionHostName: 'h1' }, { sessionHostId: 'b', sessionHostName: 'h2' }] };
    const preview = await getRegisteredJob('avd.bulk-host-action')!.previewGenerator!({ ...base, payload });
    expect(p.listSessionHosts).toHaveBeenCalledTimes(1);
    expect(preview.changes).toHaveLength(2);
    expect(preview.changes[0]).toMatchObject({ before: { status: 'Available' }, after: { status: 'Shutdown' } });
    expect(preview.warnings.some((w) => w.includes('3 Sitzung'))).toBe(true);
  });

  it('reports partial results per host and keeps them in the result', async () => {
    const p = provider();
    registerAvdJobs(p as unknown as AvdProvider);
    const payload = { hostPoolId: pool, hostPoolName: 'pool', action: 'stop', hosts: [{ sessionHostId: 'a', sessionHostName: 'h1' }, { sessionHostId: 'b', sessionHostName: 'h2' }] };
    const result = await getRegisteredJob('avd.bulk-host-action')!.handler({ ...base, payload });
    expect(result.error?.code).toBe('AVD_BULK_PARTIAL');
    expect(result.data).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(p.stopVm).toHaveBeenCalledTimes(1);
  });

  it('sets drain mode without touching VMs', async () => {
    const p = provider();
    registerAvdJobs(p as unknown as AvdProvider);
    const payload = { hostPoolId: pool, hostPoolName: 'pool', action: 'drain-on', hosts: [{ sessionHostId: 'a', sessionHostName: 'h1' }] };
    const result = await getRegisteredJob('avd.bulk-host-action')!.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(p.setDrainMode).toHaveBeenCalledWith(expect.anything(), pool, 'h1', false);
    expect(p.stopVm).not.toHaveBeenCalled();
  });
});

describe('AVD session actions require a preview', () => {
  it('drain, disconnect and logoff are previewed jobs', async () => {
    registerAvdJobs(provider() as unknown as AvdProvider);
    for (const type of ['avd.set-drain-mode', 'avd.disconnect-session', 'avd.logoff-session']) {
      const job = getRegisteredJob(type)!;
      expect(job.definition.requiresPreview).toBe(true);
      expect(job.previewGenerator).toBeDefined();
    }
    const logoff = await getRegisteredJob('avd.logoff-session')!.previewGenerator!({ ...base, payload: { hostPoolId: pool, sessionHostName: 'h1', sessionId: '3', userPrincipalName: 'max@contoso.com' } });
    expect(logoff.warnings[0]).toContain('nicht gespeicherte Arbeit');
  });
});
