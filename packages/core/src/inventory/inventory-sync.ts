/**
 * Bestands-Sync
 *
 * Laedt Geraete und Schwachstellen je Tenant in festen Intervallen aus
 * Microsoft und legt sie als Snapshot ab. Lesende Seiten bekommen den
 * Snapshot mit Alter; fehlt er, wird einmal direkt geladen und dabei
 * angelegt. Der Sync ist lesend und damit kein Job im Sinne des
 * Job-Modells: keine Freigabe, kein Audit, aber Zustand und Fehler je
 * Bestandsart sichtbar.
 *
 * InventorySyncEngine enthaelt die Logik ohne Queue (testbar),
 * InventorySyncService haengt sie an BullMQ.
 */

import { Queue, Worker, type Job as BullJob } from 'bullmq';
import type { Redis } from 'ioredis';
import type {
  CapabilityResult,
  DeviceInventory,
  InventoryKind,
  MspId,
  SnapshotMeta,
  TenantId,
  TenantVulnerabilitySet,
} from '@zerostress/types';
import type { ProviderContext } from '../providers/resource-provider.js';
import type { InventorySnapshotStore, SnapshotRecord } from './snapshot-store.js';

export const INVENTORY_KINDS: InventoryKind[] = ['devices', 'vulnerabilities'];

// Zielintervalle: Geraete aendern sich oefter als die CVE-Zuordnung
export const DEFAULT_SYNC_INTERVALS: Record<InventoryKind, number> = {
  devices: 15 * 60 * 1000,
  vulnerabilities: 60 * 60 * 1000,
};

// Ein Sync, der laenger als das laeuft, gilt als abgebrochen (Prozessneustart)
export const RUNNING_STUCK_MS = 10 * 60 * 1000;
// Nach einem Fehler nicht sofort wieder anrennen
export const ERROR_RETRY_MS = 5 * 60 * 1000;
const DEFAULT_TICK_MS = 5 * 60 * 1000;

export interface SyncTarget {
  tenantId: TenantId;
  mspId: MspId;
}

export interface InventoryPayloads {
  devices: DeviceInventory;
  vulnerabilities: CapabilityResult<TenantVulnerabilitySet>;
}

export type InventoryLoaders = {
  [K in InventoryKind]: (ctx: ProviderContext) => Promise<InventoryPayloads[K]>;
};

export type SyncReason = 'scheduled' | 'manual' | 'missing';

export interface SnapshotRead<T> {
  payload: T;
  meta: SnapshotMeta;
}

export interface InventorySyncEngineOptions {
  store: InventorySnapshotStore;
  loaders: InventoryLoaders;
  // Alle Tenants, die synchronisiert werden sollen (verbunden und aktiv)
  listTargets: () => Promise<SyncTarget[]>;
  // Sync im Hintergrund anstossen (Queue); die Engine wartet nicht darauf
  enqueue: (target: SyncTarget, kinds: InventoryKind[], reason: SyncReason) => Promise<void>;
  onSynced?: (target: SyncTarget, kind: InventoryKind) => Promise<void>;
  intervals?: Partial<Record<InventoryKind, number>>;
  now?: () => Date;
}

/**
 * Welche Bestandsarten eines Tenants jetzt einen Sync brauchen.
 */
export function planSync(records: SnapshotRecord[], now: Date, intervals: Record<InventoryKind, number>): InventoryKind[] {
  const due: InventoryKind[] = [];
  for (const kind of INVENTORY_KINDS) {
    const record = records.find((r) => r.kind === kind);
    if (!record) {
      due.push(kind);
      continue;
    }
    if (record.status === 'running') {
      const startedAt = record.startedAt?.getTime() ?? 0;
      if (now.getTime() - startedAt >= RUNNING_STUCK_MS) due.push(kind);
      continue;
    }
    if (record.status === 'error') {
      const attemptedAt = record.startedAt?.getTime() ?? 0;
      if (now.getTime() - attemptedAt >= ERROR_RETRY_MS) due.push(kind);
      continue;
    }
    const syncedAt = record.syncedAt?.getTime() ?? 0;
    if (now.getTime() - syncedAt >= intervals[kind]) due.push(kind);
  }
  return due;
}

/**
 * Anzeige-Metadaten eines Snapshots.
 */
export function toMeta(
  record: SnapshotRecord | null,
  kind: InventoryKind,
  now: Date,
  intervals: Record<InventoryKind, number>,
  live = false
): SnapshotMeta {
  if (!record) {
    return {
      kind,
      status: 'missing',
      syncedAt: null,
      startedAt: null,
      durationMs: null,
      itemCount: 0,
      error: null,
      stale: true,
      live,
    };
  }
  const stuck = record.status === 'running' && now.getTime() - (record.startedAt?.getTime() ?? 0) >= RUNNING_STUCK_MS;
  return {
    kind,
    status: stuck ? 'error' : record.status,
    syncedAt: record.syncedAt?.toISOString() ?? null,
    startedAt: record.startedAt?.toISOString() ?? null,
    durationMs: record.durationMs,
    itemCount: record.itemCount,
    error: stuck ? 'Sync did not finish' : record.error,
    stale: record.syncedAt ? now.getTime() - record.syncedAt.getTime() >= intervals[kind] : true,
    live,
  };
}

