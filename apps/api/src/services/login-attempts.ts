/**
 * Fehlgeschlagene Anmeldungen an der Konsole. Bekannte Konten landen
 * zusaetzlich im Audit-Log (dort braucht jeder Eintrag einen Benutzer);
 * hier stehen auch Versuche unbekannter Konten, ohne Namen.
 */

import { createHash } from 'node:crypto';
import { lt } from 'drizzle-orm';
import { db, loginAttempts } from '../db/index.js';

export type LoginFailureReason = 'token-exchange-failed' | 'token-endpoint-unreachable' | 'no-id-token' | 'invalid-id-token' | 'foreign-tenant' | 'user-inactive' | 'mfa-missing';

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function hash(value: string | null | undefined): string | null {
  return value ? createHash('sha256').update(value.toLowerCase()).digest('hex') : null;
}

export async function recordLoginFailure(reason: LoginFailureReason, input: { oid?: string | null; tid?: string | null; ip?: string | null } = {}): Promise<void> {
  try {
    await db.insert(loginAttempts).values({ reason, oidHash: hash(input.oid), tenantHash: hash(input.tid), ipHash: hash(input.ip) });
  } catch (error) {
    // Die Anmeldung scheitert ohnehin; ein Fehler hier darf die Antwort nicht verdecken
    console.error('Login attempt could not be recorded:', error instanceof Error ? error.message : String(error));
  }
}

export async function pruneLoginAttempts(now = Date.now()): Promise<number> {
  const rows = await db.delete(loginAttempts).where(lt(loginAttempts.at, new Date(now - RETENTION_MS))).returning({ id: loginAttempts.id });
  return rows.length;
}

/** Methoden in amr, die einen zweiten Faktor oder phishing-resistente Anmeldung belegen. */
const STRONG_AMR = new Set(['mfa', 'fido', 'rsa', 'hwk', 'swk', 'ngcmfa']);

/**
 * LOGIN_REQUIRE_MFA=true verlangt einen Nachweis im amr-Claim. Standard aus:
 * ob Entra amr im ID-Token liefert, haengt von der Registrierung ab; erst
 * pruefen (siehe production-hardening.md), dann einschalten.
 */
export function mfaSatisfied(amr: string[], required = process.env.LOGIN_REQUIRE_MFA === 'true'): boolean {
  if (!required) return true;
  return amr.some((m) => STRONG_AMR.has(m.toLowerCase()));
}
