/**
 * Tests: MFA-Nachweis im amr-Claim und Fehlversuche ohne Klartextdaten
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserted: Array<Record<string, unknown>> = [];

vi.mock('../src/db/index.js', () => ({
  loginAttempts: { at: 'at', id: 'id' },
  db: {
    insert: () => ({ values: async (v: Record<string, unknown>) => void inserted.push(v) }),
    delete: () => ({ where: () => ({ returning: async () => [{ id: '1' }] }) }),
  },
}));

const { mfaSatisfied, recordLoginFailure } = await import('../src/services/login-attempts.js');

describe('mfaSatisfied', () => {
  it('accepts everything while LOGIN_REQUIRE_MFA is off', () => {
    expect(mfaSatisfied(['pwd'], false)).toBe(true);
  });

  it('requires a second factor or passkey when switched on', () => {
    expect(mfaSatisfied(['pwd'], true)).toBe(false);
    expect(mfaSatisfied([], true)).toBe(false);
    expect(mfaSatisfied(['pwd', 'mfa'], true)).toBe(true);
    expect(mfaSatisfied(['fido'], true)).toBe(true);
    // Windows-integrierte Anmeldung allein ist kein zweiter Faktor
    expect(mfaSatisfied(['wia'], true)).toBe(false);
  });
});

describe('recordLoginFailure', () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it('stores only hashes of object id, tenant and IP', async () => {
    await recordLoginFailure('foreign-tenant', { oid: '00000000-aaaa-bbbb-cccc-000000000001', tid: 'other-tenant', ip: '203.0.113.7' });
    const row = inserted[0];
    expect(row.reason).toBe('foreign-tenant');
    expect(String(row.oidHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
    expect(JSON.stringify(row)).not.toContain('00000000-aaaa');
  });
});
