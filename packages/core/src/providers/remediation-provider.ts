/**
 * Remediation-Provider (Intune Remediations, Graph beta deviceHealthScripts)
 *
 * Bringt die Skriptbibliothek in den Kundentenant und fuehrt ein Skript auf
 * Abruf auf einem einzelnen Geraet aus. Objekte im Tenant tragen das Praefix
 * ZSC- und einen Hash in der Beschreibung; nur diese Objekte werden
 * angefasst. Freitext-Skripte gibt es hier bewusst nicht.
 */

import type { CapabilityResult, RemediationRunState, ScriptLibraryStatus, TenantScriptStatus } from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';
import { GraphApiError } from '../errors.js';
import {
  SCRIPT_PREFIX,
  SCRIPT_PUBLISHER,
  loadScriptLibrary,
  parseTenantDescription,
  tenantDescription,
  tenantDisplayName,
  toLibraryEntry,
  type LoadedScript,
} from '../scripts/library.js';

// Remediations gibt es nur in Graph beta; der Client nimmt absolute URLs unveraendert
export const GRAPH_BETA = 'https://graph.microsoft.com/beta';

interface GraphDeviceHealthScript {
  id: string;
  displayName: string;
  description: string | null;
  publisher: string | null;
  version: string | null;
  lastModifiedDateTime: string | null;
  runAsAccount: string | null;
}

interface GraphDeviceHealthScriptPolicyState {
  id: string;
  policyId: string;
  deviceId: string;
  policyName: string | null;
  lastStateUpdateDateTime: string | null;
  lastSyncDateTime: string | null;
  preRemediationDetectionScriptOutput: string | null;
  preRemediationDetectionScriptError: string | null;
  remediationScriptError: string | null;
  postRemediationDetectionScriptOutput: string | null;
  postRemediationDetectionScriptError: string | null;
  detectionState: string | null;
  remediationState: string | null;
}

export interface TenantScript {
  id: string;
  displayName: string;
  hash: string | null;
  version: string | null;
  modifiedAt: string | null;
}

export interface EnsureScriptResult {
  tenantScriptId: string;
  action: 'created' | 'updated' | 'unchanged';
}

export interface RemediationRunState_ {
  detectionState: RemediationRunState;
  remediationState: RemediationRunState;
  preOutput: string | null;
  postOutput: string | null;
  detectionError: string | null;
  remediationError: string | null;
  updatedAt: string | null;
  syncedAt: string | null;
  // Woher der Zustand kam (Diagnose)
  source: 'device' | 'script';
}

export interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  // Zustand vor dem Start; alles, was davon abweicht, gilt als neues Ergebnis
  baseline?: RemediationRunState_ | null;
}

// Intune liefert fuer "nie" das Jahr 0001; solche Zeitstempel sind keine
function validTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time < Date.UTC(2000, 0, 1)) return null;
  return time;
}

