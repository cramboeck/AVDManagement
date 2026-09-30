/**
 * Benutzer des MSP aus einer Entra-Identitaet aufloesen
 *
 * Der erste Benutzer einer Installation wird Owner der Default-MSP, jeder
 * weitere Nur-lesen, bis ein Owner die Rolle unter Einstellungen > Team
 * setzt. Deaktivierte Konten werden abgewiesen, auch wenn Entra sie noch
 * kennt.
 */

import { eq } from 'drizzle-orm';
import { db, mspUsers, mspOrganizations } from '../db/index.js';
import type { MspId, SessionUser, UserId, UserRole } from '@zerostress/types';

export class UserInactiveError extends Error {
  constructor() {
    super('Das Konto ist in der Konsole deaktiviert');
  }
}

export async function findOrCreateUser(entraObjectId: string, email: string, displayName: string, forcedRole?: UserRole): Promise<SessionUser> {
  const existingUser = await db.query.mspUsers.findFirst({ where: eq(mspUsers.entraObjectId, entraObjectId) });

  if (existingUser) {
    if (!existingUser.isActive) throw new UserInactiveError();
    const role = forcedRole ?? (existingUser.role as UserRole);
    await db.update(mspUsers).set({ lastLoginAt: new Date(), role }).where(eq(mspUsers.id, existingUser.id));
    return { id: existingUser.id as UserId, mspId: existingUser.mspId as MspId, email: existingUser.email, displayName: existingUser.displayName, role };
  }

  let msp = await db.query.mspOrganizations.findFirst({ where: eq(mspOrganizations.isActive, true) });
  if (!msp) {
    const [newMsp] = await db.insert(mspOrganizations).values({ name: 'Default MSP', slug: 'default' }).returning();
    msp = newMsp;
  }

  const isFirstUser = !(await db.query.mspUsers.findFirst({ where: eq(mspUsers.mspId, msp.id) }));
  const [newUser] = await db
    .insert(mspUsers)
    .values({ mspId: msp.id, entraObjectId, email, displayName, role: forcedRole ?? (isFirstUser ? 'owner' : 'readonly'), lastLoginAt: new Date() })
    .returning();
  return { id: newUser.id as UserId, mspId: newUser.mspId as MspId, email: newUser.email, displayName: newUser.displayName, role: newUser.role as UserRole };
}

/** Aktuellen Stand eines Benutzers laden (Rolle, aktiv) fuer bestehende Sitzungen. */
export async function loadUser(userId: string): Promise<SessionUser | null> {
  const row = await db.query.mspUsers.findFirst({ where: eq(mspUsers.id, userId) });
  if (!row || !row.isActive) return null;
  return { id: row.id as UserId, mspId: row.mspId as MspId, email: row.email, displayName: row.displayName, role: row.role as UserRole };
}
