/**
 * Tests fuer AvdProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AvdProvider } from '../src/providers/avd-provider.js';
import { ArmClient } from '../src/providers/arm-client.js';
import { ArmApiError } from '../src/errors.js';
import type { TenantId } from '@zerostress/types';

describe('AvdProvider', () => {
  let provider: AvdProvider;
  let mockArmClient: {
    get: ReturnType<typeof vi.fn>;
    getAllPages: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  const tenantId = 'tenant-123' as TenantId;
  const ctx = { tenantId, correlationId: 'corr-1' };

  beforeEach(() => {
    mockArmClient = {
      get: vi.fn(),
      getAllPages: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    // Abo-Liste laeuft ueber getAllPages; die Tests liefern sie ueber get, damit die Faelle lesbar bleiben
    const routed = {
      ...mockArmClient,
      getAllPages: (t: string, path: string, opts?: unknown) =>
        path === '/subscriptions' ? Promise.resolve(mockArmClient.get(t, path, opts)).then((r: { value: unknown[] }) => r.value) : mockArmClient.getAllPages(t, path, opts),
    };
    provider = new AvdProvider(routed as unknown as ArmClient);
  });

  describe('listSubscriptions', () => {
    it('uses the Microsoft.Resources api-version, not the AVD one', async () => {
      mockArmClient.get.mockResolvedValueOnce({ value: [] });

      await provider.listSubscriptions(ctx);

      expect(mockArmClient.get).toHaveBeenCalledWith(tenantId, '/subscriptions', {
        apiVersion: '2022-12-01',
      });
    });

    it('returns running subscriptions, including ones with a payment warning', async () => {
      mockArmClient.get.mockResolvedValueOnce({
        value: [
          { subscriptionId: 'sub-enabled', displayName: 'Prod', state: 'Enabled' },
          { subscriptionId: 'sub-warned', displayName: 'Warned', state: 'Warned' },
          { subscriptionId: 'sub-pastdue', displayName: 'PastDue', state: 'PastDue' },
          { subscriptionId: 'sub-disabled', displayName: 'Old', state: 'Disabled' },
        ],
      });

      const result = await provider.listSubscriptions(ctx);

      expect(result.map((s) => s.subscriptionId)).toEqual(['sub-enabled', 'sub-warned', 'sub-pastdue']);
    });

    it('propagates 403 when the service principal has no RBAC role', async () => {
      mockArmClient.get.mockRejectedValue(
        new ArmApiError(403, 'AuthorizationFailed', 'The client does not have authorization')
      );

      await expect(provider.listSubscriptions(ctx)).rejects.toMatchObject({
        statusCode: 403,
        isAuthError: true,
      });
    });
  });

  describe('getAvdOverview', () => {
    it('aggregates hosts, sessions and capacity across pools', async () => {
      mockArmClient.get.mockResolvedValueOnce({
        value: [{ subscriptionId: 'sub-1', displayName: 'Prod', state: 'Enabled' }],
      });
      mockArmClient.getAllPages.mockImplementation(async (_tenant: string, path: string) => {
        if (path.endsWith('/sessionHosts')) {
          return [
            { id: 'h1', name: 'pool/h1', type: 'sh', properties: { status: 'Available', allowNewSession: true, sessions: 3 } },
            { id: 'h2', name: 'pool/h2', type: 'sh', properties: { status: 'Available', allowNewSession: false, sessions: 1 } },
            { id: 'h3', name: 'pool/h3', type: 'sh', properties: { status: 'Shutdown', allowNewSession: true, sessions: 0 } },
            { id: 'h4', name: 'pool/h4', type: 'sh', properties: { status: 'Unavailable', allowNewSession: true, sessions: 0 } },
          ];
        }
        return [
          {
            id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DesktopVirtualization/hostPools/pool',
            name: 'pool',
            type: 'hp',
            location: 'westeurope',
            properties: { hostPoolType: 'Pooled', loadBalancerType: 'BreadthFirst', maxSessionLimit: 10, preferredAppGroupType: 'Desktop', validationEnvironment: false, startVMOnConnect: false },
          },
        ];
      });

      const overview = await provider.getAvdOverview(ctx);

      expect(overview).toMatchObject({
        hostPools: 1,
        totalHosts: 4,
        availableHosts: 2,
        unavailableHosts: 1,
        shutdownHosts: 1,
        drainingHosts: 1,
        activeSessions: 4,
        maxSessions: 20,
        warnings: [],
      });
    });
  });

  describe('listHostPools', () => {
    const subscriptions = (...ids: string[]) => ({
      value: ids.map((id) => ({ subscriptionId: id, displayName: id, state: 'Enabled' })),
    });

    it('returns a warning instead of an empty list when no subscription is visible', async () => {
      mockArmClient.get.mockResolvedValueOnce({ value: [] });

      const result = await provider.listHostPools(ctx);

      expect(result.items).toEqual([]);
      expect(result.warnings[0]).toMatch(/no access to any Azure subscription/);
      expect(mockArmClient.getAllPages).not.toHaveBeenCalled();
    });

    it('throws when every subscription fails instead of reporting an empty list', async () => {
      mockArmClient.get.mockResolvedValueOnce(subscriptions('sub-1', 'sub-2'));
      mockArmClient.getAllPages.mockRejectedValue(
        new ArmApiError(403, 'AuthorizationFailed', 'The client does not have authorization')
      );

      await expect(provider.listHostPools(ctx)).rejects.toMatchObject({ statusCode: 403 });
    });

    it('returns partial results with a warning when one subscription fails', async () => {
      mockArmClient.get.mockResolvedValueOnce(subscriptions('sub-ok', 'sub-denied'));
      mockArmClient.getAllPages.mockImplementation(async (_tenant: string, path: string) => {
        if (path.includes('sub-denied')) {
          throw new ArmApiError(403, 'AuthorizationFailed', 'denied');
        }
        return [];
      });

      const result = await provider.listHostPools(ctx);

      expect(result.items).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/sub-denied/);
    });

    it('queries host pools per enabled subscription with the AVD api-version', async () => {
      mockArmClient.get.mockResolvedValueOnce({
        value: [
          { subscriptionId: 'sub-1', displayName: 'Prod', state: 'Enabled' },
          { subscriptionId: 'sub-2', displayName: 'Old', state: 'Disabled' },
        ],
      });
      mockArmClient.getAllPages.mockResolvedValue([]);

      await provider.listHostPools(ctx);

      expect(mockArmClient.getAllPages).toHaveBeenCalledTimes(1);
      expect(mockArmClient.getAllPages).toHaveBeenCalledWith(
        tenantId,
        '/subscriptions/sub-1/providers/Microsoft.DesktopVirtualization/hostPools',
        { apiVersion: '2024-04-03' }
      );
    });
  });
  describe('getHostPoolWithHosts', () => {
    const poolId = '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg/providers/Microsoft.DesktopVirtualization/hostPools/pool';

    it('loads pool and hosts with two calls and computes the summary', async () => {
      mockArmClient.get.mockResolvedValueOnce({ id: poolId, name: 'pool', type: 'hp', location: 'westeurope', properties: { hostPoolType: 'Pooled', loadBalancerType: 'BreadthFirst', maxSessionLimit: 10, preferredAppGroupType: 'Desktop', validationEnvironment: false, startVMOnConnect: false } });
      mockArmClient.getAllPages.mockResolvedValueOnce([
        { id: `${poolId}/sessionHosts/h1`, name: 'pool/h1', type: 'sh', properties: { status: 'Available', allowNewSession: true, sessions: 4 } },
        { id: `${poolId}/sessionHosts/h2`, name: 'pool/h2', type: 'sh', properties: { status: 'Available', allowNewSession: false, sessions: 1 } },
        { id: `${poolId}/sessionHosts/h3`, name: 'pool/h3', type: 'sh', properties: { status: 'Unavailable', allowNewSession: true, sessions: 0 } },
      ]);
      const loaded = await provider.getHostPoolWithHosts(ctx, poolId);
      expect(mockArmClient.get).toHaveBeenCalledTimes(1);
      expect(mockArmClient.getAllPages).toHaveBeenCalledTimes(1);
      expect(loaded?.pool.activeSessionCount).toBe(5);
      expect(loaded?.pool.summary).toMatchObject({ totalHosts: 3, availableHosts: 2, unavailableHosts: 1, hostsInDrainMode: 1, totalSessions: 5, maxSessions: 20, utilizationPercent: 25 });
    });

    it('returns null for a deleted pool', async () => {
      mockArmClient.get.mockRejectedValueOnce(new ArmApiError(404, 'ResourceNotFound', 'gone'));
      expect(await provider.getHostPoolWithHosts(ctx, poolId)).toBeNull();
    });
  });

  describe('session host paths', () => {
    const pool = '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg/providers/Microsoft.DesktopVirtualization/hostPools/pool';

    it('uses only the host part of "pool/host" names in the ARM path', async () => {
      mockArmClient.patch.mockResolvedValue(undefined);
      await provider.setDrainMode(ctx, pool, 'pool/avd-0.contoso.local', false);
      expect(mockArmClient.patch).toHaveBeenCalledWith(tenantId, `${pool}/sessionHosts/avd-0.contoso.local`, { properties: { allowNewSession: false } }, expect.anything());
    });

    it('builds session paths from "pool/host/id" session names', async () => {
      mockArmClient.post.mockResolvedValue(undefined);
      await provider.sendMessage(ctx, pool, 'pool/avd-0.contoso.local', 'pool/avd-0.contoso.local/3', 'Wartung', 'Bitte abmelden');
      expect(mockArmClient.post.mock.calls[0][1]).toBe(`${pool}/sessionHosts/avd-0.contoso.local/userSessions/3/sendMessage`);
    });

    it('rejects anything that is not a host pool resource id', async () => {
      await expect(provider.setDrainMode(ctx, '/subscriptions/x/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/dc01', 'h', true)).rejects.toMatchObject({ statusCode: 400 });
      expect(mockArmClient.patch).not.toHaveBeenCalled();
    });

    it('resolves the VM from ARM and returns null on 404', async () => {
      mockArmClient.get.mockResolvedValueOnce({ id: `${pool}/sessionHosts/h1`, name: 'pool/h1', type: 'sh', properties: { status: 'Available', allowNewSession: true, sessions: 2, resourceId: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/h1' } });
      expect(await provider.resolveSessionHostVm(ctx, pool, 'pool/h1')).toBe('/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/h1');
      mockArmClient.get.mockRejectedValueOnce(new ArmApiError(404, 'NotFound', 'missing'));
      expect(await provider.resolveSessionHostVm(ctx, pool, 'pool/h9')).toBeNull();
    });
  });
});
