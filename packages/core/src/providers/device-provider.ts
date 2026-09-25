/**
 * Device-Provider
 *
 * Fuehrt Intune (Graph deviceManagement) und Defender for Endpoint
 * (api.securitycenter.microsoft.com) zu einem Geraetebestand zusammen.
 * Schluessel ist die Entra-Geraete-ID; fehlt sie, bleibt das Geraet
 * quellenspezifisch. Beide Quellen sind optional (Lizenz, Berechtigung).
 */

import type {
  CapabilityResult,
  Device,
  DeviceComplianceState,
  DeviceDefenderInfo,
  DeviceExposureLevel,
  DeviceHealthStatus,
  DeviceIntuneInfo,
  DeviceInventory,
  DeviceRiskScore,
  DeviceSecurityPosture,
  DeviceVulnerability,
  MissingKb,
  VulnerabilitySeverity,
} from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';
import { GraphApiError } from '../errors.js';

export const DEFENDER_API_BASE_URL = 'https://api.securitycenter.microsoft.com';
export const DEFENDER_SCOPES = [`${DEFENDER_API_BASE_URL}/.default`];

interface GraphManagedDevice {
  id: string;
  deviceName: string | null;
  operatingSystem: string | null;
  osVersion: string | null;
  complianceState: string | null;
  lastSyncDateTime: string | null;
  enrolledDateTime: string | null;
  azureADDeviceId: string | null;
  userPrincipalName: string | null;
  managedDeviceOwnerType: string | null;
  model: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
  isEncrypted: boolean | null;
  managementAgent: string | null;
}

interface DefenderMachine {
  id: string;
  computerDnsName: string | null;
  lastSeen: string | null;
  osPlatform: string | null;
  osVersion: string | null;
  osBuild: number | string | null;
  lastIpAddress: string | null;
  healthStatus: string | null;
  riskScore: string | null;
  exposureLevel: string | null;
  isAadJoined: boolean | null;
  aadDeviceId: string | null;
  machineTags: string[] | null;
  onboardingStatus: string | null;
}

interface DefenderVulnerability {
  id: string;
  name: string;
  description: string | null;
  severity: string | null;
  cvssV3: number | null;
  publishedOn: string | null;
  updatedOn: string | null;
  publicExploit: boolean | null;
  exploitVerified: boolean | null;
}

interface DefenderMissingKb {
  id: string;
  name: string;
  osBuild: string | null;
  productsNames: string[] | null;
  url: string | null;
  machineMissedOn: number | null;
  cveAddressed: number | null;
}

const INTUNE_SELECT = [
  'id',
  'deviceName',
  'operatingSystem',
  'osVersion',
  'complianceState',
  'lastSyncDateTime',
  'enrolledDateTime',
  'azureADDeviceId',
  'userPrincipalName',
  'managedDeviceOwnerType',
  'model',
  'manufacturer',
  'serialNumber',
  'isEncrypted',
  'managementAgent',
].join(',');

const COMPLIANCE_STATES: DeviceComplianceState[] = [
  'compliant',
  'noncompliant',
  'inGracePeriod',
  'conflict',
  'error',
  'notApplicable',
  'unknown',
];
const EXPOSURE_LEVELS: DeviceExposureLevel[] = ['None', 'Low', 'Medium', 'High'];
const RISK_SCORES: DeviceRiskScore[] = ['None', 'Informational', 'Low', 'Medium', 'High'];
const HEALTH_STATUSES: DeviceHealthStatus[] = [
  'Active',
  'Inactive',
  'ImpairedCommunication',
  'NoSensorData',
  'NoSensorDataImpairedCommunication',
];
const SEVERITIES: VulnerabilitySeverity[] = ['Critical', 'High', 'Medium', 'Low'];

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

export class DeviceProvider extends BaseResourceProvider {
  readonly name = 'devices';
  readonly requiredScopes = ['DeviceManagementManagedDevices.Read.All'];

  // Aktionen (Sync, Neustart, Scan) brauchen die privilegierte Intune-Berechtigung
  readonly actionScopes = ['DeviceManagementManagedDevices.PrivilegedOperations.All'];

  // Defender-API (WindowsDefenderATP), eigener Consent
  readonly defenderPermissions = ['Machine.Read.All', 'Vulnerability.Read.All'];

  constructor(
    private readonly graphClient: GraphClient,
    private readonly defenderClient: GraphClient
  ) {
    super();
  }

  async listDevices(ctx: ProviderContext): Promise<DeviceInventory> {
    this.validateContext(ctx);

    const [intune, defender] = await Promise.all([
      this.loadIntuneDevices(ctx),
      this.loadDefenderMachines(ctx),
    ]);

    const items = mergeDevices(intune.available ? intune.data : [], defender.available ? defender.data : []);

    return {
      items,
      intune: intune.available ? { available: true, data: { count: intune.data.length } } : intune,
      defender: defender.available ? { available: true, data: { count: defender.data.length } } : defender,
    };
  }

