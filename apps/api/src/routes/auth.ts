/**
 * Auth-Routen: OAuth Token Exchange und Admin-Consent-Rueckruf
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db, managedTenants } from '../db/index.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import { verifyConsentState, type ConsentStateClaims } from '../services/consent-state.js';
import { testTenantConnection, persistConnectionTestResult } from '../services/tenant-connection.js';
import { getTokenProvider } from '../services/microsoft-clients.js';
import type { CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

// ENV-Variablen werden zur Laufzeit gelesen, nicht beim Import
function getAuthConfig() {
  const clientId = process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.ENTRA_CLIENT_SECRET;
  const tenantId = process.env.ENTRA_TENANT_ID ?? 'common';

  if (!clientId || !clientSecret) {
    throw new Error('ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET must be set');
  }

  return {
    clientId,
    clientSecret,
    tenantId,
    tokenEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  };
}

app.post('/token', async (c) => {
  const body = await c.req.json();
  const { code, redirect_uri, code_verifier } = body;

  if (!code || !redirect_uri) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  const config = getAuthConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri,
    code_verifier: code_verifier ?? '',
    scope: 'openid profile email offline_access User.Read',
  });

  try {
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Token exchange failed:', data);
      return c.json({ error: data.error_description || data.error || 'Token exchange failed' }, 400);
    }

    return c.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
    });
  } catch (error) {
    console.error('Token exchange error:', error);
    return c.json({ error: 'Token exchange failed' }, 500);
  }
});

app.post('/refresh', async (c) => {
  const body = await c.req.json();
  const { refresh_token } = body;

  if (!refresh_token) {
    return c.json({ error: 'Missing refresh token' }, 400);
  }

  const config = getAuthConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token,
    scope: 'openid profile email offline_access User.Read',
  });

  try {
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Token refresh failed:', data);
      return c.json({ error: data.error_description || data.error || 'Token refresh failed' }, 400);
    }

    return c.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return c.json({ error: 'Token refresh failed' }, 500);
  }
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
