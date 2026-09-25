/**
 * Versiegelung personenbezogener Job-Ergebnisse
 *
 * AES-256-GCM mit einem Schluessel aus RESULT_ENCRYPTION_KEY (32 Bytes,
 * Base64). Lokal aus der .env.local, in Produktion aus dem Key Vault ueber
 * die Umgebung des Prozesses. Der Schluessel liegt nie in DB oder Log; die
 * keyId erlaubt spaeter eine Rotation.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { ResultSealer } from '@zerostress/core';
import type { RevealedScriptResult, SealedCipher } from '@zerostress/types';

let cached: { key: Buffer; keyId: string } | null | undefined;

function loadKey(): { key: Buffer; keyId: string } | null {
  if (cached !== undefined) return cached;
  const raw = process.env.RESULT_ENCRYPTION_KEY;
  if (!raw) {
    cached = null;
    return cached;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('RESULT_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)');
  }
  cached = { key, keyId: createHash('sha256').update(key).digest('hex').slice(0, 12) };
  return cached;
}

export function isResultSealingConfigured(): boolean {
  return loadKey() !== null;
}

export function getResultSealer(): ResultSealer | null {
  const material = loadKey();
  if (!material) return null;
  return {
    async seal(payload: RevealedScriptResult): Promise<SealedCipher> {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', material.key, iv);
      const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
      const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { alg: 'aes-256-gcm', keyId: material.keyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    },
  };
}

export function unsealResult(cipher: SealedCipher): RevealedScriptResult {
  const material = loadKey();
  if (!material) {
    throw new Error('RESULT_ENCRYPTION_KEY is not configured');
  }
  if (cipher.keyId !== material.keyId) {
    throw new Error('Result was sealed with a different key');
  }
  const decipher = createDecipheriv('aes-256-gcm', material.key, Buffer.from(cipher.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(cipher.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(cipher.data, 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as RevealedScriptResult;
}

// Nur fuer Tests: Schluessel neu einlesen
export function resetResultKeyCache(): void {
  cached = undefined;
}