  async getDevice(ctx: ProviderContext, deviceId: string): Promise<Device | null> {
    const inventory = await this.listDevices(ctx);
    return inventory.items.find((d) => d.id === deviceId) ?? null;
  }

  async getSecurityPosture(ctx: ProviderContext, machineId: string): Promise<DeviceSecurityPosture> {
    this.validateContext(ctx);

    const [vulnerabilities, missingKbs] = await Promise.all([
      this.loadVulnerabilities(ctx, machineId),
      this.loadMissingKbs(ctx, machineId),
    ]);

    return { vulnerabilities, missingKbs };
  }

  async syncDevice(ctx: ProviderContext, managedDeviceId: string): Promise<void> {
    this.validateContext(ctx);
    await this.graphClient.post(
      ctx.tenantId as string,
      `/deviceManagement/managedDevices/${encodeURIComponent(managedDeviceId)}/syncDevice`,
      this.actionScopes,
      {}
    );
  }

  async rebootDevice(ctx: ProviderContext, managedDeviceId: string): Promise<void> {
    this.validateContext(ctx);
    await this.graphClient.post(
      ctx.tenantId as string,
      `/deviceManagement/managedDevices/${encodeURIComponent(managedDeviceId)}/rebootNow`,
      this.actionScopes,
      {}
    );
  }

  async runDefenderScan(ctx: ProviderContext, managedDeviceId: string, quickScan: boolean): Promise<void> {
    this.validateContext(ctx);
    await this.graphClient.post(
      ctx.tenantId as string,
      `/deviceManagement/managedDevices/${encodeURIComponent(managedDeviceId)}/windowsDefenderScan`,
      this.actionScopes,
      { quickScan }
    );
  }

