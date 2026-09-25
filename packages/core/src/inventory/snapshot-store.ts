/**
 * Bestands-Snapshot: Speicherschnittstelle
 *
 * Ein Snapshot ist der letzte bekannte Stand einer Bestandsart (Geraete,
 * Schwachstellen) eines Tenants. Er wird als Ganzes geschrieben und als
 * Ganzes gelesen; ein fehlgeschlagener Sync laesst den alten Stand stehen.
 * Jeder Datensatz traegt die TenantId, jede Abfrage filtert darauf.
 */

import type { InventoryKind, MspId, TenantId } from '@zerostress/types';

export type SnapshotRecordStatus = 'running' | 'ready' | 'error';

export interface SnapshotRecord<T = unknown> {
  tenantId: TenantId;
  mspId: MspId;
  kind: InventoryKind;
  status: SnapshotRecordStatus;
  // Letzter erfolgreich geladener Stand; bleibt bei running/error erhalten
  payload: T | null;
  itemCount: number;
  syncedAt: Date | null;
  startedAt: Date | null;
  durationMs: number | null;
  error: string | null;
  // true: die Quelle war nicht verfuegbar (Berechtigung, Lizenz); kuerzeres Wiederholintervall
  unavailable: boolean;
}

export interface SnapshotKey {
  tenantId: TenantId;
  mspId: MspId;
  kind: InventoryKind;
}

export interface InventorySnapshotStore {
  get<T>(tenantId: TenantId, kind: InventoryKind): Promise<SnapshotRecord<T> | null>;
  list(tenantId: TenantId): Promise<SnapshotRecord[]>;
  // Legt den Datensatz an oder setzt ihn auf running; Payload bleibt erhalten
  markRunning(key: SnapshotKey, startedAt: Date): Promise<void>;
  complete<T>(key: SnapshotKey, input: { payload: T; itemCount: number; syncedAt: Date; durationMs: number; unavailable: boolean }): Promise<void>;
  // Fehler festhalten, alter Stand bleibt lesbar
  fail(key: SnapshotKey, input: { error: string; durationMs: number }): Promise<void>;
  deleteForTenant(tenantId: TenantId): Promise<void>;
}

/**
 * Speicher im Prozess, fuer Tests und als Referenz fuer das Isolationsverhalten.
 */
export class InMemorySnapshotStore implements InventorySnapshotStore {
  private readonly records = new Map<string, SnapshotRecord>();

  private keyOf(tenantId: TenantId, kind: InventoryKind): string {
    return `${tenantId}|${kind}`;
  }

  async get<T>(tenantId: TenantId, kind: InventoryKind): Promise<SnapshotRecord<T> | null> {
    const record = this.records.get(this.keyOf(tenantId, kind));
    return record ? ({ ...record } as SnapshotRecord<T>) : null;
  }

  async list(tenantId: TenantId): Promise<SnapshotRecord[]> {
    return Array.from(this.records.values())
      .filter((r) => r.tenantId === tenantId)
      .map((r) => ({ ...r }));
  }

  async markRunning(key: SnapshotKey, startedAt: Date): Promise<void> {
    const existing = this.records.get(this.keyOf(key.tenantId, key.kind));
    this.records.set(this.keyOf(key.tenantId, key.kind), {
      tenantId: key.tenantId,
      mspId: key.mspId,
      kind: key.kind,
      status: 'running',
      payload: existing?.payload ?? null,
      itemCount: existing?.itemCount ?? 0,
      syncedAt: existing?.syncedAt ?? null,
      startedAt,
      durationMs: existing?.durationMs ?? null,
      error: existing?.error ?? null,
      unavailable: existing?.unavailable ?? false,
    });
  }

  async complete<T>(key: SnapshotKey, input: { payload: T; itemCount: number; syncedAt: Date; durationMs: number; unavailable: boolean }): Promise<void> {
    const existing = this.records.get(this.keyOf(key.tenantId, key.kind));
    this.records.set(this.keyOf(key.tenantId, key.kind), {
      tenantId: key.tenantId,
      mspId: key.mspId,
      kind: key.kind,
      status: 'ready',
      payload: input.payload,
      itemCount: input.itemCount,
      syncedAt: input.syncedAt,
      startedAt: existing?.startedAt ?? null,
      durationMs: input.durationMs,
      error: null,
      unavailable: input.unavailable,
    });
  }

  async fail(key: SnapshotKey, input: { error: string; durationMs: number }): Promise<void> {
    const existing = this.records.get(this.keyOf(key.tenantId, key.kind));
    this.records.set(this.keyOf(key.tenantId, key.kind), {
      tenantId: key.tenantId,
      mspId: key.mspId,
      kind: key.kind,
      status: 'error',
      payload: existing?.payload ?? null,
      itemCount: existing?.itemCount ?? 0,
      syncedAt: existing?.syncedAt ?? null,
      startedAt: existing?.startedAt ?? null,
      durationMs: input.durationMs,
      error: input.error,
      unavailable: existing?.unavailable ?? false,
    });
  }

  async deleteForTenant(tenantId: TenantId): Promise<void> {
    for (const key of Array.from(this.records.keys())) {
      if (key.startsWith(`${tenantId}|`)) this.records.delete(key);
    }
  }
}
