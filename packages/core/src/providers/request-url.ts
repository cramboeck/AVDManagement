/**
 * Ziel-URL fuer Graph-, Defender- und ARM-Aufrufe.
 *
 * Absolute URLs (nextLink, Async-Operation) sind nur auf dem Host der
 * Basisadresse erlaubt. Sonst koennte ein Wert von aussen (z. B. ein
 * pageToken aus dem Browser) das Bearer-Token eines Kundentenants an einen
 * fremden Server schicken.
 */

export class ForeignUrlError extends Error {
  constructor(readonly origin: string) {
    super(`Refusing to send a tenant token to ${origin}`);
    this.name = 'ForeignUrlError';
  }
}

/** Regionale Hosts der Defender-API (nextLink kann auf einen davon zeigen). */
export const DEFENDER_ORIGINS = /^https:\/\/api(-[a-z]{2,4})?\.(securitycenter|security)\.microsoft\.com$/;

export function resolveRequestUrl(baseUrl: string, path: string, extraOrigins?: RegExp): string {
  if (!/^https?:\/\//i.test(path)) return `${baseUrl}${path}`;
  let target: URL;
  try {
    target = new URL(path);
  } catch {
    throw new ForeignUrlError('invalid-url');
  }
  const allowed = new URL(baseUrl).origin;
  const trusted = target.origin === allowed || (extraOrigins !== undefined && target.protocol === 'https:' && extraOrigins.test(target.origin));
  if (!trusted || target.username || target.password) throw new ForeignUrlError(target.origin);
  return target.toString();
}