  private async loadIntuneDevices(ctx: ProviderContext): Promise<CapabilityResult<GraphManagedDevice[]>> {
    const tenantId = ctx.tenantId as string;
    const devices: GraphManagedDevice[] = [];
    let next: string | null = `/deviceManagement/managedDevices?$select=${INTUNE_SELECT}&$top=500`;

    try {
      while (next) {
        const page: GraphResponse<GraphManagedDevice[]> = await this.graphClient.get<GraphResponse<GraphManagedDevice[]>>(
          tenantId,
          next,
          this.requiredScopes
        );
        devices.push(...page.value);
        next = page['@odata.nextLink'] ?? null;
      }
    } catch (error) {
      const unavailable = asUnavailable(error, 'DeviceManagementManagedDevices.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }

    return { available: true, data: devices };
  }

  private async loadDefenderMachines(ctx: ProviderContext): Promise<CapabilityResult<DefenderMachine[]>> {
    try {
      const response = await this.defenderClient.get<GraphResponse<DefenderMachine[]>>(
        ctx.tenantId as string,
        '/api/machines',
        DEFENDER_SCOPES
      );
      return { available: true, data: response.value };
    } catch (error) {
      const unavailable = asUnavailable(error, 'Machine.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  private async loadVulnerabilities(
    ctx: ProviderContext,
    machineId: string
  ): Promise<CapabilityResult<DeviceVulnerability[]>> {
    try {
      const response = await this.defenderClient.get<GraphResponse<DefenderVulnerability[]>>(
        ctx.tenantId as string,
        `/api/machines/${encodeURIComponent(machineId)}/vulnerabilities`,
        DEFENDER_SCOPES
      );
      return {
        available: true,
        data: response.value.map(mapVulnerability).sort(bySeverityThenScore),
      };
    } catch (error) {
      const unavailable = asUnavailable(error, 'Vulnerability.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  private async loadMissingKbs(ctx: ProviderContext, machineId: string): Promise<CapabilityResult<MissingKb[]>> {
    try {
      const response = await this.defenderClient.get<GraphResponse<DefenderMissingKb[]>>(
        ctx.tenantId as string,
        `/api/machines/${encodeURIComponent(machineId)}/getmissingkbs`,
        DEFENDER_SCOPES
      );
      return {
        available: true,
        data: response.value.map(mapMissingKb).sort((a, b) => b.cveAddressed - a.cveAddressed),
      };
    } catch (error) {
      const unavailable = asUnavailable(error, 'Vulnerability.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }
}

// AADSTS500011: Ressource im Tenant unbekannt, d. h. kein Defender for Endpoint
function asUnavailable(error: unknown, permission: string): Unavailable | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/AADSTS500011/.test(message)) {
    return { available: false, reason: 'not-licensed', missingPermission: null, detail: message };
  }
  if (!(error instanceof GraphApiError)) {
    return null;
  }
  if (error.statusCode === 404) {
    return { available: false, reason: 'not-onboarded', missingPermission: null, detail: error.message };
  }
  if (error.isAuthError) {
    return { available: false, reason: 'permission-missing', missingPermission: permission, detail: error.message };
  }
  return null;
}

export function mergeDevices(intune: GraphManagedDevice[], defender: DefenderMachine[]): Device[] {
  const byKey = new Map<string, Device>();

  for (const md of intune) {
    const key = md.azureADDeviceId ? md.azureADDeviceId.toLowerCase() : `intune:${md.id}`;
    byKey.set(key, {
      id: key,
      name: md.deviceName ?? md.id,
      azureAdDeviceId: md.azureADDeviceId?.toLowerCase() ?? null,
      operatingSystem: md.operatingSystem,
      osVersion: md.osVersion,
      primaryUser: md.userPrincipalName,
      lastActivityAt: md.lastSyncDateTime,
      intune: mapIntune(md),
      defender: null,
    });
  }

  // Zweiter Schluessel fuer Geraete ohne Entra-ID: Hostname ohne Domaene
  const byHostname = new Map<string, Device>();
  for (const device of byKey.values()) {
    byHostname.set(shortHostname(device.name), device);
  }

  for (const machine of defender) {
    const aadKey = machine.aadDeviceId?.toLowerCase() ?? null;
    const hostname = shortHostname(machine.computerDnsName ?? '');
    const existing = (aadKey && byKey.get(aadKey)) || (hostname && byHostname.get(hostname)) || null;
    const info = mapDefender(machine);

    if (existing) {
      existing.defender = info;
      existing.azureAdDeviceId = existing.azureAdDeviceId ?? aadKey;
      existing.osVersion = existing.osVersion ?? machine.osVersion;
      existing.operatingSystem = existing.operatingSystem ?? machine.osPlatform;
      existing.lastActivityAt = latest(existing.lastActivityAt, machine.lastSeen);
      continue;
    }

    const key = aadKey ?? `mde:${machine.id}`;
    const device: Device = {
      id: key,
      name: machine.computerDnsName ?? machine.id,
      azureAdDeviceId: aadKey,
      operatingSystem: machine.osPlatform,
      osVersion: machine.osVersion,
      primaryUser: null,
      lastActivityAt: machine.lastSeen,
      intune: null,
      defender: info,
    };
    byKey.set(key, device);
    if (hostname) byHostname.set(hostname, device);
  }

  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function mapIntune(md: GraphManagedDevice): DeviceIntuneInfo {
  return {
    managedDeviceId: md.id,
    complianceState: oneOf(md.complianceState, COMPLIANCE_STATES, 'unknown'),
    lastSyncAt: md.lastSyncDateTime,
    enrolledAt: md.enrolledDateTime,
    ownerType: md.managedDeviceOwnerType,
    isEncrypted: md.isEncrypted,
    model: md.model,
    manufacturer: md.manufacturer,
    serialNumber: md.serialNumber,
    managementAgent: md.managementAgent,
  };
}

function mapDefender(machine: DefenderMachine): DeviceDefenderInfo {
  return {
    machineId: machine.id,
    healthStatus: oneOf(machine.healthStatus, HEALTH_STATUSES, 'Unknown'),
    exposureLevel: oneOf(machine.exposureLevel, EXPOSURE_LEVELS, 'Unknown'),
    riskScore: oneOf(machine.riskScore, RISK_SCORES, 'Unknown'),
    onboardingStatus: machine.onboardingStatus,
    lastSeenAt: machine.lastSeen,
    lastIpAddress: machine.lastIpAddress,
    osPlatform: machine.osPlatform,
    osBuild: machine.osBuild === null || machine.osBuild === undefined ? null : String(machine.osBuild),
    isAadJoined: machine.isAadJoined,
    tags: machine.machineTags ?? [],
  };
}

function mapVulnerability(v: DefenderVulnerability): DeviceVulnerability {
  return {
    cveId: v.id,
    name: v.name,
    severity: oneOf(v.severity, SEVERITIES, 'Unknown'),
    cvssScore: v.cvssV3 ?? null,
    publishedAt: v.publishedOn,
    updatedAt: v.updatedOn,
    publicExploit: v.publicExploit === true,
    exploitVerified: v.exploitVerified === true,
    description: v.description,
  };
}

function mapMissingKb(kb: DefenderMissingKb): MissingKb {
  return {
    id: kb.id,
    name: kb.name,
    osBuild: kb.osBuild,
    products: kb.productsNames ?? [],
    url: kb.url,
    cveAddressed: kb.cveAddressed ?? 0,
    missingSince: null,
  };
}

const severityRank: Record<VulnerabilitySeverity, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Unknown: 4 };

function bySeverityThenScore(a: DeviceVulnerability, b: DeviceVulnerability): number {
  return severityRank[a.severity] - severityRank[b.severity] || (b.cvssScore ?? 0) - (a.cvssScore ?? 0);
}

function shortHostname(name: string): string {
  return name.split('.')[0].toLowerCase();
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function oneOf<T extends string, F extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: F
): T | F {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
