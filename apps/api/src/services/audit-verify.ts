/**
 * Pruefung der Audit-Hash-Kette je MSP
 *
 * Liest alle Eintraege in Kettenreihenfolge und rechnet jeden Hash nach.
 * Eintraege ohne Hash stammen aus der Zeit vor der Kette und werden
 * gezaehlt, aber nicht geprueft; die Kette beginnt beim ersten Eintrag mit
 * Hash. Ein einziger falscher Hash bricht die Pruefung mit Position ab.
 */

import { asc, eq } from 'drizzle-orm';
import { db, auditEntries } from '../db/index.js';
import { computeEntryHash, GENESIS_HASH } from './audit-chain.js';

export interface ChainVerification {
  ok: boolean;
  checked: number;
  legacy: number;
  firstBroken: { id: string; timestamp: string; reason: string } | null;
  headHash: string | null;
  verifiedAt: string;
}

const PAGE = 1000;

export async function verifyAuditChain(mspId: string): Promise<ChainVerification> {
  let prevHash = GENESIS_HASH;
  let checked = 0;
  let legacy = 0;
  let offset = 0;
  let headHash: string | null = null;
  let chainStarted = false;

  while (true) {
    const rows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.mspId, mspId))
      .orderBy(asc(auditEntries.timestamp), asc(auditEntries.id))
      .limit(PAGE)
      .offset(offset);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (!row.entryHash) {
        if (chainStarted) {
          return { ok: false, checked, legacy, firstBroken: { id: row.id, timestamp: row.timestamp.toISOString(), reason: 'Eintrag ohne Hash mitten in der Kette' }, headHash, verifiedAt: new Date().toISOString() };
        }
        legacy += 1;
        continue;
      }
      chainStarted = true;
      if (row.prevHash !== prevHash) {
        return { ok: false, checked, legacy, firstBroken: { id: row.id, timestamp: row.timestamp.toISOString(), reason: 'Vorgaenger-Hash passt nicht; ein Eintrag davor fehlt oder wurde geaendert' }, headHash, verifiedAt: new Date().toISOString() };
      }
      const expected = computeEntryHash(prevHash, {
        mspId: row.mspId,
        tenantId: row.tenantId,
        timestamp: row.timestamp.toISOString(),
        userId: row.userId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        targetDisplayName: row.targetDisplayName,
        beforeState: row.beforeState ?? null,
        afterState: row.afterState ?? null,
        result: row.result,
        errorMessage: row.errorMessage,
        correlationId: row.correlationId,
      });
      if (expected !== row.entryHash) {
        return { ok: false, checked, legacy, firstBroken: { id: row.id, timestamp: row.timestamp.toISOString(), reason: 'Inhalt passt nicht zum Hash; der Eintrag wurde geaendert' }, headHash, verifiedAt: new Date().toISOString() };
      }
      prevHash = row.entryHash;
      headHash = row.entryHash;
      checked += 1;
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return { ok: true, checked, legacy, firstBroken: null, headHash, verifiedAt: new Date().toISOString() };
}
