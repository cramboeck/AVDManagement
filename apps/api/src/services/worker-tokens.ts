/**
 * Worker-Token je MSP
 *
 * Der Klartext entsteht einmal (zsw_ + 32 Zufallsbytes) und wird nur in der
 * Antwort auf das Anlegen gezeigt; in der Datenbank liegt der SHA-256. Ein
 * Worker gehoert damit zu genau einem MSP und sieht nur dessen Auftraege.
 * WORKER_TOKEN aus der Umgebung bleibt fuer Installationen mit genau einem
 * MSP als Uebergang erlaubt.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, mspOrganizations, workerTokens } from '../db/index.js';

export interface WorkerTokenInfo {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function envToken(): string | null {
  const raw = process.env.WORKER_TOKEN ?? '';
  return raw.length >= 16 ? raw : null;
}

/** Klartext-Token pruefen; liefert den MSP, zu dem der Worker gehoert. */
export async function resolveWorkerToken(presented: string | undefined): Promise<{ mspId: string; tokenId: string | null } | null> {
  if (!presented || presented.length < 16) return null;
  const row = await db.query.workerTokens.findFirst({ where: and(eq(workerTokens.tokenHash, hash(presented)), isNull(workerTokens.revokedAt)) });
  if (row) {
    await db.update(workerTokens).set({ lastUsedAt: new Date() }).where(eq(workerTokens.id, row.id));
    return { mspId: row.mspId, tokenId: row.id };
  }
  const env = envToken();
  if (env) {
    const a = Buffer.from(presented);
    const b = Buffer.from(env);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      // Umgebungs-Token ist nicht an einen MSP gebunden; nur eindeutig, wenn es genau einen gibt
      const msps = await db.select({ id: mspOrganizations.id }).from(mspOrganizations).where(eq(mspOrganizations.isActive, true)).limit(2);
      if (msps.length === 1) return { mspId: msps[0].id, tokenId: null };
    }
  }
  return null;
}

/** Gibt es fuer diesen MSP ein nutzbares Token (DB oder Umgebung)? */
export async function workerTokenAvailable(mspId: string): Promise<boolean> {
  const row = await db.query.workerTokens.findFirst({ where: and(eq(workerTokens.mspId, mspId), isNull(workerTokens.revokedAt)) });
  if (row) return true;
  if (!envToken()) return false;
  const msps = await db.select({ id: mspOrganizations.id }).from(mspOrganizations).where(eq(mspOrganizations.isActive, true)).limit(2);
  return msps.length === 1 && msps[0].id === mspId;
}

export async function listWorkerTokens(mspId: string): Promise<WorkerTokenInfo[]> {
  const rows = await db.query.workerTokens.findMany({ where: eq(workerTokens.mspId, mspId) });
  return rows
    .map((r) => ({ id: r.id, label: r.label, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null, revokedAt: r.revokedAt?.toISOString() ?? null }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createWorkerToken(mspId: string, userId: string, label: string): Promise<{ token: string; info: WorkerTokenInfo }> {
  const clean = label.trim().slice(0, 100);
  if (clean.length < 2) throw new Error('Bezeichnung muss mindestens 2 Zeichen haben');
  const token = `zsw_${randomBytes(32).toString('base64url')}`;
  const [row] = await db.insert(workerTokens).values({ mspId, label: clean, tokenHash: hash(token), createdBy: userId }).returning();
  return { token, info: { id: row.id, label: row.label, createdAt: row.createdAt.toISOString(), lastUsedAt: null, revokedAt: null } };
}

export async function revokeWorkerToken(mspId: string, tokenId: string): Promise<boolean> {
  const rows = await db.update(workerTokens).set({ revokedAt: new Date() }).where(and(eq(workerTokens.mspId, mspId), eq(workerTokens.id, tokenId), isNull(workerTokens.revokedAt))).returning({ id: workerTokens.id });
  return rows.length > 0;
}
