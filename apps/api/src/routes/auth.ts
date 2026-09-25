/**
 * Auth-Routen fuer OAuth Token Exchange
 */

import { Hono } from 'hono';

const app = new Hono();

const CLIENT_ID = process.env.ENTRA_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET ?? '';
const TENANT_ID = process.env.ENTRA_TENANT_ID ?? 'common';
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

app.post('/token', async (c) => {
  const body = await c.req.json();
  const { code, redirect_uri, code_verifier } = body;

  if (!code || !redirect_uri) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri,
    code_verifier: code_verifier ?? '',
    scope: 'openid profile email offline_access User.Read https://management.azure.com/user_impersonation',
  });

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
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

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token,
    scope: 'openid profile email offline_access User.Read https://management.azure.com/user_impersonation',
  });

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
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
