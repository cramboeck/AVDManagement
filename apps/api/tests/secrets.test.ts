/**
 * Tests fuer Secret-Namen und die client_assertion mit Zertifikat
 */

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { jwtVerify, decodeProtectedHeader } from 'jose';
import { buildClientAssertion, vaultSecretName } from '../src/services/secrets.js';

describe('secrets', () => {
  it('maps environment names to Key Vault names', () => {
    expect(vaultSecretName('ENTRA_CLIENT_SECRET')).toBe('ENTRA-CLIENT-SECRET');
    expect(vaultSecretName('JWT_SECRET')).toBe('JWT-SECRET');
  });

  it('builds a client assertion signed with the certificate key and x5t header', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const thumbprintSha1 = createHash('sha1').update('fake-cert-der').digest('hex');
    const endpoint = 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token';
    const assertion = await buildClientAssertion('client-id', endpoint, { privateKey, thumbprintSha1 }, new Date('2026-09-30T10:00:00Z'));
    const header = decodeProtectedHeader(assertion);
    expect(header.alg).toBe('RS256');
    expect(header.x5t).toBe(Buffer.from(thumbprintSha1, 'hex').toString('base64url'));
    const { payload } = await jwtVerify(assertion, publicKey, { issuer: 'client-id', audience: endpoint, subject: 'client-id', currentDate: new Date('2026-09-30T10:05:00Z') });
    expect(payload.exp).toBe(Math.floor(new Date('2026-09-30T10:10:00Z').getTime() / 1000));
    expect(typeof payload.jti).toBe('string');
  });
});
