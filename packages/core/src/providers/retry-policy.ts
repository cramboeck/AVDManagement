/**
 * Wiederholungsregeln fuer Graph und ARM.
 *
 * Throttling (429) ist Normalbetrieb und wird immer mit Retry-After
 * wiederholt. Serverfehler und Zeitueberschreitungen werden nur bei
 * idempotenten Aufrufen wiederholt: ein POST kann bei Microsoft bereits
 * ausgefuehrt sein, auch wenn die Antwort fehlt (doppelte Objekte, doppelt
 * laufende Skripte). Lesende POSTs ($batch mit GETs, Berichte) markieren
 * sich ueber `idempotent: true`.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

// Obergrenze fuer eine einzelne Wartezeit, auch wenn Retry-After mehr verlangt
export const MAX_RETRY_WAIT_MS = 120_000;

export function isIdempotent(method: HttpMethod, idempotent?: boolean): boolean {
  if (idempotent !== undefined) return idempotent;
  return method !== 'POST';
}

/** Darf nach dieser HTTP-Antwort erneut gesendet werden? */
export function shouldRetryStatus(status: number, method: HttpMethod, idempotent?: boolean): boolean {
  if (status === 429) return true;
  if (status >= 500) return isIdempotent(method, idempotent);
  return false;
}

/** Darf nach Zeitueberschreitung oder Netzfehler erneut gesendet werden? */
export function shouldRetryTransport(method: HttpMethod, idempotent?: boolean): boolean {
  return isIdempotent(method, idempotent);
}

/** Wartezeit in ms: Retry-After hat Vorrang, sonst exponentiell; gedeckelt und leicht gestreut. */
export function backoffMs(attempt: number, retryAfterSeconds?: number, random: () => number = Math.random): number {
  const base = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : Math.min(1000 * 2 ** attempt, 60_000);
  const capped = Math.min(base, MAX_RETRY_WAIT_MS);
  // Bis zu 20 % Streuung nach oben, damit parallele Aufrufe nicht gleichzeitig wiederkommen
  return Math.min(Math.round(capped * (1 + random() * 0.2)), MAX_RETRY_WAIT_MS);
}

export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = parseInt(header, 10);
  if (!Number.isNaN(seconds) && /^\s*\d+\s*$/.test(header)) return Math.max(0, seconds);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - now) / 1000));
  return undefined;
}

/**
 * Lesende POSTs in Graph erkennen: Intune-Berichte (reports/get..., retrieve...)
 * und $batch, wenn alle Teilanfragen GETs sind.
 */
export function isReadOnlyGraphPost(url: string, body: unknown): boolean {
  const path = url.split('?')[0];
  if (/\/reports\/(get|retrieve)[A-Za-z]+$/.test(path)) return true;
  if (/\/\$batch$/.test(path)) {
    const requests = (body as { requests?: Array<{ method?: string }> } | null)?.requests;
    return Array.isArray(requests) && requests.length > 0 && requests.every((r) => (r.method ?? 'GET').toUpperCase() === 'GET');
  }
  return false;
}
