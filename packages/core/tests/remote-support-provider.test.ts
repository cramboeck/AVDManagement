/**
 * Tests fuer TeamViewerProvider (fetch gemockt)
 */

import { describe, it, expect, vi } from 'vitest';
import { TeamViewerProvider, teamViewerControlUri } from '../src/providers/remote-support-provider.js';

const devices = [
  { device_id: 'd111111111', remotecontrol_id: 'r222222222', alias: 'AOEPC239', online_state: 'Online' },
  { device_id: 'd333333333', remotecontrol_id: 'r444444444', alias: 'aoepc240 (Buero)', online_state: 'Offline' },
];

function fetchMock(status = 200) {
  return vi.fn(async () => ({ status, ok: status < 300, json: async () => ({ devices }) })) as unknown as typeof fetch;
}

describe('TeamViewerProvider', () => {
  it('reports not configured without a token', async () => {
    const provider = new TeamViewerProvider({ token: null });
    expect(await provider.findByHostname('x')).toMatchObject({ available: false, reason: 'not-onboarded' });
  });

  it('matches the hostname to the alias and builds the control URI', async () => {
    const f = fetchMock();
    const provider = new TeamViewerProvider({ token: 't', fetch: f, now: () => 1000 });
    const hit = await provider.findByHostname('aoepc239.contoso.local');
    expect(hit).toMatchObject({ available: true, data: { found: true, deviceId: 'd111111111', online: true, uri: 'teamviewer10://control?device=222222222' } });
    const prefix = await provider.findByHostname('AOEPC240');
    expect(prefix).toMatchObject({ available: true, data: { found: true, online: false } });
    const miss = await provider.findByHostname('nope');
    expect(miss).toMatchObject({ available: true, data: { found: false, candidates: 2 } });
    // Liste wird fuenf Minuten gehalten
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('maps 401 to a permission state and throws on server errors', async () => {
    expect(await new TeamViewerProvider({ token: 't', fetch: fetchMock(401) }).findByHostname('a')).toMatchObject({ available: false, reason: 'permission-missing' });
    await expect(new TeamViewerProvider({ token: 't', fetch: fetchMock(503) }).findByHostname('a')).rejects.toThrow('503');
  });

  it('extracts the numeric id for the URI', () => {
    expect(teamViewerControlUri({ device_id: 'd1', remotecontrol_id: 'r987654321' })).toBe('teamviewer10://control?device=987654321');
    expect(teamViewerControlUri({ device_id: 'd123456789' })).toBe('teamviewer10://control?device=123456789');
    expect(teamViewerControlUri({ device_id: 'x' })).toBeNull();
  });
});
