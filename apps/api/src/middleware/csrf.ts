/**
 * Erlaubte Browser-Origins und CSRF-Regel fuer Cookie-Sitzungen
 *
 * Cookie-Sitzungen sind gegen Cross-Site-Anfragen doppelt geschuetzt:
 * SameSite=Lax auf dem Cookie und hier die Pruefung, dass schreibende
 * Anfragen von einem erlaubten Origin kommen und den Header
 * X-Requested-With tragen. Den Header kann eine fremde Seite nur mit
 * CORS-Preflight setzen, und den bekommt sie nicht.
 */

export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'ZeroStress';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function allowedOrigins(): string[] {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3002';
  return Array.from(new Set([configured, 'http://localhost:3000', 'http://localhost:3002']));
}

export function isUnsafeMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Cross-Site-Schutz fuer eine Anfrage mit Cookie-Sitzung. Liefert null, wenn
 * die Anfrage in Ordnung ist, sonst den Grund fuer die Ablehnung.
 */
export function csrfViolation(input: { method: string; origin: string | undefined; requestedWith: string | undefined }): string | null {
  if (!isUnsafeMethod(input.method)) return null;
  if (input.requestedWith !== CSRF_HEADER_VALUE) return `Header ${CSRF_HEADER} fehlt`;
  // Ohne Origin (z. B. Nicht-Browser-Client mit Cookie) ist der Header-Nachweis ausreichend
  if (input.origin && !allowedOrigins().includes(input.origin)) return `Origin ${input.origin} ist nicht erlaubt`;
  return null;
}
