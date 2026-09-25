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
  VulnerabilityDetail,
  VulnerabilityMachineRef,
  TenantVulnerability,
  VulnerableSoftware,
  ExposureScoreSummary,
  BitLockerKeyMetadata,
  LapsMetadata,
  DeviceRecoveryMetadata,
  RevealedBitLockerKey,
  RevealedLaps,
  DetectedApp,
  DeviceNetworkInfo,
  NetworkTopology,
  NetworkTopologyDevice,
  NetworkSite,
  NetworkSubnet,
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
  totalStorageSpaceInBytes: number | null;
  freeStorageSpaceInBytes: number | null;
  physicalMemoryInBytes: number | null;
  wiFiMacAddress: string | null;
}

interface GraphDetectedApp {
  id: string;
  displayName: string | null;
  version: string | null;
  publisher: string | null;
  platform: string | null;
  sizeInByte: number | null;
}

interface DefenderMachine {
  id: string;
  computerDnsName: string | null;
  lastSeen: string | null;
  osPlatform: string | null;
  osVersion: string | null;
  osBuild: number | string | null;
  lastIpAddress: string | null;
  lastExternalIpAddress?: string | null;
  healthStatus: string | null;
  riskScore: string | null;
  exposureLevel: string | null;
  isAadJoined: boolean | null;
  aadDeviceId: string | null;
  machineTags: string[] | null;
  onboardingStatus: string | null;
  // Nur beim Einzelabruf /api/machines/{id}
  ipAddresses?: { ipAddress: string | null; macAddress: string | null; type: string | null; operationalStatus: string | null }[] | null;
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

interface DefenderVulnerabilityDetail extends DefenderVulnerability {
  cvssVector?: string | null;
  exposedMachines?: number | null;
  firstDetected?: string | null;
  exploitInKit?: boolean | null;
  exploitTypes?: string[] | null;
  exploitUris?: string[] | null;
  epss?: number | null;
}

interface DefenderMachineReference {
  id: string;
  computerDnsName: string | null;
  osPlatform: string | null;
  rbacGroupName: string | null;
  detectionTime?: string | null;
}

interface DefenderMachineVulnerability {
  id: string;
  cveId: string;
  machineId: string;
  fixingKbId: string | null;
  productName: string | null;
  productVendor: string | null;
  productVersion: string | null;
  severity: string | null;
}

const MACHINE_VULNERABILITY_PAGE_SIZE = 10000;
const MACHINE_VULNERABILITY_MAX_PAGES = 3;

interface GraphBitLockerKey {
  id: string;
  createdDateTime: string;
  volumeType?: string | null;
  deviceId?: string | null;
  key?: string;
}

interface GraphDeviceLocalCredentialInfo {
  id: string;
  deviceName?: string | null;
  lastBackupDateTime?: string | null;
  refreshDateTime?: string | null;
  credentials?: {
    accountName?: string | null;
    accountSid?: string | null;
    backupDateTime?: string | null;
    passwordBase64?: string | null;
  }[];
}

const BITLOCKER_VOLUME_TYPES: BitLockerKeyMetadata['volumeType'][] = [
  'operatingSystemVolume',
  'fixedDataVolume',
  'removableDataVolume',
];

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
  'totalStorageSpaceInBytes',
  'freeStorageSpaceInBytes',
  'physicalMemoryInBytes',
  'wiFiMacAddress',
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

  // Defender-API (WindowsDefenderATP), eigener Consent.
  // Software.Read.All braucht der Endpunkt fuer fehlende KBs.
  readonly defenderPermissions = ['Machine.Read.All', 'Vulnerability.Read.All', 'Software.Read.All'];

  // Wiederherstellungsschluessel: Read.All deckt Metadaten und Aufdecken ab
  readonly bitlockerScopes = ['BitLockerKey.Read.All'];
  readonly lapsScopes = ['DeviceLocalCredential.Read.All'];

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

