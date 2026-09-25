/**
 * Tests fuer DeviceProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceProvider, mergeDevices } from '../src/providers/device-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { TenantId } from '@zerostress/types';

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
      });

    const posture = await provider.getSecurityPosture(ctx, 'mde-1');

    expect(posture.vulnerabilities.available && posture.vulnerabilities.data.map((v) => v.cveId)).toEqual(['CVE-3', 'CVE-1', 'CVE-2']);
    expect(posture.missingKbs.available && posture.missingKbs.data[0]).toMatchObject({
      id: '5041585',
      cveAddressed: 90,
      products: ['windows_11'],
    });
  });

  it('marks a machine unknown to Defender as not onboarded', async () => {
    defender.get.mockRejectedValue(new GraphApiError(404, 'NotFound', 'Machine not found'));

    const posture = await provider.getSecurityPosture(ctx, 'missing');

    expect(posture.vulnerabilities).toMatchObject({ available: false, reason: 'not-onboarded' });
    expect(posture.missingKbs).toMatchObject({ available: false, reason: 'not-onboarded' });
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
});
