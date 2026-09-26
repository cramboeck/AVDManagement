/**
 * Hunting-Provider (Defender for Endpoint Advanced Hunting)
 *
 * Fragt DeviceNetworkEvents ab und fasst zusammen, mit welchen Zielen ein
 * Geraet oder alle Geraete eines Tenants sprechen: IP, Hostname, Ports,
 * Prozesse, Richtung, Haeufigkeit. Grundlage fuer Firewall-Regeln und fuer
 * die Frage "wohin telefoniert dieser Client". Braucht Defender for
 * Endpoint Plan 2 (Advanced Hunting) und die Berechtigung
 * AdvancedQuery.Read.All; Defender for Business hat kein Advanced Hunting.
 * Alle Abfragen sind Vorlagen mit eingesetzten, geprueften Werten; kein
 * freies KQL von aussen.
 */

import type { CapabilityResult, ConnectionReport, ConnectionSummary, RemoteScope } from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient } from './graph-client.js';
import { DEFENDER_SCOPES, requiredRolesFromError } from './device-provider.js';
import { GraphApiError } from '../errors.js';

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

interface HuntingResponse {
  Schema?: Array<{ Name: string; Type: string }>;
  Results?: Array<Record<string, unknown>>;
}

const MACHINE_ID = /^[A-Za-z0-9]{6,64}$/;
const ACTIONS = "('ConnectionSuccess','ConnectionRequest','ConnectionFailed','ConnectionFound','InboundConnectionAccepted')";
export const MAX_DEVICE_ROWS = 300;
export const MAX_TENANT_ROWS = 500;

function asUnavailable(error: unknown): Unavailable | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/AADSTS500011/.test(message)) return { available: false, reason: 'not-licensed', missingPermission: null, detail: message };
  if (!(error instanceof GraphApiError)) return null;
  if (/advanced hunting|not supported|not available|license|subscription|feature is disabled/i.test(message) && error.statusCode !== 401) {
    return { available: false, reason: 'not-licensed', missingPermission: null, detail: `${message} (Advanced Hunting braucht Defender for Endpoint Plan 2; Defender for Business hat es nicht)` };
  }
  if (error.isAuthError) return { available: false, reason: 'permission-missing', missingPermission: requiredRolesFromError(message, 'AdvancedQuery.Read.All'), detail: message };
  return null;
}

/** Einordnung einer Zieladresse: privat, oeffentlich, Loopback, Link-Local, Multicast. */
export function classifyRemote(ip: string): RemoteScope {
  const v = ip.trim().toLowerCase();
  if (!v) return 'unknown';
  if (v.includes(':')) {
    if (v === '::1' || v === '::') return 'loopback';
    if (v.startsWith('fe80')) return 'link-local';
    if (v.startsWith('fc') || v.startsWith('fd')) return 'private';
    if (v.startsWith('ff')) return 'multicast';
    if (v.startsWith('::ffff:')) return classifyRemote(v.slice(7));
    return 'public';
  }
  const parts = v.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return 'unknown';
  const [a, b] = parts;
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a === 255 || (a === 0)) return 'unknown';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return 'private';
  return 'public';
}

function list(value: unknown): string[] {
  let raw: unknown = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return value ? [value] : [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => (x === null || x === undefined ? '' : String(x))).filter((x) => x !== '');
}

function iso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Zeilen der Hunting-Antwort in die neutrale Zusammenfassung. */
export function toSummaries(rows: Array<Record<string, unknown>>): ConnectionSummary[] {
  return rows
    .map((r): ConnectionSummary | null => {
      const remoteIp = typeof r.RemoteIP === 'string' ? r.RemoteIP : '';
      if (!remoteIp) return null;
      const urls = list(r.Urls).filter((u) => u && u !== remoteIp);
      const directions = list(r.Directions);
      return {
        remoteIp,
        remoteUrl: urls[0] ?? null,
        scope: classifyRemote(remoteIp),
        ports: Array.from(new Set(list(r.Ports).map((p) => Number(p)).filter((p) => Number.isInteger(p) && p > 0))).sort((a, b) => a - b),
        processes: Array.from(new Set(list(r.Processes).map((p) => p.toLowerCase()))),
        direction: directions.includes('inbound') ? (directions.includes('outbound') ? 'mixed' : 'inbound') : 'outbound',
        count: typeof r.Count === 'number' ? r.Count : Number(r.Count ?? 0),
        deviceCount: r.Devices === undefined ? null : Number(r.Devices),
        firstSeen: iso(r.FirstSeen),
        lastSeen: iso(r.LastSeen),
      };
    })
    .filter((x): x is ConnectionSummary => x !== null);
}