export function latestReportTime(state: RemediationRunState_): number | null {
  const times = [validTime(state.updatedAt), validTime(state.syncedAt)].filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

/**
 * Ist dieser Zustand das Ergebnis des Laufs, der um `since` gestartet wurde?
 * Zeitstempel zaehlen mit zwei Minuten Toleranz; fehlen sie, zaehlt jede
 * Abweichung vom Zustand vor dem Start.
 */
export function isFreshRunState(state: RemediationRunState_, since: Date, baseline: RemediationRunState_ | null | undefined): boolean {
  const reported = latestReportTime(state);
  if (reported !== null && reported >= since.getTime() - 2 * 60 * 1000) return true;
  if (baseline === undefined) return false;
  if (baseline === null) return true;
  return (
    state.preOutput !== baseline.preOutput ||
    state.postOutput !== baseline.postOutput ||
    state.detectionState !== baseline.detectionState ||
    state.remediationState !== baseline.remediationState ||
    state.remediationError !== baseline.remediationError ||
    state.updatedAt !== baseline.updatedAt ||
    state.syncedAt !== baseline.syncedAt
  );
}

const RUN_STATES: RemediationRunState[] = ['unknown', 'success', 'fail', 'scriptError', 'pending', 'notApplicable', 'skipped', 'remediationFailed'];

function toRunState(value: string | null | undefined): RemediationRunState {
  return RUN_STATES.find((s) => s === value) ?? 'unknown';
}

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

function asUnavailable(error: unknown, permission: string): Unavailable | null {
  if (!(error instanceof GraphApiError)) return null;
  if (error.isAuthError) {
    return { available: false, reason: 'permission-missing', missingPermission: permission, detail: error.message };
  }
  return null;
}

/**
 * Was der Job braucht; die Klasse erfuellt es, Tests koennen es nachbilden.
 */
export interface RemediationOperations {
  ensureScript(ctx: ProviderContext, script: LoadedScript): Promise<EnsureScriptResult>;
  runOnDemand(ctx: ProviderContext, managedDeviceId: string, tenantScriptId: string): Promise<void>;
  getRunState(ctx: ProviderContext, managedDeviceId: string, tenantScriptId: string): Promise<RemediationRunState_ | null>;
  waitForRunState(
    ctx: ProviderContext,
    managedDeviceId: string,
    tenantScriptId: string,
    since: Date,
    options?: WaitOptions
  ): Promise<RemediationRunState_ | null>;
}

export class RemediationProvider extends BaseResourceProvider implements RemediationOperations {
  readonly name = 'remediations';
  // Skripte anlegen und aktualisieren
  readonly requiredScopes = ['DeviceManagementConfiguration.ReadWrite.All'];
  // Skript auf einem Geraet starten
  readonly runScopes = ['DeviceManagementManagedDevices.PrivilegedOperations.All'];
  // Ergebnis je Geraet lesen
  readonly stateScopes = ['DeviceManagementManagedDevices.Read.All'];

  constructor(private readonly graphClient: GraphClient) {
    super();
  }

  /**
   * Alle von der Konsole verwalteten Remediation-Objekte im Tenant.
   */
  async listTenantScripts(ctx: ProviderContext): Promise<CapabilityResult<TenantScript[]>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const scripts: GraphDeviceHealthScript[] = [];
    let next: string | null = `${GRAPH_BETA}/deviceManagement/deviceHealthScripts?$select=id,displayName,description,publisher,version,lastModifiedDateTime,runAsAccount`;

    try {
      while (next) {
        const page: GraphResponse<GraphDeviceHealthScript[]> = await this.graphClient.get<GraphResponse<GraphDeviceHealthScript[]>>(
          tenantId,
          next,
          this.requiredScopes
        );
        scripts.push(...page.value);
        next = page['@odata.nextLink'] ?? null;
      }
    } catch (error) {
      const unavailable = asUnavailable(error, 'DeviceManagementConfiguration.ReadWrite.All');
      if (unavailable) return unavailable;
      throw error;
    }

    return {
      available: true,
      data: scripts
        .filter((s) => s.displayName.startsWith(SCRIPT_PREFIX))
        .map((s) => {
          const marker = parseTenantDescription(s.description);
          return { id: s.id, displayName: s.displayName, hash: marker?.hash ?? null, version: marker?.version ?? null, modifiedAt: s.lastModifiedDateTime };
        }),
    };
  }

  /**
   * Bibliothek gegen den Tenant: welche Skripte fehlen, welche sind veraltet.
   */
  async getLibraryStatus(ctx: ProviderContext): Promise<ScriptLibraryStatus> {
    const tenantScripts = await this.listTenantScripts(ctx);
    if (!tenantScripts.available) return tenantScripts;

    const items: TenantScriptStatus[] = loadScriptLibrary().map((script) => {
      const existing = tenantScripts.data.find((t) => t.displayName === tenantDisplayName(script));
      return {
        ...toLibraryEntry(script),
        tenantState: !existing ? 'missing' : existing.hash === script.hash ? 'in-sync' : 'outdated',
        tenantScriptId: existing?.id ?? null,
        tenantHash: existing?.hash ?? null,
        tenantModifiedAt: existing?.modifiedAt ?? null,
      };
    });
    return { available: true, data: items };
  }

  /**
   * Remediation-Objekt anlegen oder auf den Stand der Bibliothek bringen.
   */
  async ensureScript(ctx: ProviderContext, script: LoadedScript): Promise<EnsureScriptResult> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const tenantScripts = await this.listTenantScripts(ctx);
    if (!tenantScripts.available) {
      throw new Error(`Cannot manage remediation scripts: ${tenantScripts.detail ?? tenantScripts.reason}`);
    }

    const existing = tenantScripts.data.find((t) => t.displayName === tenantDisplayName(script));
    const body = {
      displayName: tenantDisplayName(script),
      description: tenantDescription(script),
      publisher: SCRIPT_PUBLISHER,
      runAs32Bit: false,
      runAsAccount: script.runAsAccount,
      enforceSignatureCheck: false,
      detectionScriptContent: toBase64(script.detectionScript),
      remediationScriptContent: script.remediationScript ? toBase64(script.remediationScript) : null,
    };

    if (existing && existing.hash === script.hash) {
      return { tenantScriptId: existing.id, action: 'unchanged' };
    }

    if (existing) {
      await this.graphClient.patch(
        tenantId,
        `${GRAPH_BETA}/deviceManagement/deviceHealthScripts/${encodeURIComponent(existing.id)}`,
        this.requiredScopes,
        body
      );
      return { tenantScriptId: existing.id, action: 'updated' };
    }

    const created = await this.graphClient.post<{ id: string }>(
      tenantId,
      `${GRAPH_BETA}/deviceManagement/deviceHealthScripts`,
      this.requiredScopes,
      { '@odata.type': '#microsoft.graph.deviceHealthScript', ...body, roleScopeTagIds: ['0'] }
    );
    return { tenantScriptId: created.id, action: 'created' };
  }

  /**
   * Skript jetzt auf einem Geraet ausfuehren (Intune "Remediation auf Abruf").
   */
  async runOnDemand(ctx: ProviderContext, managedDeviceId: string, tenantScriptId: string): Promise<void> {
    this.validateContext(ctx);
    await this.graphClient.post(
      ctx.tenantId as string,
      `${GRAPH_BETA}/deviceManagement/managedDevices/${encodeURIComponent(managedDeviceId)}/initiateOnDemandProactiveRemediation`,
      this.runScopes,
      { scriptPolicyId: tenantScriptId }
    );
  }

  /**
   * Letzter gemeldeter Zustand dieses Skripts auf diesem Geraet.
   * Erste Quelle: die Zustaende des Geraets; zweite Quelle: die
   * Geraetezustaende des Skripts. Gibt es mehrere Eintraege, gewinnt der
   * zuletzt gemeldete.
   */
  async getRunState(ctx: ProviderContext, managedDeviceId: string, tenantScriptId: string): Promise<RemediationRunState_ | null> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const wanted = tenantScriptId.toLowerCase();

    const fromDevice = await this.graphClient.get<GraphResponse<GraphDeviceHealthScriptPolicyState[]>>(
      tenantId,
      `${GRAPH_BETA}/deviceManagement/managedDevices/${encodeURIComponent(managedDeviceId)}/deviceHealthScriptStates`,
      this.stateScopes
    );
    const deviceStates = fromDevice.value.filter((s) => (s.policyId ?? '').toLowerCase() === wanted).map((s) => toRunStateRecord(s, 'device'));
    if (deviceStates.length > 0) {
      return pickLatest(deviceStates);
    }

    const fromScript = await this.graphClient.get<GraphResponse<GraphDeviceHealthScriptDeviceState[]>>(
      tenantId,
      `${GRAPH_BETA}/deviceManagement/deviceHealthScripts/${encodeURIComponent(tenantScriptId)}/deviceRunStates?$expand=managedDevice($select=id)`,
      this.requiredScopes
    );
    const wantedDevice = managedDeviceId.toLowerCase();
    const scriptStates = fromScript.value
      .filter((s) => (s.managedDevice?.id ?? '').toLowerCase() === wantedDevice)
      .map((s) => toRunStateRecord(s, 'script'));
    return scriptStates.length > 0 ? pickLatest(scriptStates) : null;
  }

  /**
   * Wartet, bis das Geraet ein Ergebnis dieses Laufs meldet.
   * Null bei Zeitueberschreitung; der Aufrufer entscheidet, was das heisst.
   */
  async waitForRunState(
    ctx: ProviderContext,
    managedDeviceId: string,
    tenantScriptId: string,
    since: Date,
    options: WaitOptions = {}
  ): Promise<RemediationRunState_ | null> {
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    const pollMs = options.pollMs ?? 15 * 1000;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = options.now ?? (() => Date.now());
    const deadline = now() + timeoutMs;

    while (true) {
      const state = await this.getRunState(ctx, managedDeviceId, tenantScriptId);
      if (state && isFreshRunState(state, since, options.baseline)) {
        return state;
      }
      if (now() >= deadline) {
        return null;
      }
      await sleep(pollMs);
    }
  }
}

