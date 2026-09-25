/**
 * Auth-Routen fuer OAuth Token Exchange
 */

import { Hono } from 'hono';

const app = new Hono();

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

export { app as authRouter };
