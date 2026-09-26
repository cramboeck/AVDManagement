/**
 * Tests fuer RemediationProvider (Graph beta deviceHealthScripts, gemockt)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemediationProvider, GRAPH_BETA, isFreshRunState, type RemediationRunState_ } from '../src/providers/remediation-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import { getLibraryScript, tenantDescription } from '../src/scripts/library.js';
import type { TenantId } from '@zerostress/types';

const ctx = { tenantId: 'tenant-1' as TenantId, correlationId: 'corr-1' };

function tenantScript(id: string, overrides: Record<string, unknown> = {}) {
  const script = getLibraryScript(id)!;
  return {
    id: `remote-${id}`,
    displayName: `ZSC-${id}`,
    description: tenantDescription(script),
    publisher: 'ZeroStress Cockpit',
    version: '1',
    lastModifiedDateTime: '2026-09-20T10:00:00Z',
    runAsAccount: 'system',
    ...overrides,
  };
}

describe('RemediationProvider', () => {
  let graph: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> };
  let provider: RemediationProvider;

  beforeEach(() => {
    graph = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
    provider = new RemediationProvider(graph as unknown as GraphClient);
  });

  it('reports library status against the tenant: in-sync, outdated, missing', async () => {
    graph.get.mockResolvedValue({
      value: [
        tenantScript('update-status'),
        tenantScript('update-scan', { description: 'alt [zsc:hash=' + 'a'.repeat(64) + ';version=0.9.0]' }),
        { id: 'foreign', displayName: 'Contoso-Cleanup', description: null, publisher: null, version: null, lastModifiedDateTime: null, runAsAccount: null },
      ],
    });

    const status = await provider.getLibraryStatus(ctx);

    expect(status.available).toBe(true);
    if (!status.available) return;
    expect(status.data.map((s) => [s.id, s.tenantState])).toEqual([
      ['update-status', 'in-sync'],
      ['update-scan', 'outdated'],
      ['system-info', 'missing'],
      ['winget-updates', 'missing'],
      ['winget-inventory', 'missing'],
      ['network-info', 'missing'],
      ['storage-info', 'missing'],
      ['local-admins', 'missing'],
      ['battery-info', 'missing'],
    ]);
    expect(status.data[1].tenantHash).toBe('a'.repeat(64));
    expect(graph.get.mock.calls[0][1]).toContain(`${GRAPH_BETA}/deviceManagement/deviceHealthScripts`);
  });

  it('turns 403 into permission-missing instead of throwing', async () => {
    graph.get.mockRejectedValue(new GraphApiError(403, 'Forbidden', 'Application is not authorized'));
    const status = await provider.getLibraryStatus(ctx);
    expect(status).toMatchObject({ available: false, reason: 'permission-missing', missingPermission: 'DeviceManagementConfiguration.ReadWrite.All' });
  });

  it('creates a missing script with base64 content and the hash marker', async () => {
    graph.get.mockResolvedValue({ value: [] });
    graph.post.mockResolvedValue({ id: 'new-1' });
    const script = getLibraryScript('update-scan')!;

    const result = await provider.ensureScript(ctx, script);

    expect(result).toEqual({ tenantScriptId: 'new-1', action: 'created' });
    const [, path, , body] = graph.post.mock.calls[0];
    expect(path).toBe(`${GRAPH_BETA}/deviceManagement/deviceHealthScripts`);
    expect(body.displayName).toBe('ZSC-update-scan');
    expect(body.description).toContain(`[zsc:hash=${script.hash};version=${script.version}]`);
    expect(body.runAsAccount).toBe('system');
    expect(Buffer.from(body.detectionScriptContent, 'base64').toString('utf8')).toBe(script.detectionScript);
    expect(Buffer.from(body.remediationScriptContent, 'base64').toString('utf8')).toBe(script.remediationScript);
  });

  it('patches an outdated script and leaves an in-sync one alone', async () => {
    graph.get.mockResolvedValue({
      value: [tenantScript('update-status'), tenantScript('system-info', { description: '[zsc:hash=' + 'b'.repeat(64) + ';version=0.1.0]' })],
    });

    expect(await provider.ensureScript(ctx, getLibraryScript('update-status')!)).toEqual({ tenantScriptId: 'remote-update-status', action: 'unchanged' });
    expect(await provider.ensureScript(ctx, getLibraryScript('system-info')!)).toEqual({ tenantScriptId: 'remote-system-info', action: 'updated' });
    expect(graph.patch).toHaveBeenCalledTimes(1);
    expect(graph.patch.mock.calls[0][1]).toBe(`${GRAPH_BETA}/deviceManagement/deviceHealthScripts/remote-system-info`);
    expect(graph.post).not.toHaveBeenCalled();
  });

  it('starts an on-demand run with the privileged scope', async () => {
    graph.post.mockResolvedValue(undefined);
    await provider.runOnDemand(ctx, 'md-1', 'remote-1');
    const [, path, scopes, body] = graph.post.mock.calls[0];
    expect(path).toBe(`${GRAPH_BETA}/deviceManagement/managedDevices/md-1/initiateOnDemandProactiveRemediation`);
    expect(scopes).toEqual(['DeviceManagementManagedDevices.PrivilegedOperations.All']);
    expect(body).toEqual({ scriptPolicyId: 'remote-1' });
  });

  it('waits until the device reports a state newer than the request', async () => {
    const since = new Date('2026-09-25T10:00:00Z');
    const stale = { policyId: 'remote-1', lastStateUpdateDateTime: '2026-09-25T09:00:00Z', detectionState: 'success', preRemediationDetectionScriptOutput: '{"old":true}' };
    const fresh = {
      policyId: 'remote-1',
      lastStateUpdateDateTime: '2026-09-25T10:03:00Z',
      detectionState: 'fail',
      remediationState: 'success',
      preRemediationDetectionScriptOutput: '{"state":"scan-needed"}',
      postRemediationDetectionScriptOutput: '{"state":"scanned","pendingCount":2}',
      remediationScriptError: '',
    };
    graph.get.mockResolvedValueOnce({ value: [stale] }).mockResolvedValueOnce({ value: [stale] }).mockResolvedValueOnce({ value: [fresh] });
    const sleep = vi.fn(async () => undefined);

    const state = await provider.waitForRunState(ctx, 'md-1', 'remote-1', since, { pollMs: 1, timeoutMs: 60_000, sleep, now: () => since.getTime() });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(state).toMatchObject({ detectionState: 'fail', remediationState: 'success', postOutput: '{"state":"scanned","pendingCount":2}', remediationError: null });
  });

  it('returns null when the device stays silent past the timeout', async () => {
    graph.get.mockResolvedValue({ value: [] });
    let clock = 0;
    const state = await provider.waitForRunState(ctx, 'md-1', 'remote-1', new Date(0), {
      pollMs: 1000,
      timeoutMs: 3000,
      sleep: async () => {
        clock += 1000;
      },
      now: () => clock,
    });
    expect(state).toBeNull();
    // je Versuch zwei Quellen: Geraet und Skript
    expect(graph.get).toHaveBeenCalledTimes(8);
  });

  it('falls back to the script run states when the device collection is empty', async () => {
    graph.get.mockImplementation(async (_tenant: string, path: string) => {
      if (path.includes('/deviceHealthScriptStates')) return { value: [] };
      expect(path).toBe(`${GRAPH_BETA}/deviceManagement/deviceHealthScripts/remote-1/deviceRunStates?$expand=managedDevice($select=id)`);
      return {
        value: [
          { id: 'x', detectionState: 'success', remediationState: 'skipped', lastStateUpdateDateTime: '2026-09-25T10:04:00Z', lastSyncDateTime: null, preRemediationDetectionScriptOutput: '{"a":1}', managedDevice: { id: 'MD-1' } },
          { id: 'y', detectionState: 'success', remediationState: 'skipped', lastStateUpdateDateTime: '2026-09-25T10:04:00Z', lastSyncDateTime: null, preRemediationDetectionScriptOutput: '{"other":1}', managedDevice: { id: 'md-2' } },
        ],
      };
    });

    const state = await provider.getRunState(ctx, 'md-1', 'remote-1');
    expect(state).toMatchObject({ source: 'script', preOutput: '{"a":1}' });
  });

  it('prefers the most recently reported entry when several exist', async () => {
    graph.get.mockResolvedValue({
      value: [
        { policyId: 'REMOTE-1', lastStateUpdateDateTime: '0001-01-01T00:00:00Z', lastSyncDateTime: '2026-09-25T09:00:00Z', detectionState: 'success', preRemediationDetectionScriptOutput: '{"old":1}' },
        { policyId: 'remote-1', lastStateUpdateDateTime: '2026-09-25T10:04:00Z', lastSyncDateTime: null, detectionState: 'success', preRemediationDetectionScriptOutput: '{"new":1}' },
      ],
    });
    const state = await provider.getRunState(ctx, 'md-1', 'remote-1');
    expect(state?.preOutput).toBe('{"new":1}');
  });

  describe('isFreshRunState', () => {
    const since = new Date('2026-09-25T10:00:00Z');
    const state = (over: Partial<RemediationRunState_>): RemediationRunState_ => ({
      detectionState: 'success',
      remediationState: 'skipped',
      preOutput: '{"a":1}',
      postOutput: null,
      detectionError: null,
      remediationError: null,
      updatedAt: null,
      syncedAt: null,
      source: 'device',
      ...over,
    });

    it('accepts a report newer than the start with two minutes of tolerance', () => {
      expect(isFreshRunState(state({ updatedAt: '2026-09-25T09:58:30Z' }), since, undefined)).toBe(true);
      expect(isFreshRunState(state({ updatedAt: '2026-09-25T09:50:00Z' }), since, undefined)).toBe(false);
      expect(isFreshRunState(state({ updatedAt: '0001-01-01T00:00:00Z', syncedAt: '2026-09-25T10:01:00Z' }), since, undefined)).toBe(true);
    });

    it('treats the year 0001 as no timestamp and falls back to the baseline comparison', () => {
      const zero = state({ updatedAt: '0001-01-01T00:00:00Z' });
      expect(isFreshRunState(zero, since, undefined)).toBe(false);
      expect(isFreshRunState(zero, since, null)).toBe(true);
      expect(isFreshRunState(zero, since, state({ updatedAt: '0001-01-01T00:00:00Z' }))).toBe(false);
      expect(isFreshRunState(zero, since, state({ updatedAt: '0001-01-01T00:00:00Z', preOutput: '{"a":0}' }))).toBe(true);
    });
  });
});
