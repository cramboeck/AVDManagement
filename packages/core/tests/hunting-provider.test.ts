/**
 * Tests fuer den Hunting-Provider (Advanced Hunting, gemockt)
 */

import { describe, it, expect, vi } from 'vitest';
import { HuntingProvider, classifyRemote, deviceConnectionsQuery, tenantConnectionsQuery, toSummaries } from '../src/providers/hunting-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { TenantId } from '@zerostress/types';

const ctx = { tenantId: 't' as TenantId, correlationId: 'c' };

describe('classifyRemote', () => {
  it('sorts addresses into private, public, loopback, link-local and multicast', () => {
    expect(classifyRemote('10.1.2.3')).toBe('private');
    expect(classifyRemote('172.20.0.1')).toBe('private');
    expect(classifyRemote('192.168.1.1')).toBe('private');
    expect(classifyRemote('100.80.1.1')).toBe('private');
    expect(classifyRemote('127.0.0.1')).toBe('loopback');
    expect(classifyRemote('169.254.1.2')).toBe('link-local');
    expect(classifyRemote('239.255.255.250')).toBe('multicast');
    expect(classifyRemote('52.96.1.1')).toBe('public');
    expect(classifyRemote('fd00::1')).toBe('private');
    expect(classifyRemote('2603:1030::1')).toBe('public');
    expect(classifyRemote('::ffff:192.168.0.5')).toBe('private');
    expect(classifyRemote('garbage')).toBe('unknown');
  });
});

describe('queries', () => {
  it('embeds only validated values', () => {
    const q = deviceConnectionsQuery('abc123def456', 7);
    expect(q).toContain("DeviceId == 'abc123def456'");
    expect(q).toContain('ago(7d)');
    expect(deviceConnectionsQuery('abc123def456', 99)).toContain('ago(7d)');
    expect(() => deviceConnectionsQuery("x' or 1==1", 7)).toThrow(/invalid/);
    expect(tenantConnectionsQuery(30, 'internal')).toContain('ipv4_is_private(RemoteIP)');
    expect(tenantConnectionsQuery(30, 'external')).toContain('not(ipv4_is_private(RemoteIP))');
  });
});

describe('HuntingProvider', () => {
  const rows = [
    { RemoteIP: '52.96.1.1', Count: 120, Devices: 4, FirstSeen: '2026-09-20T10:00:00Z', LastSeen: '2026-09-26T09:00:00Z', Ports: [443, 443, 80], Processes: ['OUTLOOK.EXE', 'msedge.exe'], Directions: ['outbound'], Urls: ['outlook.office365.com', ''] },
    { RemoteIP: '192.168.1.10', Count: 30, Devices: 2, FirstSeen: '2026-09-25T10:00:00Z', LastSeen: '2026-09-26T09:00:00Z', Ports: '[445]', Processes: '["System"]', Directions: '["inbound","outbound"]', Urls: '[]' },
    { RemoteIP: '', Count: 1 },
  ];

  it('summarises rows and classifies scope and direction', () => {
    const items = toSummaries(rows);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ remoteIp: '52.96.1.1', remoteUrl: 'outlook.office365.com', scope: 'public', ports: [80, 443], processes: ['outlook.exe', 'msedge.exe'], direction: 'outbound', count: 120, deviceCount: 4 });
    expect(items[1]).toMatchObject({ scope: 'private', ports: [445], direction: 'mixed', remoteUrl: null });
  });

  it('runs the device and tenant queries and reports licence and permission problems', async () => {
    const defender = { post: vi.fn(async () => ({ Schema: [], Results: rows })) };
    const provider = new HuntingProvider(defender as unknown as GraphClient, () => new Date('2026-09-26T10:00:00Z'));
    const device = await provider.getDeviceConnections(ctx, 'abc123def456', 7);
    expect(device.available && device.data).toMatchObject({ days: 7, scope: 'all', totalConnections: 150, truncated: false });
    expect(defender.post.mock.calls[0][1]).toBe('/api/advancedqueries/run');
    const tenant = await provider.getTenantConnections(ctx, 30, 'external');
    expect(tenant.available && tenant.data.items[0].deviceCount).toBe(4);

    const forbidden = { post: vi.fn(async () => { throw new GraphApiError(403, 'Forbidden', 'Missing roles: AdvancedQuery.Read.All'); }) };
    const p2 = new HuntingProvider(forbidden as unknown as GraphClient);
    expect(await p2.getDeviceConnections(ctx, 'abc123def456')).toMatchObject({ available: false, reason: 'permission-missing' });
    const unlicensed = { post: vi.fn(async () => { throw new GraphApiError(403, 'Forbidden', 'Advanced hunting is not supported for this tenant'); }) };
    const p3 = new HuntingProvider(unlicensed as unknown as GraphClient);
    expect(await p3.getTenantConnections(ctx)).toMatchObject({ available: false, reason: 'not-licensed' });
  });
});