function days(value: number): number {
  return [1, 3, 7, 14, 30].includes(value) ? value : 7;
}

export function deviceConnectionsQuery(machineId: string, dayCount: number): string {
  if (!MACHINE_ID.test(machineId)) throw new Error('Machine id invalid');
  return [
    'DeviceNetworkEvents',
    `| where DeviceId == '${machineId}' and Timestamp > ago(${days(dayCount)}d)`,
    `| where ActionType in ${ACTIONS} and isnotempty(RemoteIP)`,
    "| extend Direction = iff(ActionType == 'InboundConnectionAccepted', 'inbound', 'outbound')",
    '| summarize Count = count(), FirstSeen = min(Timestamp), LastSeen = max(Timestamp), Ports = make_set(RemotePort, 8), Processes = make_set(InitiatingProcessFileName, 5), Directions = make_set(Direction, 2), Urls = make_set(RemoteUrl, 3) by RemoteIP',
    '| sort by Count desc',
    `| take ${MAX_DEVICE_ROWS + 1}`,
  ].join('\n');
}

export function tenantConnectionsQuery(dayCount: number, scope: 'external' | 'internal'): string {
  const filter = scope === 'external' ? "| where not(ipv4_is_private(RemoteIP)) and not(RemoteIP startswith '127.') and not(RemoteIP startswith '169.254.') and not(RemoteIP startswith 'fe80') and RemoteIP != '::1'" : '| where ipv4_is_private(RemoteIP)';
  return [
    'DeviceNetworkEvents',
    `| where Timestamp > ago(${days(dayCount)}d)`,
    `| where ActionType in ${ACTIONS} and isnotempty(RemoteIP)`,
    filter,
    "| extend Direction = iff(ActionType == 'InboundConnectionAccepted', 'inbound', 'outbound')",
    '| summarize Count = count(), Devices = dcount(DeviceId), FirstSeen = min(Timestamp), LastSeen = max(Timestamp), Ports = make_set(RemotePort, 8), Processes = make_set(InitiatingProcessFileName, 5), Directions = make_set(Direction, 2), Urls = make_set(RemoteUrl, 3) by RemoteIP',
    '| sort by Devices desc, Count desc',
    `| take ${MAX_TENANT_ROWS + 1}`,
  ].join('\n');
}

export class HuntingProvider extends BaseResourceProvider {
  readonly name = 'hunting';
  readonly requiredScopes = DEFENDER_SCOPES;

  constructor(
    private readonly defenderClient: GraphClient,
    private readonly now: () => Date = () => new Date()
  ) {
    super();
  }

  private async run(ctx: ProviderContext, query: string): Promise<CapabilityResult<Array<Record<string, unknown>>>> {
    this.validateContext(ctx);
    try {
      const response = await this.defenderClient.post<HuntingResponse>(ctx.tenantId as string, '/api/advancedqueries/run', DEFENDER_SCOPES, { Query: query }, { timeoutMs: 120000 });
      return { available: true, data: response.Results ?? [] };
    } catch (error) {
      const unavailable = asUnavailable(error);
      if (unavailable) return unavailable;
      throw error;
    }
  }

  private report(rows: Array<Record<string, unknown>>, dayCount: number, scope: ConnectionReport['scope'], limit: number): ConnectionReport {
    const items = toSummaries(rows.slice(0, limit));
    return {
      days: days(dayCount),
      scope,
      generatedAt: this.now().toISOString(),
      totalConnections: items.reduce((s, i) => s + i.count, 0),
      items,
      truncated: rows.length > limit,
    };
  }

  /** Ziele eines Geraets (Defender machineId) in den letzten Tagen. */
  async getDeviceConnections(ctx: ProviderContext, machineId: string, dayCount = 7): Promise<CapabilityResult<ConnectionReport>> {
    const rows = await this.run(ctx, deviceConnectionsQuery(machineId, dayCount));
    if (!rows.available) return rows;
    return { available: true, data: this.report(rows.data, dayCount, 'all', MAX_DEVICE_ROWS) };
  }

  /** Ziele aller Geraete des Tenants, ausserhalb (extern) oder innerhalb (privat) des Netzes. */
  async getTenantConnections(ctx: ProviderContext, dayCount = 7, scope: 'external' | 'internal' = 'external'): Promise<CapabilityResult<ConnectionReport>> {
    const rows = await this.run(ctx, tenantConnectionsQuery(dayCount, scope));
    if (!rows.available) return rows;
    return { available: true, data: this.report(rows.data, dayCount, scope, MAX_TENANT_ROWS) };
  }
}
