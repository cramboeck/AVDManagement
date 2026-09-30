/**
 * Sitzungscookie: Name, Attribute und Laufzeiten
 *
 * Reine Funktionen ohne Datenbank, damit sie sich testen lassen. Das
 * Cookie ist httpOnly (kein Zugriff aus Skripten), SameSite=Lax (Web und
 * API muessen same-site laufen, siehe Setup-Doku) und in Produktion Secure.
 */

export const SESSION_COOKIE = 'zsc_session';

export interface SessionPolicy {
  absoluteMs: number;
  idleMs: number;
  secure: boolean;
}

function hours(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function sessionPolicy(env: NodeJS.ProcessEnv = process.env): SessionPolicy {
  const secureDefault = env.NODE_ENV === 'production';
  return {
    absoluteMs: hours(env.SESSION_TTL_HOURS, 12, 1, 24 * 14) * 60 * 60 * 1000,
    idleMs: hours(env.SESSION_IDLE_MINUTES, 120, 5, 24 * 60) * 60 * 1000,
    secure: env.SESSION_COOKIE_SECURE ? env.SESSION_COOKIE_SECURE === 'true' : secureDefault,
  };
}

export function cookieOptions(policy: SessionPolicy): { path: string; httpOnly: boolean; secure: boolean; sameSite: 'Lax'; maxAge: number } {
  return { path: '/', httpOnly: true, secure: policy.secure, sameSite: 'Lax', maxAge: Math.floor(policy.absoluteMs / 1000) };
}