function countItems<K extends InventoryKind>(kind: K, payload: InventoryPayloads[K]): number {
  if (kind === 'devices') {
    return (payload as DeviceInventory).items.length;
  }
  const vulns = payload as CapabilityResult<TenantVulnerabilitySet>;
  return vulns.available ? vulns.data.items.length : 0;
}

// Snapshot-Metadaten gehoeren nicht in den gespeicherten Stand
function stripMeta<K extends InventoryKind>(kind: K, payload: InventoryPayloads[K]): InventoryPayloads[K] {
  if (kind === 'devices') {
    const { snapshot: _snapshot, ...rest } = payload as DeviceInventory;
    return rest as InventoryPayloads[K];
  }
  const { snapshot: _snapshot, ...rest } = payload as CapabilityResult<TenantVulnerabilitySet> & { snapshot?: SnapshotMeta };
  return rest as InventoryPayloads[K];
}

export class InventorySyncEngine {
  private readonly store: InventorySnapshotStore;
  private readonly loaders: InventoryLoaders;
  private readonly listTargets: () => Promise<SyncTarget[]>;
  private readonly enqueue: InventorySyncEngineOptions['enqueue'];
  private readonly onSynced?: InventorySyncEngineOptions['onSynced'];
  readonly intervals: Record<InventoryKind, number>;
  private readonly now: () => Date;
  // Laufende Ladevorgaenge je Tenant und Art, damit parallele Aufrufe nicht doppelt laden
  private readonly inflight = new Map<string, Promise<SnapshotRecord>>();

  constructor(options: InventorySyncEngineOptions) {
    this.store = options.store;
    this.loaders = options.loaders;
    this.listTargets = options.listTargets;
    this.enqueue = options.enqueue;
    this.onSynced = options.onSynced;
    this.intervals = {
      devices: options.intervals?.devices ?? DEFAULT_SYNC_INTERVALS.devices,
      vulnerabilities: options.intervals?.vulnerabilities ?? DEFAULT_SYNC_INTERVALS.vulnerabilities,
    };
    this.now = options.now ?? (() => new Date());
  }

  async getStatus(tenantId: TenantId): Promise<SnapshotMeta[]> {
    const records = await this.store.list(tenantId);
    const now = this.now();
    return INVENTORY_KINDS.map((kind) => toMeta(records.find((r) => r.kind === kind) ?? null, kind, now, this.intervals));
  }

  /**
   * Snapshot lesen. Ohne Stand wird einmal direkt geladen und gespeichert;
   * ein veralteter Stand wird sofort geliefert und im Hintergrund erneuert.
   */
  async getOrLoad<K extends InventoryKind>(target: SyncTarget, kind: K): Promise<SnapshotRead<InventoryPayloads[K]>> {
    const record = await this.store.get<InventoryPayloads[K]>(target.tenantId, kind);

    if (record?.payload) {
      const meta = toMeta(record, kind, this.now(), this.intervals);
      if (meta.stale && meta.status !== 'running') {
        this.enqueue(target, [kind], 'scheduled').catch((error: Error) =>
          console.error(`Could not queue inventory refresh for tenant ${target.tenantId}:`, error.message)
        );
      }
      return { payload: record.payload, meta };
    }

    const fresh = await this.sync(target, kind);
    return { payload: fresh.payload as InventoryPayloads[K], meta: toMeta(fresh, kind, this.now(), this.intervals, true) };
  }

  /**
   * Eine Bestandsart jetzt laden und als Snapshot ablegen.
   */
  async sync<K extends InventoryKind>(target: SyncTarget, kind: K): Promise<SnapshotRecord<InventoryPayloads[K]>> {
    const key = `${target.tenantId}|${kind}`;
    const running = this.inflight.get(key);
    if (running) {
      return running as Promise<SnapshotRecord<InventoryPayloads[K]>>;
    }

    const snapshotKey = { tenantId: target.tenantId, mspId: target.mspId, kind };
    const run = (async (): Promise<SnapshotRecord<InventoryPayloads[K]>> => {
      const startedAt = this.now();
      await this.store.markRunning(snapshotKey, startedAt);
      try {
        const ctx: ProviderContext = { tenantId: target.tenantId, correlationId: crypto.randomUUID() };
        const payload = stripMeta(kind, await this.loaders[kind](ctx));
        const syncedAt = this.now();
        await this.store.complete(snapshotKey, {
          payload,
          itemCount: countItems(kind, payload),
          syncedAt,
          durationMs: syncedAt.getTime() - startedAt.getTime(),
        });
        if (this.onSynced) {
          await this.onSynced(target, kind);
        }
        const stored = await this.store.get<InventoryPayloads[K]>(target.tenantId, kind);
        if (!stored) {
          throw new Error(`Snapshot ${kind} for tenant ${target.tenantId} vanished after write`);
        }
        return stored;
      } catch (error) {
        await this.store.fail(snapshotKey, {
          error: error instanceof Error ? error.message : String(error),
          durationMs: this.now().getTime() - startedAt.getTime(),
        });
        throw error;
      }
    })().finally(() => this.inflight.delete(key));

    this.inflight.set(key, run);
    return run;
  }

