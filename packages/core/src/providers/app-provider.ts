/**
 * App-Provider (Intune-Anwendungen)
 *
 * Bestand mit Zuweisungen ueber Graph beta mobileApps, Installationszahlen
 * ueber die Intune-Berichte (getAppsInstallSummaryReport,
 * getDeviceInstallStatusReport). Zuweisungen werden nach dem Muster
 * "lesen, zusammenfuehren, ersetzen" geschrieben, weil /assign die
 * komplette Liste ersetzt.
 */

import type {
  AppAssignment,
  AppAssignmentInput,
  AppAssignmentIntent,
  AppAssignmentTargetType,
  AppDeviceStatus,
  AppInstallState,
  AppInstallSummary,
  AppInventorySet,
  AppStats,
  CapabilityResult,
  IntuneApp,
  IntuneAppType,
} from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';
import { GraphApiError } from '../errors.js';
import { GRAPH_BETA } from './remediation-provider.js';
import type { OpenedIntuneWin } from '../apps/intunewin.js';

interface GraphMobileApp {
  id: string;
  '@odata.type': string;
  displayName: string | null;
  publisher: string | null;
  createdDateTime: string | null;
  lastModifiedDateTime: string | null;
  isAssigned: boolean | null;
  displayVersion?: string | null;
  productVersion?: string | null;
  assignments?: GraphAssignment[];
}

interface GraphAssignment {
  id: string;
  intent: string;
  target: {
    '@odata.type': string;
    groupId?: string;
    deviceAndAppManagementAssignmentFilterId?: string | null;
    deviceAndAppManagementAssignmentFilterType?: string | null;
  };
  settings?: unknown;
}

// Intune-Berichte: Spalten und Werte getrennt
interface IntuneReport {
  TotalRowCount?: number;
  Schema?: { Column: string; PropertyType: string }[];
  Values?: unknown[][];
}

const APP_TYPES: IntuneAppType[] = ['win32LobApp', 'winGetApp', 'windowsMobileMSI', 'officeSuiteApp', 'windowsMicrosoftEdgeApp', 'microsoftStoreForBusinessApp', 'webApp', 'windowsUniversalAppX'];
const INTENTS: AppAssignmentIntent[] = ['required', 'available', 'uninstall', 'availableWithoutEnrollment'];
const REPORT_PAGE = 500;

// Bekannte Intune-Fehlercodes in Klartext
export const APP_ERROR_HINTS: Record<string, string> = {
  '0x80070002': 'Datei nicht gefunden: Installationsdatei oder Pfad im Paket stimmt nicht',
  '0x80070005': 'Zugriff verweigert: Installer braucht andere Rechte oder wird von einer Richtlinie blockiert',
  '0x8007000D': 'Ungueltige Daten: Paket beschaedigt oder Installer inkompatibel',
  '0x80070032': 'Nicht unterstuetzt: Installationsart passt nicht zum Geraet oder Betriebssystem',
  '0x80070490': 'Element nicht gefunden: Erkennungsregel oder Installationspfad falsch',
  '0x80070643': 'Schwerwiegender Installationsfehler (MSI 1603): Installationsprotokoll auf dem Geraet pruefen',
  '0x87D1041C': 'Installation erfolgreich, aber Erkennungsregel schlaegt fehl: Regel an das tatsaechliche Ergebnis anpassen',
  '0x87D1FDE8': 'Behebung fehlgeschlagen: Erkennung nach der Installation weiterhin negativ',
  '0x87D13B67': 'App wurde vom Benutzer abgebrochen oder Installation zeitlich ueberschritten',
  '0x87D300CF': 'Benutzer- oder Geraeteziel passt nicht: pruefen, ob die App fuer Geraete- oder Benutzerkontext gebaut ist',
};

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

function asUnavailable(error: unknown, permission: string): Unavailable | null {
  if (!(error instanceof GraphApiError)) return null;
  if (error.isAuthError) {
    return { available: false, reason: 'permission-missing', missingPermission: permission, detail: error.message };
  }
  return null;
}

