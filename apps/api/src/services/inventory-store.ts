/**
 * Bestands-Snapshot in Postgres
 *
 * Jede Abfrage filtert auf tenant_id; der Primaerschluessel ist
 * (tenant_id, kind), ein Tenant kann also nie den Stand eines anderen
 * ueberschreiben oder lesen.
 */

import { and, eq } from 'drizzle-orm';
import { db, inventorySnapshots } from '../db/index.js';
import type { InventorySnapshotStore, SnapshotKey, SnapshotRecord, SnapshotRecordStatus } from '@zerostress/core';
import type { InventoryKind, MspId, TenantId } from '@zerostress/types';

type SnapshotRow = typeof inventorySnapshots.$inferSelect;

function toRecord<T>(row: SnapshotRow): SnapshotRecord<T> {
  return {
    tenantId: row.tenantId as TenantId,
    mspId: row.mspId as MspId,
    kind: row.kind as InventoryKind,
    status: row.status as SnapshotRecordStatus,
    payload: (row.payload as T | null) ?? null,
    itemCount: row.itemCount,
    syncedAt: row.syncedAt,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    error: row.error,
    unavailable: row.unavailable === true,
  };
}

export class DrizzleSnapshotStore implements InventorySnapshotStore {
  async get<T>(tenantId: TenantId, kind: InventoryKind): Promise<SnapshotRecord<T> | null> {
    const row = await db.query.inventorySnapshots.findFirst({
      where: and(eq(inventorySnapshots.tenantId, tenantId), eq(inventorySnapshots.kind, kind)),
    });
    return row ? toRecord<T>(row) : null;
  }

  async list(tenantId: TenantId): Promise<SnapshotRecord[]> {
    const rows = await db.query.inventorySnapshots.findMany({
      where: eq(inventorySnapshots.tenantId, tenantId),
      // Der Stand selbst wird fuer die Statusanzeige nicht gebraucht
      columns: { payload: false },
    });
    return rows.map((row) => toRecord({ ...row, payload: null }));
  }

  async markRunning(key: SnapshotKey, startedAt: Date): Promise<void> {
    await db
      .insert(inventorySnapshots)
      .values({ tenantId: key.tenantId, mspId: key.mspId, kind: key.kind, status: 'running', startedAt })
      .onConflictDoUpdate({
        target: [inventorySnapshots.tenantId, inventorySnapshots.kind],
        set: { status: 'running', startedAt },
      });
  }

  async complete<T>(key: SnapshotKey, input: { payload: T; itemCount: number; syncedAt: Date; durationMs: number; unavailable: boolean }): Promise<void> {
    const values = {
      status: 'ready',
      payload: input.payload,
      itemCount: input.itemCount,
      syncedAt: input.syncedAt,
      durationMs: input.durationMs,
      error: null,
      unavailable: input.unavailable,
    };
    await db
      .insert(inventorySnapshots)
      .values({ tenantId: key.tenantId, mspId: key.mspId, kind: key.kind, ...values })
      .onConflictDoUpdate({ target: [inventorySnapshots.tenantId, inventorySnapshots.kind], set: values });
  }

  async fail(key: SnapshotKey, input: { error: string; durationMs: number }): Promise<void> {
    const values = { status: 'error', error: input.error, durationMs: input.durationMs };
    await db
      .insert(inventorySnapshots)
      .values({ tenantId: key.tenantId, mspId: key.mspId, kind: key.kind, ...values })
      .onConflictDoUpdate({ target: [inventorySnapshots.tenantId, inventorySnapshots.kind], set: values });
  }

  async deleteForTenant(tenantId: TenantId): Promise<void> {
    await db.delete(inventorySnapshots).where(eq(inventorySnapshots.tenantId, tenantId));
  }
}
