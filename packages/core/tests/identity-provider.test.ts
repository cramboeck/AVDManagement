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
      mockGraphClient.get.mockRejectedValue(error);

      await expect(provider.listUsers(ctx)).rejects.toThrow(GraphApiError);
      await expect(provider.listUsers(ctx)).rejects.toMatchObject({
        statusCode: 401,
        isAuthError: true,
      });
    });

    it('should handle 403 forbidden', async () => {
      const error = new GraphApiError(403, 'Authorization_RequestDenied', 'Insufficient privileges.');
      mockGraphClient.get.mockRejectedValue(error);

      await expect(provider.listUsers(ctx)).rejects.toThrow(GraphApiError);
      await expect(provider.listUsers(ctx)).rejects.toMatchObject({
        statusCode: 403,
        isAuthError: true,
      });
    });

    it('should handle 429 throttling', async () => {
      const error = new GraphApiError(429, 'TooManyRequests', 'Too many requests.', 30);
      mockGraphClient.get.mockRejectedValue(error);

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

  describe('getUserDetail', () => {
    const detail = {
      id: 'user-001',
      userPrincipalName: 'max@contoso.com',
      displayName: 'Max Mustermann',
      mail: 'max@contoso.com',
      accountEnabled: true,
      userType: 'Member',
      createdDateTime: '2024-01-01T00:00:00Z',
      jobTitle: 'Engineer',
      department: 'IT',
      businessPhones: ['+49 89 1234'],
      onPremisesSyncEnabled: null,
      lastPasswordChangeDateTime: '2025-06-01T00:00:00Z',
      signInActivity: {
        lastSignInDateTime: '2026-09-24T08:00:00Z',
        lastNonInteractiveSignInDateTime: '2026-09-25T07:00:00Z',
      },
    };

    it('returns profile fields and sign-in activity', async () => {
      mockGraphClient.get.mockResolvedValueOnce(detail);

      const result = await provider.getUserDetail(ctx, 'user-001');

      expect(result?.jobTitle).toBe('Engineer');
      expect(result?.onPremisesSyncEnabled).toBe(false);
      expect(result?.signInActivity?.lastSignInAt).toBe('2026-09-24T08:00:00Z');
      expect(mockGraphClient.get.mock.calls[0][1]).toContain('signInActivity');
    });

    it('retries without signInActivity when the audit permission or P1 is missing', async () => {
      mockGraphClient.get
        .mockRejectedValueOnce(new GraphApiError(403, 'Authorization_RequestDenied', 'Insufficient privileges'))
        .mockResolvedValueOnce({ ...detail, signInActivity: undefined });

      const result = await provider.getUserDetail(ctx, 'user-001');

      expect(result?.displayName).toBe('Max Mustermann');
      expect(result?.signInActivity).toBeNull();
      expect(mockGraphClient.get).toHaveBeenCalledTimes(2);
      expect(mockGraphClient.get.mock.calls[1][1]).not.toContain('signInActivity');
    });

    it('returns null for an unknown user', async () => {
      mockGraphClient.get.mockRejectedValue(new GraphApiError(404, 'Request_ResourceNotFound', 'Not found'));

      expect(await provider.getUserDetail(ctx, 'nobody')).toBeNull();
    });
  });

  describe('getUserGroups', () => {
    it('classifies group kinds', async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { id: 'g1', displayName: 'Sales Team', groupTypes: ['Unified'], securityEnabled: false, mailEnabled: true },
          { id: 'g2', displayName: 'VPN Users', groupTypes: [], securityEnabled: true, mailEnabled: false },
          { id: 'g3', displayName: 'Newsletter', groupTypes: [], securityEnabled: false, mailEnabled: true },
          { id: 'g4', displayName: 'Admins Mail', groupTypes: [], securityEnabled: true, mailEnabled: true },
        ],
      });

      const result = await provider.getUserGroups(ctx, 'user-001');

      expect(result.map((g) => g.kind)).toEqual([
        'microsoft365',
        'security',
        'distribution',
        'mail-enabled-security',
      ]);
    });
  });

  describe('getUserAuthenticationMethods', () => {
    it('summarises MFA capability and masks phone numbers', async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          { '@odata.type': '#microsoft.graph.passwordAuthenticationMethod', id: 'm1' },
          {
            '@odata.type': '#microsoft.graph.phoneAuthenticationMethod',
            id: 'm2',
            phoneNumber: '+49 151 1234567',
            phoneType: 'mobile',
          },
          { '@odata.type': '#microsoft.graph.fido2AuthenticationMethod', id: 'm3', displayName: 'YubiKey', model: 'YubiKey 5' },
        ],
      });

      const result = await provider.getUserAuthenticationMethods(ctx, 'user-001');

      expect(result.available).toBe(true);
      if (!result.available) return;
      expect(result.data.mfaCapable).toBe(true);
      expect(result.data.phishingResistant).toBe(true);
      expect(result.data.methods[1].detail).toBe('mobile ***567');
      expect(result.data.methods[1].detail).not.toContain('1234');
    });

    it('reports a missing permission as unavailable instead of throwing', async () => {
      mockGraphClient.get.mockRejectedValueOnce(
        new GraphApiError(403, 'Authorization_RequestDenied', 'Insufficient privileges')
      );

      const result = await provider.getUserAuthenticationMethods(ctx, 'user-001');

      expect(result).toMatchObject({
        available: false,
        reason: 'permission-missing',
        missingPermission: 'UserAuthenticationMethod.Read.All',
      });
    });
  });

  describe('listSignIns', () => {
    const signIn = (id: string, errorCode: number) => ({
      id,
      createdDateTime: '2026-09-25T10:00:00Z',
      userId: 'user-001',
      userPrincipalName: 'max@contoso.com',
      userDisplayName: 'Max Mustermann',
      appDisplayName: 'Office 365',
      ipAddress: '203.0.113.10',
      location: { city: 'Munich', state: 'Bavaria', countryOrRegion: 'DE' },
      status: { errorCode, failureReason: errorCode ? 'Invalid password' : null },
      conditionalAccessStatus: 'success',
      authenticationRequirement: 'multiFactorAuthentication',
      riskLevelDuringSignIn: 'none',
      isInteractive: true,
      deviceDetail: { operatingSystem: 'Windows 11', browser: 'Edge', isCompliant: true, isManaged: true },
    });

    it('maps sign-ins and filters by user', async () => {
      mockGraphClient.get.mockResolvedValueOnce({ value: [signIn('s1', 0)] });

      const result = await provider.listSignIns(ctx, { userId: 'user-001', top: 10 });

      expect(result.available).toBe(true);
      if (!result.available) return;
      expect(result.data[0]).toMatchObject({
        outcome: 'success',
        location: { countryOrRegion: 'DE' },
        authenticationRequirement: 'multiFactorAuthentication',
        device: { isCompliant: true },
      });
      const path = mockGraphClient.get.mock.calls[0][1] as string;
      expect(path).toContain('/auditLogs/signIns?$top=10');
      expect(decodeURIComponent(path)).toContain("userId eq 'user-001'");
    });

    it('returns only failures when requested and distinguishes interruptions', async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        value: [signIn('ok', 0), signIn('mfa-prompt', 50074), signIn('bad-pw', 50126)],
      });

      const result = await provider.listSignIns(ctx, { failuresOnly: true, top: 10 });

      expect(result.available).toBe(true);
      if (!result.available) return;
      expect(result.data.map((e) => e.id)).toEqual(['bad-pw']);
      expect(result.data[0].failureReason).toBe('Invalid password');
      expect(mockGraphClient.get.mock.calls[0][1]).toContain('$top=40');
    });

    it('reports a tenant without Entra ID P1 as premium-required', async () => {
      mockGraphClient.get.mockRejectedValueOnce(
        new GraphApiError(
          403,
          'Authentication_RequestFromNonPremiumTenantOrB2CTenant',
          'Neither tenant is B2C or tenant doesn\'t have premium license'
        )
      );

      const result = await provider.listSignIns(ctx);

      expect(result).toMatchObject({ available: false, reason: 'premium-required' });
    });

    it('rethrows unrelated errors such as throttling', async () => {
      mockGraphClient.get.mockRejectedValueOnce(new GraphApiError(429, 'TooManyRequests', 'Slow down', 10));

      await expect(provider.listSignIns(ctx)).rejects.toMatchObject({ statusCode: 429 });
    });
  });

  describe('listDirectoryAudits', () => {
    it('maps audit events with initiator and modified properties', async () => {
      mockGraphClient.get.mockResolvedValueOnce({
        value: [
          {
            id: 'a1',
            activityDateTime: '2026-09-25T09:00:00Z',
            activityDisplayName: 'Update user',
            category: 'UserManagement',
            result: 'success',
            initiatedBy: { user: { displayName: 'Admin', userPrincipalName: 'admin@contoso.com' } },
            targetResources: [
              {
                id: 'user-001',
                displayName: 'Max Mustermann',
                type: 'User',
                userPrincipalName: 'max@contoso.com',
                modifiedProperties: [{ displayName: 'AccountEnabled', oldValue: '[true]', newValue: '[false]' }],
              },
            ],
          },
        ],
      });

      const result = await provider.listDirectoryAudits(ctx, { userId: 'user-001' });

      expect(result.available).toBe(true);
      if (!result.available) return;
      expect(result.data[0].initiatedBy).toEqual({
        kind: 'user',
        displayName: 'Admin',
        userPrincipalName: 'admin@contoso.com',
      });
      expect(result.data[0].targets[0].modifiedProperties[0]).toEqual({
        name: 'AccountEnabled',
        oldValue: '[true]',
        newValue: '[false]',
      });
      expect(decodeURIComponent(mockGraphClient.get.mock.calls[0][1] as string)).toContain(
        "targetResources/any(t:t/id eq 'user-001')"
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
