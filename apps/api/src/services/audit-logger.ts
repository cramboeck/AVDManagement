/**
 * Audit-Logger mit Hash-Kette
 *
 * Jeder Eintrag wird in einer Transaktion mit Sperre je MSP angelegt, damit
 * die Kette auch bei gleichzeitigen Aktionen eindeutig bleibt: Vorgaenger
 * lesen, eigenen Hash bilden, einfuegen. Aendern oder Loeschen verhindert
 * der Trigger aus db/harden.sql; die Kette macht es zusaetzlich sichtbar.
 */

import { desc, eq, sql } from 'drizzle-orm';
import { db, auditEntries } from '../db/index.js';
import { computeEntryHash, GENESIS_HASH } from './audit-chain.js';
import type { AuditLogger } from '@zerostress/core';
import type { MspId, TenantId, UserId, CorrelationId } from '@zerostress/types';

interface AuditLogEntry {
  mspId: MspId;
  // null bei MSP-weiten Aktionen ohne Tenant-Bezug
  tenantId: TenantId | null;
  userId: UserId;
  action: string;
  targetType: string;
  targetId: string;
  targetDisplayName: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  result: 'success' | 'failure' | 'partial';
  errorMessage?: string;
  correlationId: CorrelationId;
  ipAddress?: string;
  userAgent?: string;
}

export class DrizzleAuditLogger implements AuditLogger {
  async log(entry: AuditLogEntry): Promise<void> {
    const timestamp = new Date();
    await db.transaction(async (tx) => {
      // Sperre je MSP fuer die Dauer der Transaktion; hashtext liefert einen stabilen int4
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${entry.mspId}))`);
      const head = await tx
        .select({ entryHash: auditEntries.entryHash })
        .from(auditEntries)
        .where(eq(auditEntries.mspId, entry.mspId))
        .orderBy(desc(auditEntries.timestamp), desc(auditEntries.id))
        .limit(1);
      const prevHash = head[0]?.entryHash ?? GENESIS_HASH;
      const entryHash = computeEntryHash(prevHash, {
        mspId: entry.mspId,
        tenantId: entry.tenantId,
        timestamp: timestamp.toISOString(),
        userId: entry.userId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        targetDisplayName: entry.targetDisplayName ?? null,
        beforeState: entry.beforeState ?? null,
        afterState: entry.afterState ?? null,
        result: entry.result,
        errorMessage: entry.errorMessage ?? null,
        correlationId: entry.correlationId,
      });
      await tx.insert(auditEntries).values({
        mspId: entry.mspId,
        tenantId: entry.tenantId,
        timestamp,
        userId: entry.userId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        targetDisplayName: entry.targetDisplayName,
        beforeState: entry.beforeState,
        afterState: entry.afterState,
        result: entry.result,
        errorMessage: entry.errorMessage,
        correlationId: entry.correlationId,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        prevHash,
        entryHash,
      });
    });
  }
}