export function appTypeOf(odataType: string): IntuneAppType {
  const short = odataType.replace('#microsoft.graph.', '');
  return APP_TYPES.find((t) => t === short) ?? 'other';
}

function intentOf(value: string): AppAssignmentIntent {
  return INTENTS.find((i) => i === value) ?? 'available';
}

function targetTypeOf(odataType: string): AppAssignmentTargetType {
  if (odataType.endsWith('exclusionGroupAssignmentTarget')) return 'exclusionGroup';
  if (odataType.endsWith('allLicensedUsersAssignmentTarget')) return 'allUsers';
  if (odataType.endsWith('allDevicesAssignmentTarget')) return 'allDevices';
  return 'group';
}

export function mapAssignment(a: GraphAssignment): AppAssignment {
  const filterType = a.target.deviceAndAppManagementAssignmentFilterType;
  return {
    id: a.id,
    intent: intentOf(a.intent),
    targetType: targetTypeOf(a.target['@odata.type'] ?? ''),
    groupId: a.target.groupId ?? null,
    groupName: null,
    filterId: a.target.deviceAndAppManagementAssignmentFilterId || null,
    filterType: filterType === 'include' || filterType === 'exclude' ? filterType : null,
  };
}

/**
 * Graph-Nutzlast fuer /assign aus unserer Eingabe.
 */
export function toGraphAssignment(input: AppAssignmentInput): { '@odata.type': string; intent: string; target: Record<string, unknown> } {
  const targetTypes: Record<AppAssignmentTargetType, string> = {
    group: '#microsoft.graph.groupAssignmentTarget',
    exclusionGroup: '#microsoft.graph.exclusionGroupAssignmentTarget',
    allUsers: '#microsoft.graph.allLicensedUsersAssignmentTarget',
    allDevices: '#microsoft.graph.allDevicesAssignmentTarget',
  };
  const target: Record<string, unknown> = {
    '@odata.type': targetTypes[input.targetType],
    deviceAndAppManagementAssignmentFilterId: input.filterId ?? null,
    deviceAndAppManagementAssignmentFilterType: input.filterType ?? 'none',
  };
  if (input.targetType === 'group' || input.targetType === 'exclusionGroup') {
    target.groupId = input.groupId;
  }
  return { '@odata.type': '#microsoft.graph.mobileAppAssignment', intent: input.intent, target };
}

function sameTarget(a: AppAssignment, b: AppAssignmentInput): boolean {
  return a.targetType === b.targetType && (a.groupId ?? null) === (b.groupId ?? null);
}

/**
 * Zusammenfuehren: gleiche Zielgruppe ersetzt die alte Zuweisung, sonst wird angehaengt.
 */
export function mergeAssignments(existing: AppAssignment[], add: AppAssignmentInput[], removeIds: string[] = []): AppAssignmentInput[] {
  const kept: AppAssignmentInput[] = existing
    .filter((e) => !removeIds.includes(e.id))
    .filter((e) => !add.some((n) => sameTarget(e, n)))
    .map((e) => ({ intent: e.intent, targetType: e.targetType, groupId: e.groupId, filterId: e.filterId, filterType: e.filterType }));
  return [...kept, ...add];
}

/**
 * Bericht in Objekte je Zeile ueber die Spaltennamen.
 */
export function reportRows(report: IntuneReport): Record<string, unknown>[] {
  const columns = (report.Schema ?? []).map((s) => s.Column);
  return (report.Values ?? []).map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function installStateOf(value: unknown): AppInstallState {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('uninstallfail')) return 'uninstallFailed';
  if (text === 'installed' || text === '1' || text.includes('installed') && !text.includes('not')) return 'installed';
  if (text.includes('fail')) return 'failed';
  if (text.includes('pending') || text.includes('progress')) return 'pending';
  if (text.includes('notapplicable') || text.includes('not applicable')) return 'notApplicable';
  if (text.includes('notinstalled') || text.includes('not installed')) return 'notInstalled';
  return 'unknown';
}

