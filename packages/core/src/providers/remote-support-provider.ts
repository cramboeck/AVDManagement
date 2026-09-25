/**
 * Remotehilfe: TeamViewer (Web API)
 *
 * Die Konsole steuert keine Sitzung selbst. Sie findet das Geraet in der
 * TeamViewer-Geraeteliste des MSP (Alias = Hostname) und liefert die URI,
 * mit der der TeamViewer-Client auf dem Technikerrechner die Verbindung
 * aufbaut. Start und Begruendung protokolliert die API.
 */

import type { CapabilityResult, RemoteSupportMatch } from '@zerostress/types';

export const TEAMVIEWER_API_BASE = 'https://webapi.teamviewer.com/api/v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface TeamViewerDevice {
  device_id: string;
  remotecontrol_id?: string;
  alias?: string;
  description?: string;
  online_state?: string;
  groupid?: string;
  assigned_to?: boolean;
}

export interface TeamViewerProviderOptions {
  token: string | null;
  fetch?: typeof fetch;
  now?: () => number;
}

function shortHostname(value: string): string {
  return value.trim().toLowerCase().split('.')[0];
}

/**
 * Aus remotecontrol_id (r123456789) oder device_id (d123456789) die Nummer fuer die URI.
 */
export function teamViewerControlUri(device: TeamViewerDevice): string | null {
  const raw = device.remotecontrol_id ?? device.device_id;
  const match = /^[rd]?(\d{6,})$/.exec(raw ?? '');
  return match ? `teamviewer10://control?device=${match[1]}` : null;
}

export class TeamViewerProvider {
  private cache: { at: number; devices: TeamViewerDevice[] } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: TeamViewerProviderOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  get configured(): boolean {
    return !!this.options.token;
  }

  private async listDevices(): Promise<CapabilityResult<TeamViewerDevice[]>> {
    if (!this.options.token) {
      return { available: false, reason: 'not-onboarded', missingPermission: null, detail: 'TEAMVIEWER_API_TOKEN not configured' };
    }
    if (this.cache && this.now() - this.cache.at < CACHE_TTL_MS) {
      return { available: true, data: this.cache.devices };
    }
    const response = await this.fetchImpl(`${TEAMVIEWER_API_BASE}/devices`, {
      headers: { Authorization: `Bearer ${this.options.token}`, Accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403) {
      return { available: false, reason: 'permission-missing', missingPermission: 'TeamViewer-Token: Berechtigung "Geraete lesen"', detail: `TeamViewer API ${response.status}` };
    }
    if (!response.ok) {
      throw new Error(`TeamViewer API ${response.status}`);
    }
    const body = (await response.json()) as { devices?: TeamViewerDevice[] };
    this.cache = { at: this.now(), devices: body.devices ?? [] };
    return { available: true, data: this.cache.devices };
  }

  /**
   * Geraet ueber den Alias finden: exakter Hostname, sonst Alias, der mit dem Hostnamen beginnt.
   */
  async findByHostname(hostname: string): Promise<CapabilityResult<RemoteSupportMatch>> {
    const devices = await this.listDevices();
    if (!devices.available) return devices;
    const wanted = shortHostname(hostname);
    const candidates = devices.data.filter((d) => {
      const alias = shortHostname(d.alias ?? '');
      return alias === wanted || (d.alias ?? '').toLowerCase().startsWith(`${wanted} `) || (d.alias ?? '').toLowerCase().startsWith(`${wanted}-`);
    });
    const exact = candidates.find((d) => shortHostname(d.alias ?? '') === wanted) ?? candidates[0];
    if (!exact) {
      return { available: true, data: { provider: 'teamviewer', found: false, deviceId: null, alias: null, online: null, uri: null, candidates: devices.data.length } };
    }
    return {
      available: true,
      data: {
        provider: 'teamviewer',
        found: true,
        deviceId: exact.device_id,
        alias: exact.alias ?? null,
        online: exact.online_state ? exact.online_state.toLowerCase() === 'online' : null,
        uri: teamViewerControlUri(exact),
        candidates: candidates.length,
      },
    };
  }
}
