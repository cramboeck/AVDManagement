/**
 * Tests fuer Cookie-Regeln und CSRF-Schutz der Browser-Sitzung
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cookieOptions, sessionPolicy } from '../src/services/session-cookie.js';
import { csrfViolation, allowedOrigins } from '../src/middleware/csrf.js';

const savedAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl;
});

describe('sessionPolicy', () => {
  it('uses defaults and rejects values out of range', () => {
    const p = sessionPolicy({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(p.absoluteMs).toBe(12 * 60 * 60 * 1000);
    expect(p.idleMs).toBe(120 * 60 * 1000);
    expect(p.secure).toBe(false);
    const q = sessionPolicy({ NODE_ENV: 'production', SESSION_TTL_HOURS: '9999', SESSION_IDLE_MINUTES: '1' } as NodeJS.ProcessEnv);
    expect(q.absoluteMs).toBe(12 * 60 * 60 * 1000);
    expect(q.idleMs).toBe(120 * 60 * 1000);
    expect(q.secure).toBe(true);
  });

  it('builds httpOnly, Lax cookies with the absolute lifetime', () => {
    const o = cookieOptions(sessionPolicy({ NODE_ENV: 'production' } as NodeJS.ProcessEnv));
    expect(o).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: true, path: '/' });
    expect(o.maxAge).toBe(12 * 60 * 60);
  });
});

describe('csrfViolation', () => {
  it('lets safe methods through without header', () => {
    expect(csrfViolation({ method: 'GET', origin: 'https://evil.example', requestedWith: undefined })).toBeNull();
  });

  it('requires the header and an allowed origin for writes', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://cockpit.example.com';
    expect(allowedOrigins()).toContain('https://cockpit.example.com');
    expect(csrfViolation({ method: 'POST', origin: 'https://cockpit.example.com', requestedWith: undefined })).toContain('X-Requested-With');
    expect(csrfViolation({ method: 'POST', origin: 'https://evil.example', requestedWith: 'ZeroStress' })).toContain('nicht erlaubt');
    expect(csrfViolation({ method: 'POST', origin: 'https://cockpit.example.com', requestedWith: 'ZeroStress' })).toBeNull();
    expect(csrfViolation({ method: 'DELETE', origin: undefined, requestedWith: 'ZeroStress' })).toBeNull();
  });
});