export class AppProvider extends BaseResourceProvider {
  readonly name = 'apps';
  readonly requiredScopes = ['DeviceManagementApps.Read.All'];
  readonly writeScopes = ['DeviceManagementApps.ReadWrite.All'];
  readonly groupWriteScopes = ['Group.ReadWrite.All'];

  constructor(private readonly graphClient: GraphClient) {
    super();
  }

  async listApps(ctx: ProviderContext): Promise<CapabilityResult<AppInventorySet>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const apps: GraphMobileApp[] = [];
    const filter = APP_TYPES.map((t) => `isof('microsoft.graph.${t}')`).join(' or ');
    let next: string | null = `${GRAPH_BETA}/deviceAppManagement/mobileApps?$filter=${encodeURIComponent(filter)}&$expand=assignments&$orderby=displayName&$top=100`;

    try {
      while (next) {
        const page: GraphResponse<GraphMobileApp[]> = await this.graphClient.get<GraphResponse<GraphMobileApp[]>>(tenantId, next, this.requiredScopes);
        apps.push(...page.value);
        next = page['@odata.nextLink'] ?? null;
      }
    } catch (error) {
      const unavailable = asUnavailable(error, 'DeviceManagementApps.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }

    const summaries = await this.loadInstallSummaries(tenantId);
    const items: IntuneApp[] = apps
      .map((a) => ({
        id: a.id,
        displayName: a.displayName ?? a.id,
        publisher: a.publisher || null,
        type: appTypeOf(a['@odata.type'] ?? ''),
        version: a.displayVersion || a.productVersion || null,
        createdAt: a.createdDateTime,
        modifiedAt: a.lastModifiedDateTime,
        isAssigned: a.isAssigned === true || (a.assignments?.length ?? 0) > 0,
        assignments: (a.assignments ?? []).map(mapAssignment),
        install: summaries?.get(a.id) ?? (summaries ? { installed: 0, failed: 0, pending: 0, notInstalled: 0, notApplicable: 0 } : null),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));

    const stats: AppStats = {
      total: items.length,
      assigned: items.filter((i) => i.isAssigned).length,
      withFailures: items.filter((i) => (i.install?.failed ?? 0) > 0).length,
      win32: items.filter((i) => i.type === 'win32LobApp').length,
      winget: items.filter((i) => i.type === 'winGetApp').length,
    };
    return { available: true, data: { items, stats, summaryAvailable: summaries !== null } };
  }

  /**
   * Installationszahlen je App aus dem Intune-Bericht; null, wenn der Bericht fehlt.
   */
  private async loadInstallSummaries(tenantId: string): Promise<Map<string, AppInstallSummary> | null> {
    const result = new Map<string, AppInstallSummary>();
    let skip = 0;
    try {
      while (true) {
        const report = await this.graphClient.post<IntuneReport>(tenantId, `${GRAPH_BETA}/deviceAppManagement/reports/getAppsInstallSummaryReport`, this.requiredScopes, {
          filter: '',
          select: ['ApplicationId', 'InstalledDeviceCount', 'FailedDeviceCount', 'PendingInstallDeviceCount', 'NotInstalledDeviceCount', 'NotApplicableDeviceCount', 'InstalledUserCount', 'FailedUserCount', 'PendingInstallUserCount'],
          skip,
          top: REPORT_PAGE,
        });
        const rows = reportRows(report);
        for (const row of rows) {
          const id = asText(row.ApplicationId);
          if (!id) continue;
          result.set(id, {
            installed: asNumber(row.InstalledDeviceCount) + asNumber(row.InstalledUserCount),
            failed: asNumber(row.FailedDeviceCount) + asNumber(row.FailedUserCount),
            pending: asNumber(row.PendingInstallDeviceCount) + asNumber(row.PendingInstallUserCount),
            notInstalled: asNumber(row.NotInstalledDeviceCount),
            notApplicable: asNumber(row.NotApplicableDeviceCount),
          });
        }
        if (rows.length < REPORT_PAGE) break;
        skip += REPORT_PAGE;
      }
      return result;
    } catch {
      return null;
    }
  }

  async getDeviceStatuses(ctx: ProviderContext, appId: string): Promise<CapabilityResult<AppDeviceStatus[]>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const statuses: AppDeviceStatus[] = [];
    let skip = 0;
    try {
      while (true) {
        const report = await this.graphClient.post<IntuneReport>(tenantId, `${GRAPH_BETA}/deviceAppManagement/reports/getDeviceInstallStatusReport`, this.requiredScopes, {
          filter: `(ApplicationId eq '${appId.replace(/'/g, "''")}')`,
          select: ['DeviceId', 'DeviceName', 'UserPrincipalName', 'AppInstallState', 'AppInstallStateDetails', 'HexErrorCode', 'ErrorCode', 'AppVersion', 'LastModifiedDateTime'],
          skip,
          top: REPORT_PAGE,
        });
        const rows = reportRows(report);
        for (const row of rows) {
          const hex = asText(row.HexErrorCode) ?? (typeof row.ErrorCode === 'number' && row.ErrorCode !== 0 ? `0x${(row.ErrorCode >>> 0).toString(16).toUpperCase().padStart(8, '0')}` : null);
          statuses.push({
            deviceId: asText(row.DeviceId),
            deviceName: asText(row.DeviceName) ?? 'Unbekannt',
            userPrincipalName: asText(row.UserPrincipalName),
            installState: installStateOf(row.AppInstallState),
            installStateDetail: asText(row.AppInstallStateDetails),
            errorCode: hex,
            errorHint: hex ? (APP_ERROR_HINTS[hex.toUpperCase().replace('0X', '0x')] ?? null) : null,
            appVersion: asText(row.AppVersion),
            lastModifiedAt: asText(row.LastModifiedDateTime),
          });
        }
        if (rows.length < REPORT_PAGE) break;
        skip += REPORT_PAGE;
      }
    } catch (error) {
      const unavailable = asUnavailable(error, 'DeviceManagementApps.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
    const order: Record<AppInstallState, number> = { failed: 0, uninstallFailed: 0, pending: 1, notInstalled: 2, installed: 3, notApplicable: 4, unknown: 5 };
    return { available: true, data: statuses.sort((a, b) => order[a.installState] - order[b.installState] || a.deviceName.localeCompare(b.deviceName, 'de')) };
  }

  async getAssignments(ctx: ProviderContext, appId: string): Promise<AppAssignment[]> {
    this.validateContext(ctx);
    const response = await this.graphClient.get<GraphResponse<GraphAssignment[]>>(
      ctx.tenantId as string,
      `${GRAPH_BETA}/deviceAppManagement/mobileApps/${encodeURIComponent(appId)}/assignments`,
      this.requiredScopes
    );
    return response.value.map(mapAssignment);
  }

  /**
   * Komplette Zuweisungsliste setzen (/assign ersetzt alles).
   */
  async replaceAssignments(ctx: ProviderContext, appId: string, assignments: AppAssignmentInput[]): Promise<void> {
    this.validateContext(ctx);
    await this.graphClient.post(
      ctx.tenantId as string,
      `${GRAPH_BETA}/deviceAppManagement/mobileApps/${encodeURIComponent(appId)}/assign`,
      this.writeScopes,
      { mobileAppAssignments: assignments.map(toGraphAssignment) }
    );
  }

  async publishWin32(ctx: ProviderContext, payload: Record<string, unknown>, opened: OpenedIntuneWin, onProgress?: (step: string) => void, options?: PublishOptions): Promise<{ appId: string; contentVersion: string }> {
    this.validateContext(ctx);
    return publishWin32App(this.graphClient, this.writeScopes, ctx, payload, opened, onProgress, options);
  }

  async publishWinGet(ctx: ProviderContext, payload: Record<string, unknown>): Promise<{ appId: string }> {
    this.validateContext(ctx);
    const app = await this.graphClient.post<{ id: string }>(ctx.tenantId as string, `${GRAPH_BETA}/deviceAppManagement/mobileApps`, this.writeScopes, payload);
    return { appId: app.id };
  }

  /**
   * Sicherheitsgruppe anlegen; liefert die Id einer bestehenden Gruppe gleichen Namens statt eines Duplikats.
   */
  async ensureSecurityGroup(ctx: ProviderContext, displayName: string, description: string): Promise<{ id: string; created: boolean }> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const existing = await this.graphClient.get<GraphResponse<{ id: string }[]>>(
      tenantId,
      `/groups?$filter=displayName eq '${displayName.replace(/'/g, "''")}'&$select=id`,
      this.groupWriteScopes
    );
    if (existing.value[0]) {
      return { id: existing.value[0].id, created: false };
    }
    const mailNickname = displayName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 64) || 'zsc';
    const created = await this.graphClient.post<{ id: string }>(tenantId, '/groups', this.groupWriteScopes, {
      displayName,
      description,
      mailEnabled: false,
      securityEnabled: true,
      groupTypes: [],
      mailNickname,
    });
    return { id: created.id, created: true };
  }
}

export interface PublishOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fetchImpl?: typeof fetch;
  uploadTimeoutMs?: number;
}

