/**
 * Auth-Middleware fuer Entra ID
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import * as jose from 'jose';
import { eq, and } from 'drizzle-orm';
import { db, mspUsers, mspOrganizations } from '../db/index.js';
import type { SessionUser, UserRole, MspId, UserId } from '@zerostress/types';

// JWKS fuer Token-Validierung
let jwks: jose.JWTVerifyGetKey | null = null;

async function getJwks(): Promise<jose.JWTVerifyGetKey> {
  if (!jwks) {
    const tenantId = process.env.ENTRA_TENANT_ID ?? 'common';
    jwks = jose.createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    );
  }
  return jwks;
}

export interface AuthContext {
  user: SessionUser;
  mspId: MspId;
  accessToken: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, {
      message: 'Authentication required',
    });
  }

  const token = authHeader.slice(7);

  try {
    const jwksClient = await getJwks();
    const { payload } = await jose.jwtVerify(token, jwksClient, {
      issuer: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0`,
      audience: process.env.ENTRA_CLIENT_ID,
    });

    const entraObjectId = payload.oid as string;
    const email = (payload.preferred_username ?? payload.email ?? payload.upn) as string;
    const displayName = payload.name as string;

    if (!entraObjectId || !email) {
      throw new HTTPException(401, {
        message: 'Invalid token claims',
      });
    }

    const user = await findOrCreateUser(entraObjectId, email, displayName);

    c.set('auth', {
      user,
      mspId: user.mspId,
      accessToken: token,
    });

    await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }

    console.error('Auth error:', error);
    throw new HTTPException(401, {
      message: 'Invalid or expired token',
    });
  }
});

async function findOrCreateUser(
  entraObjectId: string,
  email: string,
  displayName: string
): Promise<SessionUser> {
  const existingUser = await db.query.mspUsers.findFirst({
    where: eq(mspUsers.entraObjectId, entraObjectId),
    with: {
      // Keine Relations definiert, daher manuell
    },
  });

  if (existingUser) {
    await db
      .update(mspUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(mspUsers.id, existingUser.id));

    return {
      id: existingUser.id as UserId,
      mspId: existingUser.mspId as MspId,
      email: existingUser.email,
      displayName: existingUser.displayName,
      role: existingUser.role as UserRole,
    };
  }

  // Neuen Benutzer erstellen (erster Benutzer wird Owner)
  let msp = await db.query.mspOrganizations.findFirst({
    where: eq(mspOrganizations.isActive, true),
  });

  if (!msp) {
    const [newMsp] = await db
      .insert(mspOrganizations)
      .values({
        name: 'Default MSP',
        slug: 'default',
      })
      .returning();
    msp = newMsp;
  }

  const isFirstUser = !(await db.query.mspUsers.findFirst({
    where: eq(mspUsers.mspId, msp.id),
  }));

  const [newUser] = await db
    .insert(mspUsers)
    .values({
      mspId: msp.id,
      entraObjectId,
      email,
      displayName,
      role: isFirstUser ? 'owner' : 'readonly',
      lastLoginAt: new Date(),
    })
    .returning();

  return {
    id: newUser.id as UserId,
    mspId: newUser.mspId as MspId,
    email: newUser.email,
    displayName: newUser.displayName,
    role: newUser.role as UserRole,
  };
}

// Rollen-Pruefung
export function requireRole(requiredRole: UserRole) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth');

    const roleHierarchy: Record<UserRole, number> = {
      owner: 3,
      engineer: 2,
      readonly: 1,
    };

    if (roleHierarchy[auth.user.role] < roleHierarchy[requiredRole]) {
      throw new HTTPException(403, {
        message: `Role '${requiredRole}' required`,
      });
    }

    await next();
  });
}
