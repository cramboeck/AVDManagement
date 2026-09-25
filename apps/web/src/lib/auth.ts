/**
 * Auth-Utilities fuer Entra ID OAuth 2.0
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID ?? '';
const TENANT_ID = process.env.NEXT_PUBLIC_ENTRA_TENANT_ID ?? 'common';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const REDIRECT_URI = typeof window !== 'undefined'
  ? `${window.location.origin}/auth/callback`
  : '';

const AUTH_ENDPOINT = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`;

const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'https://management.azure.com/user_impersonation',
].join(' ');

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export async function startLogin(): Promise<void> {
  if (!CLIENT_ID) {
    throw new Error('NEXT_PUBLIC_ENTRA_CLIENT_ID is not set. Check .env.local in the monorepo root.');
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  sessionStorage.setItem('auth_code_verifier', codeVerifier);
  sessionStorage.setItem('auth_state', state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  window.location.href = `${AUTH_ENDPOINT}?${params}`;
}

export async function handleCallback(code: string, state: string): Promise<boolean> {
  const savedState = sessionStorage.getItem('auth_state');
  const codeVerifier = sessionStorage.getItem('auth_code_verifier');

  if (state !== savedState || !codeVerifier) {
    console.error('Invalid state or missing code verifier');
    return false;
  }

  sessionStorage.removeItem('auth_state');
  sessionStorage.removeItem('auth_code_verifier');

  try {
    const response = await fetch(`${API_URL}/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Token exchange failed:', error);
      return false;
    }

    const tokens = await response.json();

    localStorage.setItem('access_token', tokens.access_token);
    if (tokens.refresh_token) {
      localStorage.setItem('refresh_token', tokens.refresh_token);
    }
    localStorage.setItem('token_expires_at', String(Date.now() + tokens.expires_in * 1000));

    return true;
  } catch (error) {
    console.error('Token exchange error:', error);
    return false;
  }
}

export function logout(): void {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('token_expires_at');
  window.location.href = '/';
}

export function isAuthenticated(): boolean {
  const token = localStorage.getItem('access_token');
  const expiresAt = localStorage.getItem('token_expires_at');

  if (!token || !expiresAt) return false;

  return Date.now() < parseInt(expiresAt, 10);
}

export function getAccessToken(): string | null {
  if (!isAuthenticated()) return null;
  return localStorage.getItem('access_token');
}
