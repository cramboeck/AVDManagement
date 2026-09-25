/**
 * Roundtrip und Fehlerpfade der Ergebnisversiegelung
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { getResultSealer, isResultSealingConfigured, resetResultKeyCache, unsealResult } from '../src/services/result-crypto.js';

describe('result crypto', () => {
  beforeEach(() => {
    resetResultKeyCache();
  });

  it('is off without a key', () => {
    delete process.env.RESULT_ENCRYPTION_KEY;
    expect(isResultSealingConfigured()).toBe(false);
    expect(getResultSealer()).toBeNull();
  });

  it('rejects a key of the wrong length', () => {
    process.env.RESULT_ENCRYPTION_KEY = Buffer.from('short').toString('base64');
    expect(() => getResultSealer()).toThrow(/32 bytes/);
  });

  it('seals and unseals, and refuses tampering or a foreign key', async () => {
    process.env.RESULT_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const sealer = getResultSealer();
    expect(sealer).not.toBeNull();
    const payload = { output: '{"members":[{"name":"max"}]}', outputJson: { members: [{ name: 'max' }] }, detectionError: null, remediationError: null };
    const cipher = await sealer!.seal(payload);
    expect(cipher.data).not.toContain('max');
    expect(unsealResult(cipher)).toEqual(payload);

    expect(() => unsealResult({ ...cipher, data: Buffer.from('xx').toString('base64') })).toThrow();

    resetResultKeyCache();
    process.env.RESULT_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(() => unsealResult(cipher)).toThrow(/different key/);
  });
});
