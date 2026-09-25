/**
 * Tests fuer SecurityProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityProvider } from '../src/providers/security-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { TenantId } from '@zerostress/types';

describe('SecurityProvider', () => {
  let provider: SecurityProvider;
  let graph: { get: ReturnType<typeof vi.fn> };
  const ctx = { tenantId: 'tenant-1' as TenantId, correlationId: 'corr' };

  beforeEach(() => {
    graph = { get: vi.fn() };
    provider = new SecurityProvider(graph as unknown as GraphClient);
  });

  it('summarises the secure score with comparisons and ranked improvements', async () => {
    graph.get.mockImplementation(async (_tenant: string, path: string) => {
      if (path.includes('secureScoreControlProfiles')) {
        return {
          value: [
            { id: 'AdminMFAV2', title: 'Require MFA for administrative roles', maxScore: 10, controlCategory: 'Identity', userImpact: 'Low', implementationCost: 'Low', actionUrl: 'https://example.com/mfa', remediation: '<p>Enable MFA for <b>all</b> admins.</p>' },
            { id: 'MFARegistrationV2', title: 'Ensure all users can complete MFA', maxScore: 9, controlCategory: 'Identity', remediation: 'Register everyone.' },
            { id: 'OldControl', title: 'Deprecated', maxScore: 5, deprecated: true },
          ],
        };
      }
      return {
        value: [
          {
            id: 's1',
            createdDateTime: '2026-09-25T00:00:00Z',
            currentScore: 42.5,
            maxScore: 85,
            averageComparativeScores: [
              { basis: 'AllTenants', averageScore: 34 },
              { basis: 'TotalSeats', averageScore: 51 },
            ],
            controlScores: [
              { controlName: 'AdminMFAV2', score: 2, controlCategory: 'Identity', implementationStatus: 'Partial' },
              { controlName: 'MFARegistrationV2', score: 9, controlCategory: 'Identity', implementationStatus: 'Implemented' },
              { controlName: 'OldControl', score: 0, controlCategory: 'Identity' },
            ],
          },
        ],
      };
    });

    const result = await provider.getSecureScore(ctx);

    expect(result.available && result.data).toMatchObject({
      percent: 50,
      comparisons: [
        { basis: 'AllTenants', averagePercent: 40 },
        { basis: 'TotalSeats', averagePercent: 60 },
      ],
    });
    expect(result.available && result.data.topImprovements).toEqual([
      expect.objectContaining({
        control: 'AdminMFAV2',
        title: 'Require MFA for administrative roles',
        scoreGain: 8,
        remediation: 'Enable MFA for all admins.',
        actionUrl: 'https://example.com/mfa',
      }),
    ]);
  });

  it('reports a missing SecurityEvents permission as unavailable', async () => {
    graph.get.mockRejectedValue(new GraphApiError(403, 'Authorization_RequestDenied', 'Insufficient privileges'));

    const result = await provider.getSecureScore(ctx);

    expect(result).toMatchObject({ available: false, reason: 'permission-missing', missingPermission: 'SecurityEvents.Read.All' });
  });

  it('counts MFA registration over members only and follows paging', async () => {
    graph.get
      .mockResolvedValueOnce({
        value: [
          { id: 'u1', isAdmin: true, isMfaRegistered: true, isMfaCapable: true, isPasswordlessCapable: true, isSsprRegistered: true, userType: 'member' },
          { id: 'u2', isAdmin: true, isMfaRegistered: false, isMfaCapable: false, isPasswordlessCapable: false, isSsprRegistered: false, userType: 'member' },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next',
      })
      .mockResolvedValueOnce({
        value: [
          { id: 'u3', isAdmin: false, isMfaRegistered: true, isMfaCapable: true, isPasswordlessCapable: false, isSsprRegistered: false, userType: 'member' },
          { id: 'g1', isAdmin: false, isMfaRegistered: false, isMfaCapable: false, isPasswordlessCapable: false, isSsprRegistered: false, userType: 'guest' },
        ],
      });

    const result = await provider.getMfaRegistration(ctx);

    expect(graph.get).toHaveBeenCalledTimes(2);
    expect(result.available && result.data).toEqual({
      totalUsers: 3,
      mfaRegistered: 2,
      mfaCapable: 2,
      passwordlessCapable: 1,
      ssprRegistered: 1,
      admins: 2,
      adminsWithoutMfa: 1,
    });
  });

  it('marks the registration report as premium-required without P1', async () => {
    graph.get.mockRejectedValueOnce(
      new GraphApiError(403, 'Authentication_RequestFromNonPremiumTenantOrB2CTenant', 'Premium license required')
    );

    const result = await provider.getMfaRegistration(ctx);

    expect(result).toMatchObject({ available: false, reason: 'premium-required' });
  });

  it('counts open alerts by severity and keeps the newest', async () => {
    graph.get.mockResolvedValueOnce({
      value: [
        { id: 'a1', title: 'Suspicious sign-in', severity: 'high', status: 'new', createdDateTime: '2026-09-25T10:00:00Z', serviceSource: 'microsoftDefenderForIdentity' },
        { id: 'a2', title: 'Malware detected', severity: 'Medium', status: 'inProgress', createdDateTime: '2026-09-25T11:00:00Z', serviceSource: 'microsoftDefenderForEndpoint' },
        { id: 'a3', title: 'Odd', severity: 'weird', status: 'new', createdDateTime: '2026-09-24T11:00:00Z' },
      ],
    });

    const result = await provider.getOpenAlerts(ctx);

    expect(result.available && result.data.bySeverity).toEqual({ high: 1, medium: 1, low: 0, informational: 0, unknown: 1 });
    expect(result.available && result.data.newest[0].id).toBe('a2');
    expect(decodeURIComponent(graph.get.mock.calls[0][1] as string)).toContain("status eq 'new' or status eq 'inProgress'");
  });
});