interface GraphDeviceHealthScriptDeviceState {
  id: string;
  detectionState: string | null;
  remediationState: string | null;
  lastStateUpdateDateTime: string | null;
  lastSyncDateTime: string | null;
  preRemediationDetectionScriptOutput: string | null;
  preRemediationDetectionScriptError: string | null;
  remediationScriptError: string | null;
  postRemediationDetectionScriptOutput: string | null;
  postRemediationDetectionScriptError: string | null;
  managedDevice?: { id: string } | null;
}

function toRunStateRecord(
  state: GraphDeviceHealthScriptPolicyState | GraphDeviceHealthScriptDeviceState,
  source: 'device' | 'script'
): RemediationRunState_ {
  return {
    detectionState: toRunState(state.detectionState),
    remediationState: toRunState(state.remediationState),
    preOutput: state.preRemediationDetectionScriptOutput || null,
    postOutput: state.postRemediationDetectionScriptOutput || null,
    detectionError: state.postRemediationDetectionScriptError || state.preRemediationDetectionScriptError || null,
    remediationError: state.remediationScriptError || null,
    updatedAt: state.lastStateUpdateDateTime,
    syncedAt: state.lastSyncDateTime,
    source,
  };
}

function pickLatest(states: RemediationRunState_[]): RemediationRunState_ {
  return states.reduce((best, s) => ((latestReportTime(s) ?? -1) > (latestReportTime(best) ?? -1) ? s : best));
}
