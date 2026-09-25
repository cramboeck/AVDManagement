/**
 * Tests fuer GroupProvider (Graph gemockt)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupProvider, groupFlags, classifyGroupKind } from '../src/providers/group-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { GroupSummary, TenantId } from '@zerostress/types';

const ctx = { tenantId: 'tenant-1' as TenantId, correlationId: 'corr-1' };

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    displayName: `Group ${id}`,
    description: null,
    groupTypes: ['Unified'],
    mailEnabled: true,
    securityEnabled: false,
    visibility: 'Private',
    resourceProvisioningOptions: ['Team'],
    createdDateTime: '2025-01-01T00:00:00Z',
    renewedDateTime: null,
    mail: `${id}@contoso.com`,
    membershipRule: null,
    onPremisesSyncEnabled: false,
    owners: [{ id: 'o1' }],
    ...overrides,
  };
}

describe('classifyGroupKind / groupFlags', () => {
  it('classifies teams, M365, security and distribution groups', () => {
    expect(classifyGroupKind({ groupTypes: ['Unified'], mailEnabled: true, securityEnabled: false, resourceProvisioningOptions: ['Team'] })).toBe('team');
    expect(classifyGroupKind({ groupTypes: ['Unified'], mailEnabled: true, securityEnabled: false, resourceProvisioningOptions: [] })).toBe('microsoft365');
    expect(classifyGroupKind({ groupTypes: [], mailEnabled: false, securityEnabled: true, resourceProvisioningOptions: null })).toBe('security');
    expect(classifyGroupKind({ groupTypes: [], mailEnabled: true, securityEnabled: false, resourceProvisioningOptions: null })).toBe('distribution');
    expect(classifyGroupKind({ groupTypes: [], mailEnabled: true, securityEnabled: true, resourceProvisioningOptions: null })).toBe('mail-enabled-security');
  });

  it('flags ownerless public teams with guests, and empty dynamic groups', () => {
    const base: Omit<GroupSummary, 'flags'> = {
      id: 'g',
      displayName: 'g',
      description: null,
      kind: 'team',
      visibility: 'Public',
      mail: null,
      createdAt: null,
      renewedAt: null,
      isDynamic: false,
      onPremisesSynced: false,
      ownerCount: 0,
      memberCount: 12,
      guestCount: 3,
    };
    expect(groupFlags(base)).toEqual(['ownerless', 'public-team', 'has-guests']);
    expect(groupFlags({ ...base, ownerCount: 1, visibility: 'Private', guestCount: 0 })).toEqual(['single-owner']);
    expect(groupFlags({ ...base, kind: 'security', ownerCount: 0, guestCount: 0, isDynamic: true, memberCount: 0 })).toEqual(['dynamic', 'empty']);
  });
});

describe('GroupProvider', () => {
  let graph: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  let provider: GroupProvider;

  beforeEach(() => {
    graph = { get: vi.fn(), post: vi.fn() };
    provider = new GroupProvider(graph as unknown as GraphClient);
  });

  it('lists groups across pages and counts members and guests via $batch', async () => {
    graph.get.mockImplementation(async (_t: string, path: string) => {
      if (path.includes('skiptoken=2')) return { value: [row('b', { owners: [], visibility: 'Public' })] };
      return { value: [row('a')], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/groups?$skiptoken=2' };
    });
    graph.post.mockImplementation(async (_t: string, path: string, _s: string[], body: { requests: { id: string }[] }) => {
      expect(path).toBe('/$batch');
      return {
        responses: body.requests.map((r) => ({ id: r.id, status: 200, body: r.id.startsWith('m:') ? 25 : r.id === 'g:b' ? 4 : 0 })),
      };
    });

    const result = await provider.listGroups(ctx);

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.data.items.map((g) => [g.id, g.memberCount, g.guestCount, g.flags])).toEqual([
      ['a', 25, 0, ['single-owner']],
      ['b', 25, 4, ['ownerless', 'public-team', 'has-guests']],
    ]);
    expect(result.data.stats).toMatchObject({ total: 2, teams: 2, ownerless: 1, withGuests: 1, publicTeams: 1 });
    expect(graph.post).toHaveBeenCalledTimes(1);
    expect(graph.post.mock.calls[0][3].requests).toHaveLength(4);
  });

  it('keeps counts null when a batch fails instead of dropping the group', async () => {
    graph.get.mockResolvedValue({ value: [row('a')] });
    graph.post.mockRejectedValue(new GraphApiError(429, 'TooManyRequests', 'throttled', 5));
    const result = await provider.listGroups(ctx);
    if (!result.available) throw new Error('expected available');
    expect(result.data.items[0]).toMatchObject({ memberCount: null, guestCount: null });
  });

  it('turns 403 on the group list into permission-missing', async () => {
    graph.get.mockRejectedValue(new GraphApiError(403, 'Authorization_RequestDenied', 'Insufficient privileges'));
    expect(await provider.listGroups(ctx)).toMatchObject({ available: false, reason: 'permission-missing', missingPermission: 'Directory.Read.All' });
  });

  it('loads a group detail with typed members and returns null for unknown ids', async () => {
    graph.get.mockImplementation(async (_t: string, path: string) => {
      if (path.includes('/members')) {
        return {
          value: [
            { id: 'u1', '@odata.type': '#microsoft.graph.user', displayName: 'Max', userPrincipalName: 'max@contoso.com', userType: 'Member', accountEnabled: true },
            { id: 'u2', '@odata.type': '#microsoft.graph.user', displayName: 'Gast', userPrincipalName: 'g_x#EXT#@contoso.com', userType: 'Guest', accountEnabled: true },
            { id: 'sub', '@odata.type': '#microsoft.graph.group', displayName: 'Nested' },
          ],
        };
      }
      return row('a', { owners: [{ id: 'o1', displayName: 'Owner', userPrincipalName: 'owner@contoso.com' }] });
    });

    const detail = await provider.getGroupDetail(ctx, 'a');
    expect(detail?.available).toBe(true);
    if (!detail || !detail.available) return;
    expect(detail.data.members.map((m) => m.type)).toEqual(['guest', 'user', 'group']);
    expect(detail.data.owners[0]).toMatchObject({ displayName: 'Owner', type: 'user' });
    expect(detail.data.group).toMatchObject({ memberCount: 3, guestCount: 1, flags: ['single-owner', 'has-guests'] });

    graph.get.mockRejectedValue(new GraphApiError(404, 'Request_ResourceNotFound', 'not found'));
    expect(await provider.getGroupDetail(ctx, 'missing')).toBeNull();
  });
});
