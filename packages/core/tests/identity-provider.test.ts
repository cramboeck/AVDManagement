/**
 * Tests fuer IdentityProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdentityProvider } from '../src/providers/identity-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { TenantId } from '@zerostress/types';
import fixtures from './fixtures/graph-users.json';

describe('IdentityProvider', () => {
  let provider: IdentityProvider;
  let mockGraphClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };

  const tenantId = 'tenant-123' as TenantId;
  const correlationId = 'corr-456';
  const ctx = { tenantId, correlationId };

  beforeEach(() => {
    mockGraphClient = {
      get: vi.fn(),
      post: vi.fn(),
    };
    provider = new IdentityProvider(mockGraphClient as unknown as GraphClient);
  });

  describe('listUsers', () => {
    it('should return paginated users', async () => {
      mockGraphClient.get.mockResolvedValueOnce(fixtures.usersList);

      const result = await provider.listUsers(ctx);

      expect(result.items).toHaveLength(3);
      expect(result.items[0].displayName).toBe('Max Mustermann');
      expect(result.items[0].userPrincipalName).toBe('max.mustermann@contoso.com');
      expect(result.nextPageToken).toBe(fixtures.usersList['@odata.nextLink']);
    });

    it('should handle search parameter', async () => {
      mockGraphClient.get.mockResolvedValueOnce({ value: [fixtures.singleUser] });

      await provider.listUsers(ctx, { search: 'Max' });

      expect(mockGraphClient.get).toHaveBeenCalledWith(
        tenantId,
        expect.stringContaining('$search'),
        expect.any(Array),
        expect.objectContaining({ headers: { ConsistencyLevel: 'eventual' } })
      );
    });

    it('should handle 401 unauthorized', async () => {
      const error = new GraphApiError(401, 'InvalidAuthenticationToken', 'Access token is empty.');
      mockGraphClient.get.mockRejectedValueOnce(error);

      await expect(provider.listUsers(ctx)).rejects.toThrow(GraphApiError);
      await expect(provider.listUsers(ctx)).rejects.toMatchObject({
        statusCode: 401,
        isAuthError: true,
      });
    });

    it('should handle 403 forbidden', async () => {
      const error = new GraphApiError(403, 'Authorization_RequestDenied', 'Insufficient privileges.');
      mockGraphClient.get.mockRejectedValueOnce(error);

      await expect(provider.listUsers(ctx)).rejects.toThrow(GraphApiError);
      await expect(provider.listUsers(ctx)).rejects.toMatchObject({
        statusCode: 403,
        isAuthError: true,
      });
    });

    it('should handle 429 throttling', async () => {
      const error = new GraphApiError(429, 'TooManyRequests', 'Too many requests.', 30);
      mockGraphClient.get.mockRejectedValueOnce(error);

      await expect(provider.listUsers(ctx)).rejects.toThrow(GraphApiError);
      await expect(provider.listUsers(ctx)).rejects.toMatchObject({
        statusCode: 429,
        isThrottled: true,
        retryAfterSeconds: 30,
      });
    });
  });

  describe('getUsersDelta', () => {
    it('should return delta query results', async () => {
      mockGraphClient.get.mockResolvedValueOnce(fixtures.usersDelta);

      const result = await provider.getUsersDelta(ctx);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].displayName).toBe('Max Mustermann (Updated)');
      expect(result.deltaToken).toBe(fixtures.usersDelta['@odata.deltaLink']);
    });

    it('should filter out deleted users from items', async () => {
      mockGraphClient.get.mockResolvedValueOnce(fixtures.usersDelta);

      const result = await provider.getUsersDelta(ctx);

      const deletedUser = result.items.find((u) => u.microsoftId === 'user-005');
      expect(deletedUser).toBeUndefined();
    });

    it('should use delta token for subsequent calls', async () => {
      mockGraphClient.get.mockResolvedValueOnce(fixtures.usersDelta);
      const deltaToken = 'https://graph.microsoft.com/v1.0/users/delta?$deltatoken=previous';

      await provider.getUsersDelta(ctx, { deltaToken });

      expect(mockGraphClient.get).toHaveBeenCalledWith(
        tenantId,
        deltaToken,
        expect.any(Array)
      );
    });
  });

  describe('getUser', () => {
    it('should return single user', async () => {
      mockGraphClient.get.mockResolvedValueOnce(fixtures.singleUser);

      const result = await provider.getUser(ctx, 'user-001');

      expect(result).not.toBeNull();
      expect(result?.displayName).toBe('Max Mustermann');
    });

    it('should return null for 404', async () => {
      const error = new GraphApiError(404, 'Request_ResourceNotFound', 'User not found.');
      (error as { statusCode: number }).statusCode = 404;
      mockGraphClient.get.mockRejectedValueOnce(error);

      const result = await provider.getUser(ctx, 'user-999');

      expect(result).toBeNull();
    });
  });

  describe('getUserLicenses', () => {
    it('should return user licenses', async () => {
      mockGraphClient.get.mockResolvedValueOnce(fixtures.userLicenses);

      const result = await provider.getUserLicenses(ctx, 'user-001');

      expect(result).toHaveLength(2);
      expect(result[0].skuPartNumber).toBe('ENTERPRISEPACK');
      expect(result[1].skuPartNumber).toBe('AAD_PREMIUM');
    });
  });

  describe('getAvailableSkus', () => {
    it('should return available SKUs with display names', async () => {
      mockGraphClient.get.mockResolvedValueOnce(fixtures.subscribedSkus);

      const result = await provider.getAvailableSkus(ctx);

      expect(result).toHaveLength(3);
      expect(result[0].displayName).toBe('Microsoft 365 E3');
      expect(result[1].displayName).toBe('Azure AD Premium P1');
      expect(result[2].displayName).toBe('Microsoft Intune');
    });
  });

  describe('assignLicense', () => {
    it('should assign license to user', async () => {
      mockGraphClient.post.mockResolvedValueOnce({});

      await provider.assignLicense(ctx, 'user-001', 'sku-001');

      expect(mockGraphClient.post).toHaveBeenCalledWith(
        tenantId,
        '/users/user-001/assignLicense',
        expect.any(Array),
        {
          addLicenses: [{ skuId: 'sku-001' }],
          removeLicenses: [],
        }
      );
    });
  });

  describe('removeLicense', () => {
    it('should remove license from user', async () => {
      mockGraphClient.post.mockResolvedValueOnce({});

      await provider.removeLicense(ctx, 'user-001', 'sku-001');

      expect(mockGraphClient.post).toHaveBeenCalledWith(
        tenantId,
        '/users/user-001/assignLicense',
        expect.any(Array),
        {
          addLicenses: [],
          removeLicenses: ['sku-001'],
        }
      );
    });
  });

  describe('Tenant Isolation', () => {
    it('should include tenantId in all synced users', async () => {
      mockGraphClient.get.mockResolvedValueOnce(fixtures.usersList);

      const result = await provider.listUsers(ctx);

      result.items.forEach((user) => {
        expect(user.tenantId).toBe(tenantId);
      });
    });

    it('should use correct tenantId for Graph calls', async () => {
      mockGraphClient.get.mockResolvedValueOnce(fixtures.usersList);
      const otherTenantId = 'other-tenant' as TenantId;

      await provider.listUsers({ tenantId: otherTenantId, correlationId });

      expect(mockGraphClient.get).toHaveBeenCalledWith(
        otherTenantId,
        expect.any(String),
        expect.any(Array)
      );
    });
  });
});