interface ContentFile {
  id: string;
  uploadState: string | null;
  azureStorageUri: string | null;
}

const BLOB_BLOCK_SIZE = 6 * 1024 * 1024;

/**
 * Win32-App anlegen und Inhalt hochladen (neun Schritte, siehe Apps-Plan).
 */
export async function publishWin32App(
  graphClient: GraphClient,
  scopes: string[],
  ctx: ProviderContext,
  payload: Record<string, unknown>,
  opened: OpenedIntuneWin,
  onProgress: (step: string) => void = () => undefined,
  options: PublishOptions = {}
): Promise<{ appId: string; contentVersion: string }> {
  const tenantId = ctx.tenantId as string;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.uploadTimeoutMs ?? 20 * 60 * 1000;

  // 1. App-Objekt
  const app = await graphClient.post<{ id: string }>(tenantId, `${GRAPH_BETA}/deviceAppManagement/mobileApps`, scopes, payload);
  onProgress(`App angelegt: ${app.id}`);
  const base = `${GRAPH_BETA}/deviceAppManagement/mobileApps/${encodeURIComponent(app.id)}/microsoft.graph.win32LobApp`;

  // 2. Content-Version
  const version = await graphClient.post<{ id: string }>(tenantId, `${base}/contentVersions`, scopes, {});
  onProgress(`Content-Version ${version.id}`);

  // 3. Datei anmelden
  const meta = opened.metadata;
  const file = await graphClient.post<ContentFile>(tenantId, `${base}/contentVersions/${version.id}/files`, scopes, {
    '@odata.type': '#microsoft.graph.mobileAppContentFile',
    name: meta.fileName,
    size: meta.unencryptedContentSize,
    sizeEncrypted: opened.payload.length,
    manifest: null,
    isDependency: false,
  });
  const fileUrl = `${base}/contentVersions/${version.id}/files/${file.id}`;

  // 4. Auf die Blob-Adresse warten
  const deadline = now() + timeoutMs;
  let uploadTarget: ContentFile = file;
  while (uploadTarget.uploadState !== 'azureStorageUriRequestSuccess') {
    if (uploadTarget.uploadState && /fail|error/i.test(uploadTarget.uploadState)) throw new Error(`Intune lehnte die Datei ab: ${uploadTarget.uploadState}`);
    if (now() > deadline) throw new Error('Zeitueberschreitung beim Warten auf die Upload-Adresse');
    await sleep(2000);
    uploadTarget = await graphClient.get<ContentFile>(tenantId, fileUrl, scopes);
  }
  if (!uploadTarget.azureStorageUri) throw new Error('Keine Upload-Adresse von Intune');
  onProgress('Upload-Adresse erhalten');

  // 5. Bloecke hochladen
  const blockIds: string[] = [];
  for (let offset = 0, index = 0; offset < opened.payload.length; offset += BLOB_BLOCK_SIZE, index += 1) {
    const chunk = opened.payload.subarray(offset, Math.min(offset + BLOB_BLOCK_SIZE, opened.payload.length));
    const blockId = Buffer.from(String(index).padStart(4, '0')).toString('base64');
    const response = await fetchImpl(`${uploadTarget.azureStorageUri}&comp=block&blockid=${encodeURIComponent(blockId)}`, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Length': String(chunk.length) },
      // Buffer ist kein BodyInit; Kopie des Blocks als Uint8Array ueber eigenem ArrayBuffer
      body: new Uint8Array(chunk),
    });
    if (!response.ok) throw new Error(`Blob-Block ${index} fehlgeschlagen: ${response.status}`);
    blockIds.push(blockId);
    onProgress(`Block ${index + 1} von ${Math.ceil(opened.payload.length / BLOB_BLOCK_SIZE)} hochgeladen`);
  }
  const blockList = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map((id) => `<Latest>${id}</Latest>`).join('')}</BlockList>`;
  const listResponse = await fetchImpl(`${uploadTarget.azureStorageUri}&comp=blocklist`, {
    method: 'PUT',
    headers: { 'x-ms-blob-content-type': 'application/octet-stream', 'Content-Type': 'application/xml' },
    body: blockList,
  });
  if (!listResponse.ok) throw new Error(`Blockliste fehlgeschlagen: ${listResponse.status}`);

  // 6. Commit mit Verschluesselungsinfo (ohne @odata.type, sonst lehnt Graph ab)
  await graphClient.post(tenantId, `${fileUrl}/commit`, scopes, {
    fileEncryptionInfo: {
      encryptionKey: meta.encryptionInfo.encryptionKey,
      macKey: meta.encryptionInfo.macKey,
      initializationVector: meta.encryptionInfo.initializationVector,
      mac: meta.encryptionInfo.mac,
      profileIdentifier: meta.encryptionInfo.profileIdentifier,
      fileDigest: meta.encryptionInfo.fileDigest,
      fileDigestAlgorithm: meta.encryptionInfo.fileDigestAlgorithm,
    },
  });
  onProgress('Commit angestossen');

  // 7. Auf commitFileSuccess warten
  let committed = await graphClient.get<ContentFile>(tenantId, fileUrl, scopes);
  while (committed.uploadState !== 'commitFileSuccess') {
    if (committed.uploadState && /fail|error/i.test(committed.uploadState)) throw new Error(`Commit fehlgeschlagen: ${committed.uploadState}`);
    if (now() > deadline) throw new Error('Zeitueberschreitung beim Commit');
    await sleep(3000);
    committed = await graphClient.get<ContentFile>(tenantId, fileUrl, scopes);
  }

  // 8. Version festschreiben
  await graphClient.patch(tenantId, `${GRAPH_BETA}/deviceAppManagement/mobileApps/${encodeURIComponent(app.id)}`, scopes, {
    '@odata.type': '#microsoft.graph.win32LobApp',
    committedContentVersion: version.id,
  });
  onProgress('Content-Version festgeschrieben');
  return { appId: app.id, contentVersion: version.id };
}

/**
 * Namen der drei Bereitstellungsgruppen je App (Praefix, App, Zweck).
 */
export function deploymentGroupNames(prefix: string, appName: string): { intent: AppAssignmentIntent; name: string; description: string }[] {
  const p = prefix.trim() ? `${prefix.trim()} ` : '';
  const base = appName.trim();
  return [
    { intent: 'required', name: `${p}${base} - Install (Required)`, description: `Mitglieder erhalten ${base} automatisch installiert (erforderlich). Verwaltet von ZeroStress Cockpit.` },
    { intent: 'available', name: `${p}${base} - Available`, description: `Mitglieder koennen ${base} im Unternehmensportal installieren. Verwaltet von ZeroStress Cockpit.` },
    { intent: 'uninstall', name: `${p}${base} - Uninstall`, description: `Bei Mitgliedern wird ${base} deinstalliert. Verwaltet von ZeroStress Cockpit.` },
  ];
}
