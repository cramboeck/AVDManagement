/**
 * Tests fuer DeviceProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceProvider, mergeDevices, buildNetworkTopology, subnetOf } from '../src/providers/device-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { Device, TenantId } from '@zerostress/types';

const intuneDevice = (overrides: Record<string, unknown> = {}) => ({
  id: 'md-1',
  deviceName: 'LAPTOP-01',
  operatingSystem: 'Windows',
  osVersion: '10.0.22631.4037',
  complianceState: 'compliant',
  lastSyncDateTime: '2026-09-25T06:00:00Z',
  enrolledDateTime: '2025-01-01T00:00:00Z',
  azureADDeviceId: 'AAD-0001',
  userPrincipalName: 'max@contoso.com',
  managedDeviceOwnerType: 'company',
  model: 'Latitude 5540',
  manufacturer: 'Dell',
  serialNumber: 'SN1',
  isEncrypted: true,
  managementAgent: 'mdm',
  ...overrides,
});

const defenderMachine = (overrides: Record<string, unknown> = {}) => ({
  id: 'mde-1',
  computerDnsName: 'laptop-01.contoso.local',
  lastSeen: '2026-09-25T08:00:00Z',
  osPlatform: 'Windows11',
  osVersion: '23H2',
  osBuild: 22631,
  lastIpAddress: '10.0.0.5',
  healthStatus: 'Active',
  riskScore: 'Medium',
  exposureLevel: 'High',
  isAadJoined: true,
  aadDeviceId: 'aad-0001',
  machineTags: ['Finance'],
  onboardingStatus: 'Onboarded',
  ...overrides,
});

describe('mergeDevices', () => {
  it('joins Intune and Defender by Entra device id regardless of casing', () => {
    const devices = mergeDevices([intuneDevice()], [defenderMachine()]);

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: 'aad-0001',
      name: 'LAPTOP-01',
      primaryUser: 'max@contoso.com',
      lastActivityAt: '2026-09-25T08:00:00Z',
      intune: { complianceState: 'compliant', isEncrypted: true },
      defender: { exposureLevel: 'High', riskScore: 'Medium', healthStatus: 'Active', tags: ['Finance'] },
    });
  });

  it('falls back to the short hostname when Defender has no Entra id', () => {
    const devices = mergeDevices(
      [intuneDevice({ azureADDeviceId: null })],
      [defenderMachine({ aadDeviceId: null })]
    );

    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe('intune:md-1');
    expect(devices[0].defender?.machineId).toBe('mde-1');
  });

  it('keeps devices that exist in only one source', () => {
    const devices = mergeDevices(
      [intuneDevice()],
      [defenderMachine({ id: 'mde-2', computerDnsName: 'server-01.contoso.local', aadDeviceId: null })]
    );

    expect(devices.map((d) => d.id).sort()).toEqual(['aad-0001', 'mde:mde-2']);
    const server = devices.find((d) => d.id === 'mde:mde-2');
    expect(server?.intune).toBeNull();
    expect(server?.operatingSystem).toBe('Windows11');
  });

  it('maps unknown enum values to Unknown instead of failing', () => {
    const devices = mergeDevices(
      [intuneDevice({ complianceState: 'weird' })],
      [defenderMachine({ exposureLevel: 'Extreme', riskScore: null })]
    );

    expect(devices[0].intune?.complianceState).toBe('unknown');
    expect(devices[0].defender?.exposureLevel).toBe('Unknown');
    expect(devices[0].defender?.riskScore).toBe('Unknown');
  });
});

describe('DeviceProvider', () => {
  let provider: DeviceProvider;
  let graph: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  let defender: { get: ReturnType<typeof vi.fn> };
  const ctx = { tenantId: 'tenant-1' as TenantId, correlationId: 'corr' };

  beforeEach(() => {
    graph = { get: vi.fn(), post: vi.fn() };
    defender = { get: vi.fn() };
    provider = new DeviceProvider(graph as unknown as GraphClient, defender as unknown as GraphClient);
  });

  it('follows Intune paging and reports both source counts', async () => {
    graph.get
      .mockResolvedValueOnce({ value: [intuneDevice()], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next' })
      .mockResolvedValueOnce({ value: [intuneDevice({ id: 'md-2', deviceName: 'LAPTOP-02', azureADDeviceId: 'aad-0002' })] });
    defender.get.mockResolvedValueOnce({ value: [defenderMachine()] });

    const inventory = await provider.listDevices(ctx);

    expect(graph.get).toHaveBeenCalledTimes(2);
    expect(graph.get.mock.calls[1][1]).toBe('https://graph.microsoft.com/v1.0/next');
    expect(inventory.items).toHaveLength(2);
    expect(inventory.intune).toEqual({ available: true, data: { count: 2 } });
    expect(inventory.defender).toEqual({ available: true, data: { count: 1 } });
  });

  it('treats a tenant without Defender for Endpoint as not licensed and keeps Intune data', async () => {
    graph.get.mockResolvedValueOnce({ value: [intuneDevice()] });
    defender.get.mockRejectedValueOnce(
      new Error('invalid_resource: AADSTS500011: The resource principal named https://api.securitycenter.microsoft.com was not found in the tenant')
    );

    const inventory = await provider.listDevices(ctx);

    expect(inventory.items).toHaveLength(1);
    expect(inventory.defender).toMatchObject({ available: false, reason: 'not-licensed' });
  });

  it('reports a missing Intune permission without dropping Defender devices', async () => {
    graph.get.mockRejectedValueOnce(new GraphApiError(403, 'Authorization_RequestDenied', 'Insufficient privileges'));
    defender.get.mockResolvedValueOnce({ value: [defenderMachine()] });

    const inventory = await provider.listDevices(ctx);

    expect(inventory.intune).toMatchObject({
      available: false,
      reason: 'permission-missing',
      missingPermission: 'DeviceManagementManagedDevices.Read.All',
    });
    expect(inventory.items[0].id).toBe('aad-0001');
  });

  it('rethrows throttling so the caller can back off', async () => {
    graph.get.mockRejectedValueOnce(new GraphApiError(429, 'TooManyRequests', 'Slow down', 5));
    defender.get.mockResolvedValueOnce({ value: [] });

    await expect(provider.listDevices(ctx)).rejects.toMatchObject({ statusCode: 429 });
  });

  it('sorts vulnerabilities by severity and score and maps missing KBs', async () => {
    defender.get
      .mockResolvedValueOnce({
        value: [
          { id: 'CVE-2', name: 'Low one', severity: 'Low', cvssV3: 3.1, publishedOn: '2026-01-01T00:00:00Z', updatedOn: null, publicExploit: false, exploitVerified: false, description: '' },
          { id: 'CVE-1', name: 'Critical one', severity: 'Critical', cvssV3: 9.8, publishedOn: '2026-02-01T00:00:00Z', updatedOn: null, publicExploit: true, exploitVerified: true, description: 'RCE' },
          { id: 'CVE-3', name: 'Critical two', severity: 'Critical', cvssV3: 9.9, publishedOn: null, updatedOn: null, publicExploit: false, exploitVerified: false, description: null },
        ],
      })
      .mockResolvedValueOnce({
        value: [
          { id: '5041585', name: 'August 2024 Security Update', osBuild: '22631.4037', productsNames: ['windows_11'], url: 'https://support.microsoft.com/kb/5041585', machineMissedOn: 1, cveAddressed: 90 },
        ],
      })
      .mockResolvedValueOnce({ value: [] });

    const posture = await provider.getSecurityPosture(ctx, 'mde-1');

    expect(posture.missingKbsSource).toBe('defender');
    expect(posture.software).toEqual({ available: true, data: [] });

    expect(posture.vulnerabilities.available && posture.vulnerabilities.data.map((v) => v.cveId)).toEqual(['CVE-3', 'CVE-1', 'CVE-2']);
    expect(posture.missingKbs.available && posture.missingKbs.data[0]).toMatchObject({
      id: '5041585',
      cveAddressed: 90,
      products: ['windows_11'],
    });
  });

  it('derives missing KBs from machine vulnerabilities when Software.Read.All is missing', async () => {
    defender.get.mockImplementation(async (_tenant: string, path: string) => {
      if (path.endsWith('/getmissingkbs')) {
        throw new GraphApiError(
          403,
          'Forbidden',
          'Missing application roles. API required roles: Software.Read.All, application roles: Vulnerability.Read.All,Machine.Read.All.'
        );
      }
      if (path.includes('machinesVulnerabilities')) {
        expect(decodeURIComponent(path)).toContain("machineId eq 'mde-1'");
        return {
          value: [
            { id: 'a', cveId: 'CVE-1', machineId: 'mde-1', fixingKbId: '5041585', productName: 'windows_11', productVendor: 'microsoft', productVersion: '23H2', severity: 'Critical' },
            { id: 'b', cveId: 'CVE-2', machineId: 'mde-1', fixingKbId: '5041585', productName: 'windows_11', productVendor: 'microsoft', productVersion: '23H2', severity: 'High' },
            { id: 'c', cveId: 'CVE-3', machineId: 'mde-1', fixingKbId: null, productName: 'chrome', productVendor: 'google', productVersion: '128', severity: 'Medium' },
          ],
        };
      }
      return { value: [] };
    });

    const posture = await provider.getSecurityPosture(ctx, 'mde-1');

    expect(posture.missingKbsSource).toBe('derived');
    expect(posture.missingKbs.available && posture.missingKbs.data).toEqual([
      expect.objectContaining({ id: '5041585', cveAddressed: 2, products: ['microsoft windows_11'] }),
    ]);
    expect(posture.software.available && posture.software.data).toEqual([
      expect.objectContaining({ name: 'windows_11', version: '23H2', cveCount: 2, highestSeverity: 'Critical', fixingKbIds: ['5041585'] }),
      expect.objectContaining({ name: 'chrome', vendor: 'google', cveCount: 1, highestSeverity: 'Medium', fixingKbIds: [] }),
    ]);
  });

  it('attaches affected products to the machines of a CVE', async () => {
    defender.get.mockImplementation(async (_tenant: string, path: string) => {
      if (path.endsWith('/machineReferences')) {
        return { value: [{ id: 'mde-1', computerDnsName: 'laptop-01.contoso.local', osPlatform: 'Windows11', rbacGroupName: null }] };
      }
      if (path.includes('machinesVulnerabilities')) {
        expect(decodeURIComponent(path)).toContain("cveId eq 'CVE-1'");
        return {
          value: [
            { id: 'a', cveId: 'CVE-1', machineId: 'mde-1', fixingKbId: '5041585', productName: 'windows_11', productVendor: 'microsoft', productVersion: '23H2', severity: 'Critical' },
          ],
        };
      }
      return { value: [] };
    });

    const result = await provider.getVulnerabilityMachines(ctx, 'CVE-1');

    expect(result.available && result.data[0].products).toEqual([
      { name: 'microsoft windows_11', version: '23H2', fixingKbId: '5041585' },
    ]);
  });

  it('reports the role the Defender API actually demands when no fallback is possible', async () => {
    defender.get.mockImplementation(async (_tenant: string, path: string) => {
      if (path.endsWith('/getmissingkbs')) {
        throw new GraphApiError(403, 'Forbidden', 'Missing application roles. API required roles: Software.Read.All, application roles: Machine.Read.All.');
      }
      if (path.includes('machinesVulnerabilities')) {
        throw new GraphApiError(403, 'Forbidden', 'Missing application roles. API required roles: Vulnerability.Read.All, application roles: Machine.Read.All.');
      }
      return { value: [] };
    });

    const posture = await provider.getSecurityPosture(ctx, 'mde-1');

    expect(posture.missingKbsSource).toBeNull();
    expect(posture.missingKbs).toMatchObject({
      available: false,
      reason: 'permission-missing',
      missingPermission: 'Software.Read.All',
    });
  });

  it('marks a machine unknown to Defender as not onboarded', async () => {
    defender.get.mockRejectedValue(new GraphApiError(404, 'NotFound', 'Machine not found'));

    const posture = await provider.getSecurityPosture(ctx, 'missing');

    expect(posture.vulnerabilities).toMatchObject({ available: false, reason: 'not-onboarded' });
    expect(posture.missingKbs).toMatchObject({ available: false, reason: 'not-onboarded' });
    expect(posture.missingKbsSource).toBeNull();
  });

  it('maps a vulnerability detail including exploit metadata', async () => {
    defender.get.mockResolvedValueOnce({
      id: 'CVE-2026-1234',
      name: 'Windows Kernel Elevation of Privilege',
      description: 'A local attacker could gain SYSTEM.',
      severity: 'High',
      cvssV3: 7.8,
      cvssVector: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
      exposedMachines: 12,
      publishedOn: '2026-08-12T00:00:00Z',
      updatedOn: '2026-09-01T00:00:00Z',
      publicExploit: true,
      exploitVerified: false,
      exploitInKit: false,
      exploitTypes: ['Local privilege escalation'],
      exploitUris: ['https://example.com/poc'],
      epss: 0.42,
    });

    const result = await provider.getVulnerability(ctx, 'CVE-2026-1234');

    expect(result.available && result.data).toMatchObject({
      cveId: 'CVE-2026-1234',
      severity: 'High',
      cvssScore: 7.8,
      exposedMachines: 12,
      publicExploit: true,
      exploitTypes: ['Local privilege escalation'],
      epssFromDefender: 0.42,
    });
    expect(defender.get.mock.calls[0][1]).toBe('/api/vulnerabilities/CVE-2026-1234');
  });

  it('groups tenant vulnerabilities by CVE with device counts, products and fixing KBs', async () => {
    defender.get.mockResolvedValueOnce({
      value: [
        { id: 'a', cveId: 'CVE-1', machineId: 'm1', fixingKbId: '5041585', productName: 'windows_11', productVendor: 'microsoft', productVersion: '23H2', severity: 'Critical' },
        { id: 'b', cveId: 'CVE-1', machineId: 'm2', fixingKbId: '5041585', productName: 'windows_11', productVendor: 'microsoft', productVersion: '23H2', severity: 'Critical' },
        { id: 'c', cveId: 'CVE-1', machineId: 'm2', fixingKbId: '5041590', productName: 'windows_10', productVendor: 'microsoft', productVersion: '22H2', severity: 'Critical' },
        { id: 'd', cveId: 'CVE-2', machineId: 'm3', fixingKbId: null, productName: 'chrome', productVendor: 'google', productVersion: '128', severity: 'Medium' },
        { id: 'e', cveId: 'CVE-3', machineId: 'm1', fixingKbId: null, productName: 'reader', productVendor: 'adobe', productVersion: '24', severity: 'High' },
      ],
    });

    const result = await provider.getTenantVulnerabilities(ctx);

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.data.truncated).toBe(false);
    expect(result.data.items.map((i) => i.cveId)).toEqual(['CVE-1', 'CVE-3', 'CVE-2']);
    expect(result.data.items[0]).toMatchObject({
      deviceCount: 2,
      products: ['microsoft windows_10', 'microsoft windows_11'],
      fixingKbIds: ['5041585', '5041590'],
    });
  });

  it('passes the severity filter to Defender', async () => {
    defender.get.mockResolvedValueOnce({ value: [] });

    await provider.getTenantVulnerabilities(ctx, { severity: 'Critical' });

    expect(decodeURIComponent(defender.get.mock.calls[0][1] as string)).toContain("severity eq 'Critical'");
  });

  it('lists recovery metadata without secrets and sorts BitLocker keys newest first', async () => {
    graph.get.mockImplementation(async (_tenant: string, path: string) => {
      if (path.includes('/bitlocker/recoveryKeys')) {
        expect(decodeURIComponent(path)).toContain("deviceId eq 'aad-0001'");
        return {
          value: [
            { id: 'k-old', createdDateTime: '2025-01-01T00:00:00Z', volumeType: 'fixedDataVolume', deviceId: 'aad-0001' },
            { id: 'k-new', createdDateTime: '2026-03-01T00:00:00Z', volumeType: 'operatingSystemVolume', deviceId: 'aad-0001' },
          ],
        };
      }
      if (path.includes('/deviceLocalCredentials/')) {
        expect(path).not.toContain('credentials');
        return { id: 'aad-0001', deviceName: 'LAPTOP-01', lastBackupDateTime: '2026-09-20T00:00:00Z', refreshDateTime: '2026-10-20T00:00:00Z' };
      }
      return { value: [] };
    });

    const result = await provider.getRecoveryMetadata(ctx, 'aad-0001');

    expect(result.bitlocker.available && result.bitlocker.data.map((k) => k.id)).toEqual(['k-new', 'k-old']);
    expect(JSON.stringify(result)).not.toContain('key"');
    expect(result.laps.available && result.laps.data).toEqual({
      deviceName: 'LAPTOP-01',
      lastBackupAt: '2026-09-20T00:00:00Z',
      refreshAt: '2026-10-20T00:00:00Z',
    });
  });

  it('reports missing recovery permissions per source and handles devices without Entra id', async () => {
    graph.get.mockRejectedValue(new GraphApiError(403, 'Authorization_RequestDenied', 'Insufficient privileges'));

    const result = await provider.getRecoveryMetadata(ctx, 'aad-0001');
    expect(result.bitlocker).toMatchObject({ available: false, missingPermission: 'BitLockerKey.ReadBasic.All' });
    expect(result.laps).toMatchObject({ available: false, missingPermission: 'DeviceLocalCredential.ReadBasic.All' });

    const noId = await provider.getRecoveryMetadata(ctx, null);
    expect(noId.bitlocker).toMatchObject({ available: false, reason: 'not-onboarded' });
  });

  it('reveals a BitLocker key and decodes LAPS passwords from base64', async () => {
    graph.get.mockImplementation(async (_tenant: string, path: string) => {
      if (path.includes('/bitlocker/recoveryKeys/k-new')) {
        expect(path).toContain('$select=key');
        return { id: 'k-new', key: '123456-654321-111111-222222-333333-444444-555555-666666', volumeType: 'operatingSystemVolume', createdDateTime: '2026-03-01T00:00:00Z' };
      }
      if (path.includes('/deviceLocalCredentials/')) {
        expect(path).toContain('$select=credentials');
        return {
          id: 'aad-0001',
          deviceName: 'LAPTOP-01',
          credentials: [
            { accountName: 'Administrator', backupDateTime: '2026-09-01T00:00:00Z', passwordBase64: Buffer.from('Old-Pass-1', 'utf8').toString('base64') },
            { accountName: 'Administrator', backupDateTime: '2026-09-20T00:00:00Z', passwordBase64: Buffer.from('New-Pass-2', 'utf8').toString('base64') },
          ],
        };
      }
      return { value: [] };
    });

    const key = await provider.revealBitLockerKey(ctx, 'k-new');
    expect(key.key).toBe('123456-654321-111111-222222-333333-444444-555555-666666');

    const laps = await provider.revealLocalCredentials(ctx, 'aad-0001');
    expect(laps.credentials.map((c) => c.password)).toEqual(['New-Pass-2', 'Old-Pass-1']);
  });

  it('posts Intune actions with the privileged scope', async () => {
    graph.post.mockResolvedValue(undefined);

    await provider.runDefenderScan(ctx, 'md-1', false);

    expect(graph.post).toHaveBeenCalledWith(
      'tenant-1',
      '/deviceManagement/managedDevices/md-1/windowsDefenderScan',
      ['DeviceManagementManagedDevices.PrivilegedOperations.All'],
      { quickScan: false }
    );
  });

  it('lists detected apps across pages, sorted by name', async () => {
    graph.get.mockImplementation(async (_tenant: string, path: string) => {
      if (path.includes('$skiptoken=2')) {
        return { value: [{ id: 'a2', displayName: 'Adobe Acrobat', version: '24.1', publisher: 'Adobe', platform: 'windows', sizeInByte: 1024 }] };
      }
      return {
        value: [{ id: 'a1', displayName: 'Google Chrome', version: '129.0', publisher: 'Google LLC', platform: 'windows', sizeInByte: null }],
        '@odata.nextLink': 'https://graph.microsoft.com/beta/deviceManagement/managedDevices/md-1/detectedApps?$skiptoken=2',
      };
    });

    const result = await provider.listDetectedApps(ctx, 'md-1');

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.data.map((a) => a.displayName)).toEqual(['Adobe Acrobat', 'Google Chrome']);
    expect(result.data[0]).toMatchObject({ version: '24.1', publisher: 'Adobe', sizeBytes: 1024 });
    expect(result.data[1].sizeBytes).toBeNull();
    expect(graph.get.mock.calls[0][1]).toBe('https://graph.microsoft.com/beta/deviceManagement/managedDevices/md-1/detectedApps?$top=500');
  });

  it('reports a missing Intune read permission for detected apps', async () => {
    graph.get.mockRejectedValue(new GraphApiError(403, 'Forbidden', 'Application is not authorized'));
    const result = await provider.listDetectedApps(ctx, 'md-1');
    expect(result).toMatchObject({ available: false, reason: 'permission-missing', missingPermission: 'DeviceManagementManagedDevices.Read.All' });
  });
});

describe('buildNetworkTopology', () => {
  const device = (id: string, ip: string | null, external: string | null): Device => ({
    id,
    name: id.toUpperCase(),
    azureAdDeviceId: null,
    operatingSystem: 'Windows',
    osVersion: null,
    primaryUser: null,
    lastActivityAt: null,
    intune: null,
    defender:
      ip === null && external === null
        ? null
        : {
            machineId: `m-${id}`,
            healthStatus: 'Active',
            exposureLevel: 'Low',
            riskScore: 'Low',
            onboardingStatus: 'Onboarded',
            lastSeenAt: null,
            lastIpAddress: ip,
            lastExternalIpAddress: external,
            osPlatform: 'Windows11',
            osBuild: null,
            isAadJoined: true,
            tags: [],
          },
  });

  it('groups devices by external address and /24 subnet, biggest first', () => {
    const topology = buildNetworkTopology([
      device('a', '10.0.1.20', '203.0.113.5'),
      device('b', '10.0.1.3', '203.0.113.5'),
      device('c', '10.0.2.7', '203.0.113.5'),
      device('d', '192.168.178.40', '198.51.100.9'),
      device('e', '10.0.9.1', null),
      device('f', null, null),
    ]);

    expect(topology.sites.map((s) => [s.externalIp, s.deviceCount])).toEqual([
      ['203.0.113.5', 3],
      ['198.51.100.9', 1],
      [null, 1],
    ]);
    expect(topology.sites[0].subnets.map((s) => s.cidr)).toEqual(['10.0.1.0/24', '10.0.2.0/24']);
    expect(topology.sites[0].subnets[0].devices.map((d) => d.ipAddress)).toEqual(['10.0.1.3', '10.0.1.20']);
    expect(topology.withoutAddress.map((d) => d.id)).toEqual(['f']);
  });

  it('derives subnets for IPv4 and IPv6', () => {
    expect(subnetOf('172.16.5.200')).toBe('172.16.5.0/24');
    expect(subnetOf('fe80:1:2:3:4:5:6:7')).toBe('fe80:1:2:3::/64');
    expect(subnetOf('garbage')).toBe('unbekannt');
  });
});

describe('DeviceProvider network detail', () => {
  it('reads interfaces from the single machine and formats MAC addresses', async () => {
    const graph = { get: vi.fn(), post: vi.fn() };
    const defender = {
      get: vi.fn(async () => ({
        id: 'mde-1',
        lastIpAddress: '10.0.1.20',
        lastExternalIpAddress: '203.0.113.5',
        ipAddresses: [
          { ipAddress: 'fe80::1', macAddress: '001122AABBCC', type: 'Ethernet', operationalStatus: 'Down' },
          { ipAddress: '10.0.1.20', macAddress: '001122AABBCC', type: 'Ethernet', operationalStatus: 'Up' },
          { ipAddress: null, macAddress: null, type: null, operationalStatus: null },
        ],
      })),
    };
    const provider = new DeviceProvider(graph as unknown as GraphClient, defender as unknown as GraphClient);

    const result = await provider.getDeviceNetwork({ tenantId: 'tenant-1' as TenantId, correlationId: 'c' }, 'mde-1');

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.data.lastExternalIpAddress).toBe('203.0.113.5');
    expect(result.data.interfaces).toEqual([
      { ipAddress: '10.0.1.20', macAddress: '00:11:22:AA:BB:CC', type: 'Ethernet', status: 'Up' },
      { ipAddress: 'fe80::1', macAddress: '00:11:22:AA:BB:CC', type: 'Ethernet', status: 'Down' },
    ]);
    expect(defender.get.mock.calls[0][1]).toBe('/api/machines/mde-1');
  });
});
