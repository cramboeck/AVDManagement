/**
 * Serverseitige Browser-Sitzungen
 *
 * Der Browser bekommt nur eine zufaellige Sitzungs-Id im httpOnly-Cookie;
 * in der Datenbank liegt ihr SHA-256 mit Benutzer, Laufzeiten und einem
 * Hash der Client-IP (keine Klartext-IP, keine personenbezogenen Daten
 * ausser der Zuordnung zum Konto). Entra-Tokens werden nicht gespeichert:
 * die Konsole braucht die Identitaet, Graph laeuft app-only.
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db, userSessions } from '../db/index.js';
import { sessionPolicy } from './session-cookie.js';

const TOUCH_EVERY_MS = 60 * 1000;

export interface SessionRecord {
  id: string;
  userId: string;
  mspId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  idleExpiresAt: Date;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashClientIp(ip: string): string {
  return hash(`ip|${ip}`).slice(0, 32);
}

/** Neue Sitzung anlegen; Rueckgabe ist der Klartext fuer das Cookie. */
export async function createSession(input: { userId: string; mspId: string; ip: string; userAgent: string | undefined }): Promise<{ token: string; record: SessionRecord }> {
  const policy = sessionPolicy();
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const [row] = await db
    .insert(userSessions)
    .values({
      tokenHash: hash(token),
      userId: input.userId,
      mspId: input.mspId,
      ipHash: hashClientIp(input.ip),
      userAgent: (input.userAgent ?? '').slice(0, 200) || null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + policy.absoluteMs),
      idleExpiresAt: new Date(now.getTime() + policy.idleMs),
    })
    .returning();
  return { token, record: toRecord(row) };
}

type Row = typeof userSessions.$inferSelect;

function toRecord(row: Row): SessionRecord {
  return { id: row.id, userId: row.userId, mspId: row.mspId, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, expiresAt: row.expiresAt, idleExpiresAt: row.idleExpiresAt };
}

/**
 * Sitzung zum Cookie-Wert; verlaengert das Leerlauf-Ende hoechstens einmal
 * pro Minute, damit nicht jede Anfrage schreibt.
 */
export async function resolveSession(token: string | undefined): Promise<SessionRecord | null> {
  if (!token || token.length < 32) return null;
  const row = await db.query.userSessions.findFirst({ where: and(eq(userSessions.tokenHash, hash(token)), isNull(userSessions.revokedAt)) });
  if (!row) return null;
  const now = new Date();
  if (row.expiresAt <= now || row.idleExpiresAt <= now) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    const policy = sessionPolicy();
    const idleExpiresAt = new Date(Math.min(now.getTime() + policy.idleMs, row.expiresAt.getTime()));
    await db.update(userSessions).set({ lastSeenAt: now, idleExpiresAt }).where(eq(userSessions.id, row.id));
    return toRecord({ ...row, lastSeenAt: now, idleExpiresAt });
  }
  return toRecord(row);
}

export async function revokeSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.tokenHash, hash(token)), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  return rows.length > 0;
}

/** Alle Sitzungen eines Kontos beenden (Deaktivierung, Rollenwechsel). */
export async function revokeUserSessions(userId: string): Promise<number> {
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  return rows.length;
}

/** Abgelaufene und vor mehr als 30 Tagen widerrufene Sitzungen loeschen. */
export async function pruneSessions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .delete(userSessions)
    .where(or(lt(userSessions.expiresAt, cutoff), lt(userSessions.idleExpiresAt, cutoff), lt(userSessions.revokedAt, cutoff)))
    .returning({ id: userSessions.id });
  return rows.length;
}

let pruneTimer: NodeJS.Timeout | null = null;

export function startSessionPruning(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    pruneSessions().catch((error: Error) => console.error('Session pruning failed:', error.message));
  }, 60 * 60 * 1000);
  pruneTimer.unref();
}
