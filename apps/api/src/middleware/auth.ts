/**
 * Auth-Middleware
 *
 * Reihenfolge: Dev-Bypass, Cookie-Sitzung (Browser), Bearer-Token von Entra
 * (MCP-Clients und andere API-Nutzer). Cookie-Sitzungen brauchen bei
 * schreibenden Anfragen den CSRF-Nachweis (Origin und X-Requested-With).
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { getCookie } from 'hono/cookie';
import * as jose from 'jose';
import type { SessionUser, UserRole, MspId } from '@zerostress/types';
import { csrfViolation, CSRF_HEADER } from './csrf.js';
import { findOrCreateUser, loadUser, UserInactiveError } from '../services/users.js';
import { resolveSession } from '../services/sessions.js';
import { SESSION_COOKIE } from '../services/session-cookie.js';

// JWKS fuer Token-Validierung
let jwks: jose.JWTVerifyGetKey | null = null;

export async function getJwks(): Promise<jose.JWTVerifyGetKey> {
  if (!jwks) {
    const tenantId = process.env.ENTRA_TENANT_ID ?? 'common';
    jwks = jose.createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
  }
  return jwks;
}

export interface AuthContext {
  user: SessionUser;
  mspId: MspId;
  // Wie die Anfrage authentifiziert wurde; bearer traegt das Entra-Token weiter
  via: 'dev' | 'cookie' | 'bearer';
  accessToken: string;
  sessionId: string | null;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

// Pseudo-Object-Id fuer den Dev-Bypass-Benutzer; kein echtes Entra-Objekt
const DEV_USER_OBJECT_ID = 'dev-auth-bypass';

export const authMiddleware = createMiddleware(async (c, next) => {
  // Dev-Bypass: echter DB-Benutzer in der Default-MSP, damit Fremdschluessel
  // (jobs.created_by, audit_entries.user_id) gueltig sind
  if (process.env.DEV_AUTH_BYPASS === 'true') {
    const user = await findOrCreateUser(DEV_USER_OBJECT_ID, 'dev@localhost', 'Dev User', 'owner');
    c.set('auth', { user, mspId: user.mspId, via: 'dev', accessToken: 'dev-token', sessionId: null });
    await next();
    return;
  }

  // 1) Browser-Sitzung per Cookie
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) {
    const session = await resolveSession(cookie);
    if (!session) throw new HTTPException(401, { message: 'Sitzung abgelaufen oder beendet' });
    const violation = csrfViolation({ method: c.req.method, origin: c.req.header('Origin'), requestedWith: c.req.header(CSRF_HEADER) });
    if (violation) throw new HTTPException(403, { message: `Anfrage abgelehnt: ${violation}` });
    const user = await loadUser(session.userId);
    if (!user) throw new HTTPException(401, { message: 'Das Konto ist deaktiviert' });
    c.set('auth', { user, mspId: user.mspId, via: 'cookie', accessToken: '', sessionId: session.id });
    await next();
    return;
  }

  // 2) Bearer-Token von Entra (MCP, Skripte, andere Clients)
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  const token = authHeader.slice(7);

  try {
    const audiences = Array.from(new Set([process.env.ENTRA_CLIENT_ID!, process.env.ENTRA_LOGIN_CLIENT_ID ?? '', 'https://management.azure.com'].filter(Boolean)));
    const claims = await verifyEntraToken(token, audiences);
    const user = await findOrCreateUser(claims.oid, claims.email, claims.name);
    c.set('auth', { user, mspId: user.mspId, via: 'bearer', accessToken: token, sessionId: null });
    await next();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (error instanceof UserInactiveError) throw new HTTPException(401, { message: error.message });
    console.error('Auth error:', error instanceof Error ? error.message : String(error));
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }
});

export interface EntraClaims {
  oid: string;
  tid: string | null;
  email: string;
  name: string;
}

/**
 * Entra-Token (Access- oder ID-Token) gegen JWKS, Aussteller und Zielgruppe
 * pruefen. Aussteller ist immer der Partnertenant; fremde Tenants kommen
 * damit nicht durch.
 */
export async function verifyEntraToken(token: string, audience: string[]): Promise<EntraClaims> {
  const jwksClient = await getJwks();
  const { payload } = await jose.jwtVerify(token, jwksClient, {
    issuer: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0`,
    audience,
  });
  const oid = typeof payload.oid === 'string' ? payload.oid : '';
  const email = (payload.preferred_username ?? payload.email ?? payload.upn) as string | undefined;
  if (!oid || !email) throw new HTTPException(401, { message: 'Invalid token claims' });
  return { oid, tid: typeof payload.tid === 'string' ? payload.tid : null, email, name: typeof payload.name === 'string' ? payload.name : email };
}

// Rollen-Pruefung
export function requireRole(requiredRole: UserRole) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth');

    const roleHierarchy: Record<UserRole, number> = {
      owner: 3,
      engineer: 2,
      readonly: 1,
    };

    if (roleHierarchy[auth.user.role] < roleHierarchy[requiredRole]) {
      throw new HTTPException(403, {
        message: `Role '${requiredRole}' required`,
      });
    }

    await next();
  });
}