    const [vulnerabilities, directKbs, rows] = await Promise.all([
      this.loadVulnerabilities(ctx, machineId),
      this.loadMissingKbs(ctx, machineId),
      this.loadMachineVulnerabilityRows(ctx, `machineId eq '${machineId}'`),
    ]);

    const software: CapabilityResult<VulnerableSoftware[]> = rows.available
      ? { available: true, data: groupSoftware(rows.data) }
      : rows;

    if (directKbs.available) {
      return { vulnerabilities, missingKbs: directKbs, missingKbsSource: 'defender', software };
    }

    // Ohne Software.Read.All: behebende KBs aus den Schwachstellen des Geraets ableiten
    if (directKbs.reason === 'permission-missing' && rows.available) {
      return { vulnerabilities, missingKbs: { available: true, data: deriveMissingKbs(rows.data) }, missingKbsSource: 'derived', software };
    }

    return { vulnerabilities, missingKbs: directKbs, missingKbsSource: null, software };
  }

  // Schwachstellenzeilen (Geraet x CVE x Produkt) nach OData-Filter; Basis fuer
  // abgeleitete KBs, verwundbare Software und Produktspalten je Geraet
  private async loadMachineVulnerabilityRows(
    ctx: ProviderContext,
    filter: string
  ): Promise<CapabilityResult<DefenderMachineVulnerability[]>> {
    try {
      const response = await this.defenderClient.get<GraphResponse<DefenderMachineVulnerability[]>>(
        ctx.tenantId as string,
        `/api/vulnerabilities/machinesVulnerabilities?$filter=${encodeURIComponent(filter)}&$top=${MACHINE_VULNERABILITY_PAGE_SIZE}`,
        DEFENDER_SCOPES
      );
      return { available: true, data: response.value };
    } catch (error) {
      const unavailable = asUnavailable(error, 'Vulnerability.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  async getExposureScore(ctx: ProviderContext): Promise<CapabilityResult<ExposureScoreSummary>> {
    this.validateContext(ctx);

    try {
      const response = await this.defenderClient.get<{ score: number; time?: string | null }>(
        ctx.tenantId as string,
        '/api/exposureScore',
        DEFENDER_SCOPES
      );
      return { available: true, data: { score: Math.round(response.score * 10) / 10, measuredAt: response.time ?? null } };
    } catch (error) {
      const unavailable = asUnavailable(error, 'Score.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  async getVulnerability(ctx: ProviderContext, cveId: string): Promise<CapabilityResult<VulnerabilityDetail>> {
    this.validateContext(ctx);

    try {
      const v = await this.defenderClient.get<DefenderVulnerabilityDetail>(
        ctx.tenantId as string,
        `/api/vulnerabilities/${encodeURIComponent(cveId)}`,
        DEFENDER_SCOPES
      );
      return {
        available: true,
        data: {
          cveId: v.id,
          name: v.name,
          description: v.description || null,
          severity: oneOf(v.severity, SEVERITIES, 'Unknown'),
          cvssScore: v.cvssV3 ?? null,
          cvssVector: v.cvssVector ?? null,
          exposedMachines: v.exposedMachines ?? 0,
          publishedAt: v.publishedOn,
          updatedAt: v.updatedOn,
          firstDetectedAt: v.firstDetected ?? null,
          publicExploit: v.publicExploit === true,
          exploitVerified: v.exploitVerified === true,
          exploitInKit: v.exploitInKit === true,
          exploitTypes: v.exploitTypes ?? [],
          exploitUrls: v.exploitUris ?? [],
          epssFromDefender: v.epss ?? null,
        },
      };
    } catch (error) {
      const unavailable = asUnavailable(error, 'Vulnerability.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  async getVulnerabilityMachines(
    ctx: ProviderContext,
    cveId: string
  ): Promise<CapabilityResult<VulnerabilityMachineRef[]>> {
    this.validateContext(ctx);

    let machines: DefenderMachineReference[];
    try {
      const response = await this.defenderClient.get<GraphResponse<DefenderMachineReference[]>>(
        ctx.tenantId as string,
        `/api/vulnerabilities/${encodeURIComponent(cveId)}/machineReferences`,
        DEFENDER_SCOPES
      );
      machines = response.value;
    } catch (error) {
      const unavailable = asUnavailable(error, 'Vulnerability.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }

    // Produktzeilen sind Zusatzinformation; ihr Ausfall darf die Geraeteliste nicht kosten
    const rows = await this.loadMachineVulnerabilityRows(ctx, `cveId eq '${cveId}'`);
    const productsByMachine = new Map<string, VulnerabilityMachineRef['products']>();
    if (rows.available) {
      for (const row of rows.data) {
        const list = productsByMachine.get(row.machineId) ?? [];
        list.push({
          name: [row.productVendor, row.productName].filter(Boolean).join(' ') || 'unbekannt',
          version: row.productVersion,
          fixingKbId: row.fixingKbId,
        });
        productsByMachine.set(row.machineId, list);
      }
    }

    return {
      available: true,
      data: machines
        .map((m) => ({
          machineId: m.id,
          name: m.computerDnsName ?? m.id,
          osPlatform: m.osPlatform,
          rbacGroupName: m.rbacGroupName,
          detectedAt: m.detectionTime ?? null,
          products: productsByMachine.get(m.id) ?? [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * Schwachstellen im Tenant, nach CVE zusammengefasst (Anzahl Geraete,
   * betroffene Produkte, behebende KBs). Grosse Tenants werden auf wenige
   * Seiten begrenzt; das Ergebnis ist dann eine Stichprobe der schwersten.
   */
  async getTenantVulnerabilities(
    ctx: ProviderContext,
    options: { severity?: VulnerabilitySeverity; top?: number } = {}
  ): Promise<CapabilityResult<{ items: TenantVulnerability[]; truncated: boolean }>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const params = [`$top=${MACHINE_VULNERABILITY_PAGE_SIZE}`];
    if (options.severity) {
      params.push(`$filter=${encodeURIComponent(`severity eq '${options.severity}'`)}`);
    }

    const rows: DefenderMachineVulnerability[] = [];
    let next: string | null = `/api/vulnerabilities/machinesVulnerabilities?${params.join('&')}`;
    let pages = 0;
    let truncated = false;

    try {
      while (next && pages < MACHINE_VULNERABILITY_MAX_PAGES) {
        const page: GraphResponse<DefenderMachineVulnerability[]> = await this.defenderClient.get<GraphResponse<DefenderMachineVulnerability[]>>(
          tenantId,
          next,
          DEFENDER_SCOPES
        );
        rows.push(...page.value);
        next = page['@odata.nextLink'] ?? null;
        pages += 1;
      }
      truncated = next !== null;
    } catch (error) {
      const unavailable = asUnavailable(error, 'Vulnerability.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }

    const byCve = new Map<string, { severity: VulnerabilitySeverity; machines: Set<string>; products: Set<string>; kbs: Set<string> }>();
    for (const row of rows) {
      let entry = byCve.get(row.cveId);
      if (!entry) {
        entry = { severity: oneOf(row.severity, SEVERITIES, 'Unknown'), machines: new Set(), products: new Set(), kbs: new Set() };
        byCve.set(row.cveId, entry);
      }
      entry.machines.add(row.machineId);
      const product = [row.productVendor, row.productName].filter(Boolean).join(' ');
      if (product) entry.products.add(product);
      if (row.fixingKbId) entry.kbs.add(row.fixingKbId);
    }

    const items = Array.from(byCve.entries())
      .map(([cveId, e]) => ({
        cveId,
        severity: e.severity,
        deviceCount: e.machines.size,
        products: Array.from(e.products).sort(),
        fixingKbIds: Array.from(e.kbs).sort(),
      }))
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.deviceCount - a.deviceCount)
      .slice(0, options.top ?? 500);

    return { available: true, data: { items, truncated } };
  }

  // Nur Metadaten: welche Schluessel es gibt, nie deren Inhalt
  async getRecoveryMetadata(ctx: ProviderContext, azureAdDeviceId: string | null): Promise<DeviceRecoveryMetadata> {
    this.validateContext(ctx);

    if (!azureAdDeviceId) {
      const noEntraId = {
        available: false as const,
        reason: 'not-onboarded' as const,
        missingPermission: null,
        detail: 'Device has no Entra device id',
      };
      return { azureAdDeviceId: null, bitlocker: noEntraId, laps: noEntraId };
    }

    const [bitlocker, laps] = await Promise.all([
      this.loadBitLockerKeys(ctx, azureAdDeviceId),
      this.loadLapsMetadata(ctx, azureAdDeviceId),
    ]);

    return { azureAdDeviceId, bitlocker, laps };
  }

  async revealBitLockerKey(ctx: ProviderContext, keyId: string): Promise<RevealedBitLockerKey> {
    this.validateContext(ctx);

    const key = await this.graphClient.get<GraphBitLockerKey>(
      ctx.tenantId as string,
      `/informationProtection/bitlocker/recoveryKeys/${encodeURIComponent(keyId)}?$select=key,volumeType,createdDateTime`,
      this.bitlockerScopes
    );

    if (!key.key) {
      throw new Error('Graph returned no BitLocker key');
    }

    return {
      id: keyId,
      key: key.key,
      volumeType: oneOf(key.volumeType, BITLOCKER_VOLUME_TYPES, 'unknown'),
      revealedAt: new Date().toISOString(),
    };
  }

  async revealLocalCredentials(ctx: ProviderContext, azureAdDeviceId: string): Promise<RevealedLaps> {
    this.validateContext(ctx);

    const info = await this.graphClient.get<GraphDeviceLocalCredentialInfo>(
      ctx.tenantId as string,
      `/directory/deviceLocalCredentials/${encodeURIComponent(azureAdDeviceId)}?$select=credentials,deviceName`,
      this.lapsScopes
    );

    return {
      deviceName: info.deviceName ?? null,
      credentials: (info.credentials ?? [])
        .filter((c) => c.passwordBase64)
        .map((c) => ({
          accountName: c.accountName ?? 'Administrator',
          password: Buffer.from(c.passwordBase64 as string, 'base64').toString('utf8'),
          backupAt: c.backupDateTime ?? null,
        }))
        .sort((a, b) => (b.backupAt ?? '').localeCompare(a.backupAt ?? '')),
      revealedAt: new Date().toISOString(),
    };
  }

  private async loadBitLockerKeys(ctx: ProviderContext, azureAdDeviceId: string): Promise<CapabilityResult<BitLockerKeyMetadata[]>> {
    try {
      const response = await this.graphClient.get<GraphResponse<GraphBitLockerKey[]>>(
        ctx.tenantId as string,
        `/informationProtection/bitlocker/recoveryKeys?$filter=${encodeURIComponent(`deviceId eq '${azureAdDeviceId}'`)}`,
        this.bitlockerScopes
      );
      return {
        available: true,
        data: response.value
          .map((k) => ({
            id: k.id,
            createdAt: k.createdDateTime,
            volumeType: oneOf(k.volumeType, BITLOCKER_VOLUME_TYPES, 'unknown'),
          }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    } catch (error) {
      const unavailable = asUnavailable(error, 'BitLockerKey.ReadBasic.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  private async loadLapsMetadata(ctx: ProviderContext, azureAdDeviceId: string): Promise<CapabilityResult<LapsMetadata>> {
    try {
      const info = await this.graphClient.get<GraphDeviceLocalCredentialInfo>(
        ctx.tenantId as string,
        `/directory/deviceLocalCredentials/${encodeURIComponent(azureAdDeviceId)}`,
        this.lapsScopes
      );
      return {
        available: true,
        data: {
          deviceName: info.deviceName ?? null,
          lastBackupAt: info.lastBackupDateTime ?? null,
          refreshAt: info.refreshDateTime ?? null,
        },
      };
    } catch (error) {
      const unavailable = asUnavailable(error, 'DeviceLocalCredential.ReadBasic.All');
      if (unavailable) return unavailable;
      throw error;
    }
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

  /**
   * Netzwerkschnittstellen laut Defender-Sensor (nur im Einzelabruf enthalten).
   */
  async getDeviceNetwork(ctx: ProviderContext, machineId: string): Promise<CapabilityResult<DeviceNetworkInfo>> {
    this.validateContext(ctx);
    let machine: DefenderMachine;
    try {
      machine = await this.defenderClient.get<DefenderMachine>(ctx.tenantId as string, `/api/machines/${encodeURIComponent(machineId)}`, DEFENDER_SCOPES);
    } catch (error) {
      const unavailable = asUnavailable(error, 'Machine.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
    const interfaces = (machine.ipAddresses ?? [])
      .filter((i): i is { ipAddress: string; macAddress: string | null; type: string | null; operationalStatus: string | null } => !!i.ipAddress)
      .map((i) => ({ ipAddress: i.ipAddress, macAddress: formatMac(i.macAddress), type: i.type, status: i.operationalStatus }))
      .sort((a, b) => Number(b.status === 'Up') - Number(a.status === 'Up') || compareIp(a.ipAddress, b.ipAddress));
    return {
      available: true,
      data: { lastIpAddress: machine.lastIpAddress, lastExternalIpAddress: machine.lastExternalIpAddress ?? null, interfaces },
    };
  }

  /**
   * Softwareinventar laut Defender (Vulnerability Management), ohne Versionen.
   */
  async listDefenderSoftware(ctx: ProviderContext, machineId: string): Promise<CapabilityResult<DetectedApp[]>> {
    this.validateContext(ctx);
    try {
      const response = await this.defenderClient.get<GraphResponse<{ id: string; name: string | null; vendor: string | null }[]>>(
        ctx.tenantId as string,
        `/api/machines/${encodeURIComponent(machineId)}/software`,
        DEFENDER_SCOPES
      );
      return {
        available: true,
        data: response.value.map((s) => ({
          id: `mde:${s.id}`,
          displayName: s.name ?? s.id,
          version: null,
          publisher: s.vendor || null,
          platform: null,
          sizeBytes: null,
          source: 'defender' as const,
        })),
      };
    } catch (error) {
      const unavailable = asUnavailable(error, 'Software.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  /**
   * Vom Intune-Client erkannte Software eines Geraets (Inventar, nicht live).
   */
  async listDetectedApps(ctx: ProviderContext, managedDeviceId: string): Promise<CapabilityResult<DetectedApp[]>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const apps: GraphDetectedApp[] = [];
    let next: string | null = `/deviceManagement/managedDevices/${encodeURIComponent(managedDeviceId)}/detectedApps`;

    try {
      while (next) {
        const page: GraphResponse<GraphDetectedApp[]> = await this.graphClient.get<GraphResponse<GraphDetectedApp[]>>(tenantId, next, this.requiredScopes);
        apps.push(...page.value);
        next = page['@odata.nextLink'] ?? null;
      }
    } catch (error) {
      const unavailable = asUnavailable(error, 'DeviceManagementManagedDevices.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }

    return {
      available: true,
      data: apps
        .map((a) => ({
          id: a.id,
          displayName: a.displayName ?? 'Unbekannt',
          version: a.version || null,
          publisher: a.publisher || null,
          platform: a.platform ?? null,
          sizeBytes: typeof a.sizeInByte === 'number' ? a.sizeInByte : null,
          source: 'intune' as const,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')),
    };
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
      const unavailable = asUnavailable(error, 'Software.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }
}

// Die Defender-API nennt im 403 die tatsaechlich benoetigte Rolle
// ("API required roles: Software.Read.All, application roles: ...")
// Rollen haben immer Punkt-Notation (Software.Read.All); das schliesst Fuellwoerter wie "application" aus
const ROLE = '[A-Za-z0-9]+(?:\\.[A-Za-z0-9]+)+';
const REQUIRED_ROLES_PATTERN = new RegExp(`API required roles:\\s*(${ROLE}(?:\\s*,\\s*${ROLE})*)`);

export function requiredRolesFromError(message: string, fallback: string): string {
  const match = REQUIRED_ROLES_PATTERN.exec(message);
  return match ? match[1].split(/\s*,\s*/).join(', ') : fallback;
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
    return {
      available: false,
      reason: 'permission-missing',
      missingPermission: requiredRolesFromError(error.message, permission),
      detail: error.message,
    };
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
    totalStorageBytes: positiveOrNull(md.totalStorageSpaceInBytes),
    freeStorageBytes: positiveOrNull(md.freeStorageSpaceInBytes),
    physicalMemoryBytes: positiveOrNull(md.physicalMemoryInBytes),
    wifiMacAddress: md.wiFiMacAddress || null,
  };
}

// Intune meldet 0, wenn der Client den Wert nicht kennt
function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

/**
 * Topologie aus dem Bestand: externe Adresse als Standort, /24 als Subnetz.
 * Reine Ableitung, keine Abfrage.
 */
export function buildNetworkTopology(devices: Device[]): Omit<NetworkTopology, 'snapshot' | 'generatedAt'> {
  const sites = new Map<string | null, Map<string, NetworkTopologyDevice[]>>();
  const withoutAddress: NetworkTopologyDevice[] = [];

  for (const device of devices) {
    const ip = device.defender?.lastIpAddress ?? null;
    const entry: NetworkTopologyDevice = {
      id: device.id,
      name: device.name,
      ipAddress: ip ?? '',
      operatingSystem: device.operatingSystem,
      lastActivityAt: device.lastActivityAt,
    };
    if (!ip) {
      withoutAddress.push(entry);
      continue;
    }
    const siteKey = device.defender?.lastExternalIpAddress || null;
    const subnetKey = subnetOf(ip);
    let subnets = sites.get(siteKey);
    if (!subnets) {
      subnets = new Map();
      sites.set(siteKey, subnets);
    }
    const list = subnets.get(subnetKey) ?? [];
    list.push(entry);
    subnets.set(subnetKey, list);
  }

  const result: NetworkSite[] = Array.from(sites.entries()).map(([externalIp, subnets]) => {
    const subnetList: NetworkSubnet[] = Array.from(subnets.entries())
      .map(([cidr, list]) => ({ cidr, devices: list.sort((a, b) => compareIp(a.ipAddress, b.ipAddress)) }))
      .sort((a, b) => b.devices.length - a.devices.length || a.cidr.localeCompare(b.cidr));
    return { externalIp, deviceCount: subnetList.reduce((n, s) => n + s.devices.length, 0), subnets: subnetList };
  });
  // Bekannte Standorte zuerst, groesste zuerst; "unbekannt" ans Ende
  result.sort((a, b) => Number(a.externalIp === null) - Number(b.externalIp === null) || b.deviceCount - a.deviceCount);

  return { sites: result, withoutAddress: withoutAddress.sort((a, b) => a.name.localeCompare(b.name)) };
}

// Defender liefert MACs ohne Trenner (001122AABBCC)
function formatMac(mac: string | null): string | null {
  if (!mac) return null;
  const clean = mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (clean.length !== 12) return mac;
  return clean.match(/.{2}/g)?.join(':') ?? mac;
}

/**
 * Intune- und Defender-Inventar zusammenfuehren: gleicher Name (normalisiert) ist dieselbe Software,
 * Intune liefert die Version, Defender kennt zusaetzlich Software ohne Installer-Eintrag.
 */
export function mergeSoftware(intune: DetectedApp[], defender: DetectedApp[]): DetectedApp[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const seen = new Map<string, DetectedApp>();
  for (const app of intune) seen.set(norm(app.displayName), app);
  for (const app of defender) {
    const key = norm(app.displayName);
    const vendorKey = norm(`${app.publisher ?? ''}${app.displayName}`);
    if (seen.has(key) || seen.has(vendorKey)) continue;
    if (Array.from(seen.keys()).some((k) => k.includes(key) && key.length >= 5)) continue;
    seen.set(key, app);
  }
  return Array.from(seen.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));
}

export function subnetOf(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(':')) {
    // IPv6: die ersten vier Gruppen als /64
    const groups = ip.split(':').slice(0, 4);
    return `${groups.join(':')}::/64`;
  }
  return 'unbekannt';
}

function compareIp(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  if (pa.length === 4 && pb.length === 4 && pa.every(Number.isFinite) && pb.every(Number.isFinite)) {
    for (let i = 0; i < 4; i += 1) {
      if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
  }
  return a.localeCompare(b);
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
    lastExternalIpAddress: machine.lastExternalIpAddress ?? null,
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

function deriveMissingKbs(rows: DefenderMachineVulnerability[]): MissingKb[] {
  const byKb = new Map<string, { products: Set<string>; cves: Set<string> }>();
  for (const row of rows) {
    if (!row.fixingKbId) continue;
    let entry = byKb.get(row.fixingKbId);
    if (!entry) {
      entry = { products: new Set(), cves: new Set() };
      byKb.set(row.fixingKbId, entry);
    }
    const product = [row.productVendor, row.productName].filter(Boolean).join(' ');
    if (product) entry.products.add(product);
    entry.cves.add(row.cveId);
  }

  return Array.from(byKb.entries())
    .map(([id, e]) => ({
      id,
      name: `Sicherheitsupdate KB${id}`,
      osBuild: null,
      products: Array.from(e.products).sort(),
      url: `https://support.microsoft.com/help/${id}`,
      cveAddressed: e.cves.size,
      missingSince: null,
    }))
    .sort((a, b) => b.cveAddressed - a.cveAddressed);
}

function groupSoftware(rows: DefenderMachineVulnerability[]): VulnerableSoftware[] {
  const byProduct = new Map<string, VulnerableSoftware & { cves: Set<string>; kbs: Set<string> }>();
  for (const row of rows) {
    if (!row.productName) continue;
    const key = `${row.productVendor ?? ''}|${row.productName}|${row.productVersion ?? ''}`;
    let entry = byProduct.get(key);
    if (!entry) {
      entry = {
        vendor: row.productVendor,
        name: row.productName,
        version: row.productVersion,
        cveCount: 0,
        highestSeverity: 'Unknown',
        fixingKbIds: [],
        cves: new Set(),
        kbs: new Set(),
      };
      byProduct.set(key, entry);
    }
    entry.cves.add(row.cveId);
    if (row.fixingKbId) entry.kbs.add(row.fixingKbId);
    const severity = oneOf(row.severity, SEVERITIES, 'Unknown');
    if (severityRank[severity] < severityRank[entry.highestSeverity]) entry.highestSeverity = severity;
  }

  return Array.from(byProduct.values())
    .map(({ cves, kbs, ...software }) => ({ ...software, cveCount: cves.size, fixingKbIds: Array.from(kbs).sort() }))
    .sort((a, b) => severityRank[a.highestSeverity] - severityRank[b.highestSeverity] || b.cveCount - a.cveCount);
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
