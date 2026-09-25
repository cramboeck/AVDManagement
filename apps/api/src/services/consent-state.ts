/**
 * Signierter State fuer den Admin-Consent-Redirect
 *
 * Der State bindet den Rueckruf von Microsoft an Tenant, MSP und den
 * ausloesenden Benutzer (CSRF-Schutz + Aktor fuer das Audit-Log).
 */

import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { MspId, TenantId, UserId } from '@zerostress/types';

export interface ConsentStateClaims {
  tenantId: TenantId;
  mspId: MspId;
  userId: UserId;
}

const AUDIENCE = 'zerostress:consent-callback';
const TTL = '15m';

function signingKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return new TextEncoder().encode(secret);
}

export async function createConsentState(claims: ConsentStateClaims): Promise<string> {
  return new SignJWT({ tenantId: claims.tenantId, mspId: claims.mspId, userId: claims.userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .setJti(randomUUID())
    .sign(signingKey());
}

export async function verifyConsentState(token: string): Promise<ConsentStateClaims> {
  const { payload } = await jwtVerify(token, signingKey(), { audience: AUDIENCE });
  const { tenantId, mspId, userId } = payload;

  if (typeof tenantId !== 'string' || typeof mspId !== 'string' || typeof userId !== 'string') {
    throw new Error('Invalid consent state payload');
  }

  return {
    tenantId: tenantId as TenantId,
    mspId: mspId as MspId,
    userId: userId as UserId,
  };
}