  /**
   * Alle Tenants pruefen und faellige Syncs einreihen.
   */
  async runTick(): Promise<number> {
    const targets = await this.listTargets();
    const now = this.now();
    let queued = 0;
    for (const target of targets) {
      const records = await this.store.list(target.tenantId);
      const due = planSync(records, now, this.intervals);
      if (due.length > 0) {
        await this.enqueue(target, due, 'scheduled');
        queued += due.length;
      }
    }
    return queued;
  }
}

export interface InventorySyncOptions extends Omit<InventorySyncEngineOptions, 'enqueue' | 'now'> {
  redis: Redis;
  tickEveryMs?: number;
  concurrency?: number;
  queueName?: string;
}

type SyncJobData = { type: 'tick' } | { type: 'sync'; tenantId: TenantId; mspId: MspId; kind: InventoryKind; reason: SyncReason };

export class InventorySyncService {
  private readonly queue: Queue<SyncJobData>;
  private worker: Worker<SyncJobData> | null = null;
  private readonly engine: InventorySyncEngine;
  private readonly tickEveryMs: number;
  private readonly concurrency: number;

  constructor(options: InventorySyncOptions) {
    this.queue = new Queue<SyncJobData>(options.queueName ?? 'inventory-sync', {
      connection: options.redis,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    this.engine = new InventorySyncEngine({
      store: options.store,
      loaders: options.loaders,
      listTargets: options.listTargets,
      onSynced: options.onSynced,
      intervals: options.intervals,
      enqueue: (target, kinds, reason) => this.requestRefresh(target, kinds, reason),
    });
    this.tickEveryMs = options.tickEveryMs ?? DEFAULT_TICK_MS;
    this.concurrency = options.concurrency ?? 2;
  }

  /**
   * Worker und wiederkehrenden Takt starten. Der erste Takt laeuft sofort,
   * damit nach einem Neustart nicht erst Minuten vergehen.
   */
  async start(): Promise<void> {
    if (this.worker) return;

    this.worker = new Worker<SyncJobData>(
      this.queue.name,
      async (job: BullJob<SyncJobData>) => {
        if (job.data.type === 'tick') {
          await this.engine.runTick();
          return;
        }
        const { tenantId, mspId, kind } = job.data;
        try {
          await this.engine.sync({ tenantId, mspId }, kind);
        } catch (error) {
          // Fehler steht im Snapshot; der naechste Takt versucht es erneut
          console.error(`Inventory sync ${kind} for tenant ${tenantId} failed:`, error instanceof Error ? error.message : String(error));
        }
      },
      { connection: this.queue.opts.connection as Redis, concurrency: this.concurrency }
    );
    this.worker.on('error', (error: Error) => {
      console.error('Inventory worker error:', error.message);
    });

    await this.queue.upsertJobScheduler('inventory-tick', { every: this.tickEveryMs }, { name: 'tick', data: { type: 'tick' } });
    this.engine.runTick().catch((error: Error) => console.error('Initial inventory tick failed:', error.message));
  }

  async stop(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  getHealth(): { redisStatus: string; workerRunning: boolean } {
    const connection = this.queue.opts.connection as Redis;
    return { redisStatus: connection.status, workerRunning: this.worker !== null && this.worker.isRunning() };
  }

  /**
   * Sync fuer einen Tenant einreihen. Gleiche Auftraege werden zusammengelegt.
   */
  async requestRefresh(target: SyncTarget, kinds: InventoryKind[] = INVENTORY_KINDS, reason: SyncReason = 'manual'): Promise<void> {
    await Promise.all(
      kinds.map((kind) =>
        this.queue.add(
          'sync',
          { type: 'sync', tenantId: target.tenantId, mspId: target.mspId, kind, reason },
          // BullMQ erlaubt keinen Doppelpunkt in eigenen Job-Ids
          { jobId: `sync_${target.tenantId}_${kind}`, priority: reason === 'manual' ? 1 : 5 }
        )
      )
    );
  }

  getStatus(tenantId: TenantId): Promise<SnapshotMeta[]> {
    return this.engine.getStatus(tenantId);
  }

  getOrLoad<K extends InventoryKind>(target: SyncTarget, kind: K): Promise<SnapshotRead<InventoryPayloads[K]>> {
    return this.engine.getOrLoad(target, kind);
  }

  sync<K extends InventoryKind>(target: SyncTarget, kind: K): Promise<SnapshotRecord<InventoryPayloads[K]>> {
    return this.engine.sync(target, kind);
  }
}
