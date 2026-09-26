/**
 * Tests fuer den Firewall-Regelvorschlag
 */

import { describe, it, expect } from 'vitest';
import { buildFirewallProposal, cidrContains, domainMatches, matchM365, parseM365Endpoints } from '../src/security/firewall.js';
import type { ConnectionReport } from '@zerostress/types';

const endpoints = parseM365Endpoints([
  { id: 1, serviceArea: 'Exchange', serviceAreaDisplayName: 'Exchange Online', urls: ['outlook.office.com', 'outlook.office365.com'], ips: ['52.96.0.0/14', '2603:1006::/40'], tcpPorts: '443', category: 'Optimize', required: true },
  { id: 2, serviceArea: 'Common', serviceAreaDisplayName: 'Microsoft 365 Common and Office Online', urls: ['*.office.com', '*.office.net'], ips: [], tcpPorts: '443', category: 'Allow', required: true },
]);

describe('matching helpers', () => {
  it('matches wildcard domains and CIDR ranges for v4 and v6', () => {
    expect(domainMatches('*.office.com', 'www.office.com')).toBe(true);
    expect(domainMatches('*.office.com', 'office.com')).toBe(false);
    expect(domainMatches('outlook.office.com', 'outlook.office.com')).toBe(true);
    expect(domainMatches('winatp-gw-*.microsoft.com', 'winatp-gw-neu.microsoft.com')).toBe(true);
    expect(cidrContains('52.96.0.0/14', '52.98.1.1')).toBe(true);
    expect(cidrContains('52.96.0.0/14', '52.100.1.1')).toBe(false);
    expect(cidrContains('2603:1006::/40', '2603:1006:40::5')).toBe(true);
    expect(cidrContains('2603:1006::/40', '2603:1006:1400::5')).toBe(false);
    expect(cidrContains('2603:1006::/40', '2603:1030::1')).toBe(false);
    expect(cidrContains('10.0.0.0/8', 'garbage')).toBe(false);
  });

  it('prefers a host match, then an ip match', () => {
    expect(matchM365({ remoteIp: '1.2.3.4', remoteUrl: 'www.office.com' }, endpoints)?.serviceArea).toBe('Common');
    expect(matchM365({ remoteIp: '52.97.5.5', remoteUrl: null }, endpoints)?.serviceArea).toBe('Exchange');
    expect(matchM365({ remoteIp: '8.8.8.8', remoteUrl: 'dns.google' }, endpoints)).toBeNull();
  });
});

describe('buildFirewallProposal', () => {
  const report: ConnectionReport = {
    days: 7,
    scope: 'external',
    generatedAt: 'x',
    totalConnections: 0,
    truncated: false,
    items: [
      { remoteIp: '52.97.5.5', remoteUrl: 'outlook.office365.com', scope: 'public', ports: [443], processes: ['outlook.exe'], direction: 'outbound', count: 500, deviceCount: 12, firstSeen: null, lastSeen: '2026-09-26T08:00:00.000Z' },
      { remoteIp: '13.107.6.1', remoteUrl: 'www.office.com', scope: 'public', ports: [443], processes: ['msedge.exe'], direction: 'outbound', count: 50, deviceCount: 5, firstSeen: null, lastSeen: null },
      { remoteIp: '20.1.1.1', remoteUrl: 'dl.delivery.mp.microsoft.com', scope: 'public', ports: [80, 443], processes: ['svchost.exe'], direction: 'outbound', count: 300, deviceCount: 12, firstSeen: null, lastSeen: null },
      { remoteIp: '142.250.1.1', remoteUrl: 'update.googleapis.com', scope: 'public', ports: [443], processes: ['googleupdate.exe'], direction: 'outbound', count: 40, deviceCount: 9, firstSeen: null, lastSeen: null },
      { remoteIp: '93.184.216.34', remoteUrl: 'api.branchenapp.de', scope: 'public', ports: [443, 8443], processes: ['branchenapp.exe'], direction: 'outbound', count: 20, deviceCount: 3, firstSeen: null, lastSeen: null },
      { remoteIp: '93.184.216.35', remoteUrl: 'cdn.branchenapp.de', scope: 'public', ports: [443], processes: ['branchenapp.exe'], direction: 'outbound', count: 5, deviceCount: 3, firstSeen: null, lastSeen: null },
      { remoteIp: '198.51.100.7', remoteUrl: null, scope: 'public', ports: [4444], processes: ['unknown.exe'], direction: 'outbound', count: 2, deviceCount: 1, firstSeen: null, lastSeen: null },
      { remoteIp: '192.168.1.1', remoteUrl: null, scope: 'private', ports: [53], processes: ['svchost.exe'], direction: 'outbound', count: 900, deviceCount: 12, firstSeen: null, lastSeen: null },
    ],
  };

  it('groups destinations into M365 services, known vendors and other domains', () => {
    const proposal = buildFirewallProposal(report, endpoints, '2026092600', new Date('2026-09-26T10:00:00Z'));
    expect(proposal.rules.map((r) => r.name)).toEqual([
      'Microsoft 365: Exchange Online (Optimize)',
      'Microsoft 365: Microsoft 365 Common and Office Online (Allow)',
      'Windows Update und Delivery Optimization',
      'Google (Chrome, Updates, Dienste)',
      'branchenapp.de',
      'Nur IP-Adressen ohne Hostnamen',
    ]);
    expect(proposal.rules[0]).toMatchObject({ kind: 'microsoft365', required: true, devices: 12, ports: [443], processes: ['outlook.exe'] });
    expect(proposal.rules[4]).toMatchObject({ kind: 'other', destinations: ['api.branchenapp.de', 'cdn.branchenapp.de'], ports: [443, 8443], devices: 3 });
    expect(proposal.unmatchedIps).toBe(1);
    expect(proposal.totalDestinations).toBe(7);
    expect(proposal.endpointsVersion).toBe('2026092600');
  });
});
