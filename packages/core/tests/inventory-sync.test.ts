/**
 * Tests fuer den Bestands-Sync (Engine ohne Queue)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  INVENTORY_KINDS,
  InventorySyncEngine,
  planSync,
  toMeta,
  DEFAULT_SYNC_INTERVALS,
  ERROR_RETRY_MS,
  RUNNING_STUCK_MS,
} from '../src/inventory/inventory-sync.js';
import { InMemorySnapshotStore, type SnapshotRecord } from '../src/inventory/snapshot-store.js';
import type { DeviceInventory, MspId, TenantId } from '@zerostress/types';

const TENANT_A = 'tenant-a' as TenantId;
const TENANT_B = 'tenant-b' as TenantId;
const MSP = 'msp-1' as MspId;
const NOW = new Date('2026-09-25T10:00:00Z');

function inventory(names: string[]): DeviceInventory {
  return {
    items: names.map((name) => ({
      id: `id-${name}`,
      name,
      azureAdDeviceId: null,
      operatingSystem: 'Windows',
      osVersion: null,
      primaryUser: null,
      lastActivityAt: null,
      intune: null,
      defender: null,
    })),
    intune: { available: true, data: { count: names.length } },
    defender: { available: false, reason: 'not-licensed', missingPermission: null, detail: null },
  };
}

function record(overrides: Partial<SnapshotRecord>): SnapshotRecord {
  return {
    tenantId: TENANT_A,
    mspId: MSP,
    kind: 'devices',
    status: 'ready',
    payload: inventory(['a']),
    itemCount: 1,
    syncedAt: NOW,
    startedAt: NOW,
    durationMs: 100,
    error: null,
    unavailable: false,
    ...overrides,
  };
}

function engineFor(store: InMemorySnapshotStore, loaders?: Partial<ConstructorParameters<typeof InventorySyncEngine>[0]['loaders']>) {
  const enqueue = vi.fn(async () => undefined);
  const devices = vi.fn(async (ctx: { tenantId: TenantId }) => inventory([`dev-of-${ctx.tenantId}`]));
  const vulnerabilities = vi.fn(async () => ({ available: true as const, data: { items: [], truncated: false } }));
  const groups = vi.fn(async () => ({
    available: true as const,
    data: {
      items: [],
      stats: { total: 0, teams: 0, microsoft365: 0, security: 0, distribution: 0, ownerless: 0, withGuests: 0, publicTeams: 0, dynamic: 0 },
      countsTruncated: false,
    },
  }));
  const mail = vi.fn(async () => ({ available: false as const, reason: 'permission-missing' as const, missingPermission: 'Reports.Read.All', detail: null }));
  const apps = vi.fn(async () => ({ available: true as const, data: { items: [], stats: { total: 0, assigned: 0, withFailures: 0, win32: 0, winget: 0 }, summaryAvailable: false } }));
  const sharepoint = vi.fn(async () => ({ available: false as const, reason: 'permission-missing' as const, missingPermission: 'Reports.Read.All', detail: null }));
  const software = vi.fn(async () => ({ available: true as const, data: { items: [] } }));
  const engine = new InventorySyncEngine({
    store,
    loaders: { devices, vulnerabilities, groups, mail, apps, sharepoint, software, ...loaders },
    listTargets: async () => [
      { tenantId: TENANT_A, mspId: MSP },
      { tenantId: TENANT_B, mspId: MSP },
    ],
    enqueue,
    now: () => NOW,
  });
  return { engine, enqueue, devices, vulnerabilities };
}

describe('planSync', () => {
  it('schedules every kind when nothing is stored', () => {
    expect(planSync([], NOW, DEFAULT_SYNC_INTERVALS)).toEqual(['devices', 'vulnerabilities', 'groups', 'mail', 'apps', 'sharepoint', 'software']);
  });

  it('leaves fresh snapshots alone and picks up stale ones', () => {
    const fresh = record({ kind: 'devices', syncedAt: new Date(NOW.getTime() - 60_000) });
    const stale = record({ kind: 'vulnerabilities', syncedAt: new Date(NOW.getTime() - DEFAULT_SYNC_INTERVALS.vulnerabilities) });
    const freshGroups = record({ kind: 'groups', syncedAt: NOW });
    const freshMail = record({ kind: 'mail', syncedAt: NOW });
    const freshApps = record({ kind: 'apps', syncedAt: NOW });
    const freshSp = record({ kind: 'sharepoint', syncedAt: NOW });
    const freshSw = record({ kind: 'software', syncedAt: NOW });
    expect(planSync([fresh, stale, freshGroups, freshMail, freshApps, freshSp, freshSw], NOW, DEFAULT_SYNC_INTERVALS)).toEqual(['vulnerabilities']);
  });

  it('does not restart a running sync unless it is stuck', () => {
    const running = record({ status: 'running', startedAt: new Date(NOW.getTime() - 60_000) });
    const stuck = record({ kind: 'vulnerabilities', status: 'running', startedAt: new Date(NOW.getTime() - RUNNING_STUCK_MS) });
    const groups = record({ kind: 'groups', syncedAt: NOW });
    const mail = record({ kind: 'mail', syncedAt: NOW });
    const apps = record({ kind: 'apps', syncedAt: NOW });
    const sp = record({ kind: 'sharepoint', syncedAt: NOW });
    const sw = record({ kind: 'software', syncedAt: NOW });
    expect(planSync([running, stuck, groups, mail, apps, sp, sw], NOW, DEFAULT_SYNC_INTERVALS)).toEqual(['vulnerabilities']);
  });

  it('retries a failed sync only after the backoff', () => {
    const recent = record({ status: 'error', error: 'boom', startedAt: new Date(NOW.getTime() - 1000) });
    const old = record({ kind: 'vulnerabilities', status: 'error', error: 'boom', startedAt: new Date(NOW.getTime() - ERROR_RETRY_MS) });
    const groups = record({ kind: 'groups', syncedAt: NOW });
    const mail = record({ kind: 'mail', syncedAt: NOW });
    const apps = record({ kind: 'apps', syncedAt: NOW });
    const sp = record({ kind: 'sharepoint', syncedAt: NOW });
    const sw = record({ kind: 'software', syncedAt: NOW });
    expect(planSync([recent, old, groups, mail, apps, sp, sw], NOW, DEFAULT_SYNC_INTERVALS)).toEqual(['vulnerabilities']);
  });
});

describe('planSync with unavailable sources', () => {
  it('retries a source that was unavailable after five minutes instead of the full interval', () => {
    const unavailable = record({ kind: 'vulnerabilities', unavailable: true, syncedAt: new Date(NOW.getTime() - 6 * 60_000) });
    const others = INVENTORY_KINDS.filter((k) => k !== 'vulnerabilities').map((k) => record({ kind: k, syncedAt: NOW }));
    expect(planSync([unavailable, ...others], NOW, DEFAULT_SYNC_INTERVALS)).toEqual(['vulnerabilities']);
    const fresh = record({ kind: 'vulnerabilities', unavailable: true, syncedAt: new Date(NOW.getTime() - 60_000) });
    expect(planSync([fresh, ...others], NOW, DEFAULT_SYNC_INTERVALS)).toEqual([]);
  });
});

describe('toMeta', () => {
  it('reports a missing snapshot as stale', () => {
    expect(toMeta(null, 'devices', NOW, DEFAULT_SYNC_INTERVALS)).toMatchObject({ status: 'missing', stale: true, syncedAt: null, itemCount: 0 });
  });

  it('turns a stuck running sync into an error without losing the last stand', () => {
    const stuck = record({ status: 'running', startedAt: new Date(NOW.getTime() - RUNNING_STUCK_MS), syncedAt: new Date(NOW.getTime() - 1000) });
    expect(toMeta(stuck, 'devices', NOW, DEFAULT_SYNC_INTERVALS)).toMatchObject({ status: 'error', error: 'Sync did not finish', stale: false, itemCount: 1 });
  });
});

describe('InventorySyncEngine', () => {
  it('loads live once when no snapshot exists and stores it', async () => {
    const store = new InMemorySnapshotStore();
    const { engine, devices, enqueue } = engineFor(store);

    const read = await engine.getOrLoad({ tenantId: TENANT_A, mspId: MSP }, 'devices');

    expect(read.meta).toMatchObject({ status: 'ready', live: true, itemCount: 1, stale: false });
    expect(read.payload.items[0].name).toBe('dev-of-tenant-a');
    expect(devices).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();

    const again = await engine.getOrLoad({ tenantId: TENANT_A, mspId: MSP }, 'devices');
    expect(again.meta.live).toBe(false);
    expect(devices).toHaveBeenCalledTimes(1);
  });

  it('serves a stale snapshot immediately and queues a refresh instead of loading inline', async () => {
    const store = new InMemorySnapshotStore();
    const key = { tenantId: TENANT_A, mspId: MSP, kind: 'devices' as const };
    await store.markRunning(key, new Date(NOW.getTime() - 3_600_000));
    await store.complete(key, { payload: inventory(['old']), itemCount: 1, syncedAt: new Date(NOW.getTime() - 3_600_000), durationMs: 5, unavailable: false });
    const { engine, devices, enqueue } = engineFor(store);

    const read = await engine.getOrLoad({ tenantId: TENANT_A, mspId: MSP }, 'devices');

    expect(read.payload.items[0].name).toBe('old');
    expect(read.meta.stale).toBe(true);
    expect(devices).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith({ tenantId: TENANT_A, mspId: MSP }, ['devices'], 'scheduled');
  });

  it('keeps the previous stand when a sync fails and exposes the error', async () => {
    const store = new InMemorySnapshotStore();
    const key = { tenantId: TENANT_A, mspId: MSP, kind: 'devices' as const };
    await store.markRunning(key, NOW);
    await store.complete(key, { payload: inventory(['kept']), itemCount: 1, syncedAt: NOW, durationMs: 5, unavailable: false });
    const { engine } = engineFor(store, {
      devices: vi.fn(async () => {
        throw new Error('Graph 503');
      }),
    });

    await expect(engine.sync({ tenantId: TENANT_A, mspId: MSP }, 'devices')).rejects.toThrow('Graph 503');

    const [meta] = await engine.getStatus(TENANT_A);
    expect(meta).toMatchObject({ kind: 'devices', status: 'error', error: 'Graph 503', itemCount: 1 });
    const read = await engine.getOrLoad({ tenantId: TENANT_A, mspId: MSP }, 'devices');
    expect(read.payload.items[0].name).toBe('kept');
  });

  it('deduplicates concurrent loads of the same tenant and kind', async () => {
    const store = new InMemorySnapshotStore();
    const { engine, devices } = engineFor(store);

    await Promise.all([
      engine.getOrLoad({ tenantId: TENANT_A, mspId: MSP }, 'devices'),
      engine.getOrLoad({ tenantId: TENANT_A, mspId: MSP }, 'devices'),
      engine.getOrLoad({ tenantId: TENANT_A, mspId: MSP }, 'devices'),
    ]);

    expect(devices).toHaveBeenCalledTimes(1);
  });

  it('never returns tenant B data for tenant A', async () => {
    const store = new InMemorySnapshotStore();
    const { engine, devices } = engineFor(store);

    await engine.sync({ tenantId: TENANT_B, mspId: MSP }, 'devices');
    await engine.sync({ tenantId: TENANT_B, mspId: MSP }, 'vulnerabilities');
    await engine.sync({ tenantId: TENANT_B, mspId: MSP }, 'groups');
    await engine.sync({ tenantId: TENANT_B, mspId: MSP }, 'mail');
    await engine.sync({ tenantId: TENANT_B, mspId: MSP }, 'apps');
    await engine.sync({ tenantId: TENANT_B, mspId: MSP }, 'sharepoint');
    const statusA = await engine.getStatus(TENANT_A);
    expect(statusA.every((m) => m.status === 'missing')).toBe(true);

    const readA = await engine.getOrLoad({ tenantId: TENANT_A, mspId: MSP }, 'devices');
    expect(readA.payload.items.map((d) => d.name)).toEqual(['dev-of-tenant-a']);
    expect(devices).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: TENANT_A }));

    const readB = await engine.getOrLoad({ tenantId: TENANT_B, mspId: MSP }, 'devices');
    expect(readB.payload.items.map((d) => d.name)).toEqual(['dev-of-tenant-b']);
    expect((await store.list(TENANT_A)).every((r) => r.tenantId === TENANT_A)).toBe(true);
  });

  it('queues only the kinds that are due on a tick', async () => {
    const store = new InMemorySnapshotStore();
    const key = { tenantId: TENANT_A, mspId: MSP, kind: 'devices' as const };
    await store.markRunning(key, NOW);
    await store.complete(key, { payload: inventory(['a']), itemCount: 1, syncedAt: NOW, durationMs: 1, unavailable: false });
    const { engine, enqueue } = engineFor(store);

    const queued = await engine.runTick();

    expect(queued).toBe(13);
    expect(enqueue).toHaveBeenCalledWith({ tenantId: TENANT_A, mspId: MSP }, ['vulnerabilities', 'groups', 'mail', 'apps', 'sharepoint', 'software'], 'scheduled');
    expect(enqueue).toHaveBeenCalledWith({ tenantId: TENANT_B, mspId: MSP }, ['devices', 'vulnerabilities', 'groups', 'mail', 'apps', 'sharepoint', 'software'], 'scheduled');
  });
});
