/**
 * Auth-Utilities fuer Entra ID OAuth 2.0 (Authorization Code mit PKCE)
 *
 * Der Browser holt nur den Authorization Code; den Tausch gegen Tokens
 * macht die API und setzt ein httpOnly-Sitzungscookie. Im Browser liegen
 * keine Tokens, nur Verifier und State fuer die Dauer des Logins.
 */

import type { SessionUser } from '@zerostress/types';

const CLIENT_ID = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID ?? '';
const TENANT_ID = process.env.NEXT_PUBLIC_ENTRA_TENANT_ID ?? 'common';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const DEV_AUTH_BYPASS = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true';
const REDIRECT_URI = typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : '';

const AUTH_ENDPOINT = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`;

const SCOPES = ['openid', 'profile', 'email', 'User.Read'].join(' ');

export interface SessionInfo {
  authenticated: boolean;
  user?: SessionUser;
  via?: 'dev' | 'cookie';
  expiresAt?: string;
  idleExpiresAt?: string;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64Url(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
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

export async function handleCallback(code: string, state: string): Promise<{ ok: boolean; message?: string }> {
  const savedState = sessionStorage.getItem('auth_state');
  const codeVerifier = sessionStorage.getItem('auth_code_verifier');

  if (state !== savedState || !codeVerifier) {
    // sessionStorage gilt je Origin: Login auf localhost, Rueckkehr auf 127.0.0.1 oder
    // die LAN-IP findet den Verifier nicht. Oder die Callback-Seite wurde neu geladen.
    console.error(`Login callback rejected: state ${savedState ? (state === savedState ? 'matches' : 'differs') : 'missing'}, verifier ${codeVerifier ? 'present' : 'missing'} for origin ${window.location.origin}`);
    return { ok: false, message: 'Die Anmeldung wurde auf einer anderen Adresse gestartet oder die Seite neu geladen. Bitte erneut anmelden.' };
  }

  sessionStorage.removeItem('auth_state');
  sessionStorage.removeItem('auth_code_verifier');

  try {
    const response = await fetch(`${API_URL}/auth/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ZeroStress' },
      body: JSON.stringify({ code, redirect_uri: REDIRECT_URI, code_verifier: codeVerifier }),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as { title?: string; detail?: string };
      console.error('Login failed:', problem.title ?? response.status);
      return { ok: false, message: problem.detail || problem.title || `Anmeldung fehlgeschlagen (HTTP ${response.status})` };
    }
    return { ok: true };
  } catch (error) {
    console.error('Login error:', error instanceof Error ? error.message : String(error));
    return { ok: false, message: 'Die API ist nicht erreichbar.' };
  }
}

/** Sitzungsstand von der API; bei Bypass immer angemeldet. */
export async function fetchSession(): Promise<SessionInfo> {
  if (DEV_AUTH_BYPASS) return { authenticated: true, via: 'dev' };
  try {
    const response = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
    if (!response.ok) return { authenticated: false };
    return (await response.json()) as SessionInfo;
  } catch {
    return { authenticated: false };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'ZeroStress' } });
  } catch {
    // Cookie ist dann ggf. noch da; die naechste Anfrage raeumt es auf
  }
  window.location.href = '/login';
}
