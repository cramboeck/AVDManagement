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
    provider = new AvdProvider(mockArmClient as unknown as ArmClient);
  });

  describe('listSubscriptions', () => {
    it('uses the Microsoft.Resources api-version, not the AVD one', async () => {
      mockArmClient.get.mockResolvedValueOnce({ value: [] });

      await provider.listSubscriptions(ctx);

      expect(mockArmClient.get).toHaveBeenCalledWith(tenantId, '/subscriptions', {
        apiVersion: '2022-12-01',
      });
    });

    it('returns only enabled subscriptions', async () => {
      mockArmClient.get.mockResolvedValueOnce({
        value: [
          { subscriptionId: 'sub-enabled', displayName: 'Prod', state: 'Enabled' },
          { subscriptionId: 'sub-disabled', displayName: 'Old', state: 'Disabled' },
        ],
      });

      const result = await provider.listSubscriptions(ctx);

      expect(result.map((s) => s.subscriptionId)).toEqual(['sub-enabled']);
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

  describe('listHostPools', () => {
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
});
