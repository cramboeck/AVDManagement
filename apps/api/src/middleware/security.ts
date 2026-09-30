/**
 * Rate-Limits, Client-IP und Groessenbegrenzung
 *
 * Feste Zeitfenster je Schluessel im Speicher: reicht fuer eine Instanz und
 * schuetzt gegen Durchprobieren, Endlosschleifen eines Clients und das
 * Leerziehen der Graph-Kontingente eines Tenants. Fuer mehrere Instanzen
 * muss der Zaehler nach Redis (siehe Backlog); das Interface bleibt gleich.
 *
 * Schluessel: Bearer-Token (Hash) wenn vorhanden, sonst Client-IP. Die IP
 * kommt nur bei TRUST_PROXY=true aus X-Forwarded-For, sonst vom Socket.
 */

import { createHash } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';

export const MB = 1024 * 1024;

export function clientIp(c: Context): string {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = c.req.header('X-Forwarded-For');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Schluessel fuer ein Limit: Token-Hash (nie der Klartext) oder IP. */
export function rateKey(c: Context): string {
  const header = c.req.header('Authorization') ?? '';
  if (header.startsWith('Bearer ') && header.length > 7 + 16) {
    return `t:${createHash('sha256').update(header.slice(7)).digest('hex').slice(0, 24)}`;
  }
  return `ip:${clientIp(c)}`;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  name: string;
  limit: number;
  windowMs: number;
  key?: (c: Context) => string;
}

export interface RateLimiter {
  middleware: MiddlewareHandler;
  /** Nur fuer Tests und Diagnose: aktuelle Zaehler leeren. */
  reset: () => void;
}

const CLEANUP_EVERY = 5000;

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const buckets = new Map<string, Bucket>();
  const keyOf = options.key ?? rateKey;
  let calls = 0;

  const cleanup = (now: number) => {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  };

  const middleware = createMiddleware(async (c, next) => {
    if (process.env.RATE_LIMIT_DISABLED === 'true') {
      await next();
      return undefined;
    }
    const now = Date.now();
    if (++calls % CLEANUP_EVERY === 0) cleanup(now);
    const key = `${options.name}|${keyOf(c)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, options.limit - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    c.header('RateLimit-Limit', String(options.limit));
    c.header('RateLimit-Remaining', String(remaining));
    c.header('RateLimit-Reset', String(resetSeconds));
    if (bucket.count > options.limit) {
      c.header('Retry-After', String(resetSeconds));
      return c.json(
        {
          type: 'https://api.zerostress.io/problems/rate-limited',
          title: 'Zu viele Anfragen',
          detail: `Hoechstens ${options.limit} Anfragen je ${Math.round(options.windowMs / 1000)} Sekunden; in ${resetSeconds} s wieder frei.`,
          status: 429,
        },
        429
      );
    }
    await next();
    return undefined;
  });

  return { middleware, reset: () => buckets.clear() };
}

// Pfade mit Dateiupload: hier gilt das grosse Limit, sonst 1 MB fuer JSON
const UPLOAD_PATHS = [/^\/packages\/[^/]+\/(artifact|installer)$/, /^\/worker\/builds\/[^/]+\/artifact$/];

export const UPLOAD_LIMIT_BYTES = 4096 * MB;
export const JSON_LIMIT_BYTES = 1 * MB;

const jsonLimit = bodyLimit({ maxSize: JSON_LIMIT_BYTES, onError: (c) => tooLarge(c, JSON_LIMIT_BYTES) });
const uploadLimit = bodyLimit({ maxSize: UPLOAD_LIMIT_BYTES, onError: (c) => tooLarge(c, UPLOAD_LIMIT_BYTES) });

function tooLarge(c: Context, max: number) {
  return c.json(
    { type: 'https://api.zerostress.io/problems/payload-too-large', title: 'Anfrage zu gross', detail: `Hoechstens ${Math.round(max / MB)} MB`, status: 413 },
    413
  );
}

/** Groessenbegrenzung je nach Pfad: Uploads gross, alles andere klein. */
export const bodyLimits = createMiddleware(async (c, next) => {
  const path = c.req.path;
  const handler = c.req.method === 'PUT' && UPLOAD_PATHS.some((re) => re.test(path)) ? uploadLimit : jsonLimit;
  return handler(c, next);
});
