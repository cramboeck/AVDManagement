/**
 * Auth-Routen: Login-Abschluss mit Cookie-Sitzung, Abmelden, Sitzungsinfo,
 * Admin-Consent-Rueckruf
 *
 * Der Browser tauscht den Authorization Code hier ein. Die API prueft das
 * ID-Token, legt den Benutzer an oder findet ihn, erzeugt eine
 * serverseitige Sitzung und setzt das httpOnly-Cookie. Entra-Tokens
 * verlassen die API nicht und werden nicht gespeichert.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { verifyEntraToken } from '../middleware/auth.js';
import { clientIp } from '../middleware/security.js';
import { db, managedTenants } from '../db/index.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import { verifyConsentState, type ConsentStateClaims } from '../services/consent-state.js';
import { testTenantConnection, persistConnectionTestResult } from '../services/tenant-connection.js';
import { getTokenProvider } from '../services/microsoft-clients.js';
import { findOrCreateUser, loadUser, UserInactiveError } from '../services/users.js';
import { createSession, resolveSession, revokeSession } from '../services/sessions.js';
import { cookieOptions, SESSION_COOKIE, sessionPolicy } from '../services/session-cookie.js';
import type { CorrelationId, MspId, UserId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

// ENV-Variablen werden zur Laufzeit gelesen, nicht beim Import
function getAuthConfig() {
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  const tenantId = process.env.ENTRA_TENANT_ID;

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET and ENTRA_TENANT_ID must be set');
  }

  return {
    clientId,
    clientSecret,
    tenantId,
    tokenEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  };
}

function problem(status: 400 | 401 | 500, title: string, detail?: string) {
  return { type: `https://api.zerostress.io/problems/${status === 401 ? 'unauthorized' : status === 400 ? 'validation' : 'internal'}`, title, detail, status };
}

const tokenSchema = z.object({
  code: z.string().min(1).max(4000),
  redirect_uri: z.string().url(),
  code_verifier: z.string().min(43).max(128),
});

app.post('/token', validate('json', tokenSchema), async (c) => {
  const { code, redirect_uri, code_verifier } = c.req.valid('json');
  const config = getAuthConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri,
    code_verifier,
    scope: 'openid profile email User.Read',
  });

  let data: { id_token?: string; error?: string; error_description?: string };
  try {
    const response = await fetch(config.tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    data = (await response.json()) as typeof data;
    if (!response.ok) {
      console.error('Token exchange failed:', data.error ?? 'unknown');
      return c.json(problem(400, 'Anmeldung fehlgeschlagen', data.error_description || data.error || 'Token exchange failed'), 400);
    }
  } catch (error) {
    console.error('Token exchange error:', error instanceof Error ? error.message : String(error));
    return c.json(problem(500, 'Anmeldung fehlgeschlagen', 'Der Token-Endpunkt war nicht erreichbar'), 500);
  }

  if (!data.id_token) return c.json(problem(400, 'Anmeldung fehlgeschlagen', 'Kein ID-Token erhalten'), 400);

  try {
    const claims = await verifyEntraToken(data.id_token, [config.clientId]);
    if (claims.tid && claims.tid.toLowerCase() !== config.tenantId.toLowerCase()) {
      return c.json(problem(401, 'Anmeldung abgelehnt', 'Das Konto gehoert nicht zum Partnertenant'), 401);
    }
    const user = await findOrCreateUser(claims.oid, claims.email, claims.name);
    const { token } = await createSession({ userId: user.id, mspId: user.mspId, ip: clientIp(c), userAgent: c.req.header('User-Agent') });
    setCookie(c, SESSION_COOKIE, token, cookieOptions(sessionPolicy()));
    await audit.log({
      mspId: user.mspId,
      tenantId: null,
      userId: user.id,
      action: 'auth.login',
      targetType: 'msp-user',
      targetId: user.id,
      targetDisplayName: user.email,
      afterState: { role: user.role },
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
    return c.json({ authenticated: true, user });
  } catch (error) {
    if (error instanceof UserInactiveError) return c.json(problem(401, 'Anmeldung abgelehnt', error.message), 401);
    console.error('Login failed:', error instanceof Error ? error.message : String(error));
    return c.json(problem(401, 'Anmeldung abgelehnt', 'Das ID-Token konnte nicht geprueft werden'), 401);
  }
});

// Sitzungsinfo fuer die Oberflaeche; ohne gueltiges Cookie authenticated=false statt 401
app.get('/me', async (c) => {
  if (process.env.DEV_AUTH_BYPASS === 'true') {
    const user = await findOrCreateUser('dev-auth-bypass', 'dev@localhost', 'Dev User', 'owner');
    return c.json({ authenticated: true, user, via: 'dev' });
  }
  const session = await resolveSession(getCookie(c, SESSION_COOKIE));
  if (!session) return c.json({ authenticated: false });
  const user = await loadUser(session.userId);
  if (!user) return c.json({ authenticated: false });
  return c.json({ authenticated: true, user, via: 'cookie', expiresAt: session.expiresAt.toISOString(), idleExpiresAt: session.idleExpiresAt.toISOString() });
});

app.post('/logout', async (c) => {
  const cookie = getCookie(c, SESSION_COOKIE);
  const session = await resolveSession(cookie);
  await revokeSession(cookie);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  if (session) {
    await audit.log({
      mspId: session.mspId as MspId,
      tenantId: null,
      userId: session.userId as UserId,
      action: 'auth.logout',
      targetType: 'msp-user',
      targetId: session.userId,
      targetDisplayName: 'Sitzung',
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
  }
  return c.json({ authenticated: false });
});

// Rueckruf nach Admin-Consent. Kommt als Browser-Redirect von Microsoft,
// daher ohne Auth-Middleware; der signierte State ersetzt die Session.
app.get('/consent-callback', async (c) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3002';
  const redirectToTenants = (params: Record<string, string>) =>
    c.redirect(`${appUrl}/tenants?${new URLSearchParams(params)}`);

  const state = c.req.query('state');
  if (!state) {
    return redirectToTenants({ consent: 'error', reason: 'missing-state' });
  }

  let claims: ConsentStateClaims;
  try {
    claims = await verifyConsentState(state);
  } catch {
    return redirectToTenants({ consent: 'error', reason: 'invalid-state' });
  }

  const tenant = await db.query.managedTenants.findFirst({
    where: and(eq(managedTenants.id, claims.tenantId), eq(managedTenants.mspId, claims.mspId)),
  });
  if (!tenant) {
    return redirectToTenants({ consent: 'error', reason: 'tenant-not-found' });
  }

  const correlationId = randomUUID() as CorrelationId;
  const auditBase = {
    mspId: claims.mspId,
    tenantId: claims.tenantId,
    userId: claims.userId,
    action: 'tenant.consent',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    beforeState: { connectionStatus: tenant.connectionStatus },
    correlationId,
  };

  const errorParam = c.req.query('error');
  if (errorParam) {
    await audit.log({
      ...auditBase,
      result: 'failure',
      errorMessage: `${errorParam}: ${c.req.query('error_description') ?? ''}`.trim(),
    });
    return redirectToTenants({ consent: 'error', reason: errorParam, tenantId: tenant.id });
  }

  const consentedTenant = c.req.query('tenant');
  if (consentedTenant && consentedTenant.toLowerCase() !== tenant.microsoftTenantId.toLowerCase()) {
    await audit.log({
      ...auditBase,
      result: 'failure',
      errorMessage: 'Consent was granted in a different tenant than registered',
    });
    return redirectToTenants({ consent: 'error', reason: 'tenant-mismatch', tenantId: tenant.id });
  }

  // Neue Berechtigungen gelten erst mit einem frischen Token
  getTokenProvider().invalidateTokens(tenant.microsoftTenantId);
  const result = await testTenantConnection(tenant.microsoftTenantId);
  await persistConnectionTestResult(tenant.id, result);

  await audit.log({
    ...auditBase,
    afterState: { connectionStatus: result.status, missingScopes: result.missingScopes },
    result: result.status === 'connected' ? 'success' : 'failure',
    errorMessage: result.detail ?? undefined,
  });

  return redirectToTenants({
    consent: result.status === 'connected' ? 'success' : 'incomplete',
    status: result.status,
    tenantId: tenant.id,
  });
});

export { app as authRouter };
