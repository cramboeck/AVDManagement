/**
 * Sichtbarkeit und Team: welche Tenants ein Techniker sieht, Rollen und
 * Zuweisungen. Owner sehen alles; Engineer und Readonly nur zugewiesene
 * Tenants, ohne Zuweisung nichts. Das ist die sichere Voreinstellung fuer
 * neue Konten.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { UserRole } from '@zerostress/types';
import { db, managedTenants, mspUserTenants, mspUsers } from '../db/index.js';
import type { AuthContext } from '../middleware/auth.js';

export type Visibility = 'all' | string[];

export async function visibleTenantIds(auth: AuthContext): Promise<Visibility> {
  if (auth.user.role === 'owner') return 'all';
  const rows = await db.select({ tenantId: mspUserTenants.tenantId }).from(mspUserTenants).where(eq(mspUserTenants.userId, auth.user.id));
  return rows.map((r) => r.tenantId);
}

export async function canAccessTenant(auth: AuthContext, tenantId: string): Promise<boolean> {
  const visible = await visibleTenantIds(auth);
  return visible === 'all' || visible.includes(tenantId);
}

/** Tenant-Filter fuer Listen: null = keine Einschraenkung, [] = nichts sichtbar. */
export async function tenantFilter(auth: AuthContext): Promise<string[] | null> {
  const visible = await visibleTenantIds(auth);
  return visible === 'all' ? null : visible;
}

export interface TeamMember {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  tenantIds: string[];
}

export async function listTeam(mspId: string): Promise<TeamMember[]> {
  const users = await db.query.mspUsers.findMany({ where: eq(mspUsers.mspId, mspId) });
  const ids = users.map((u) => u.id);
  const assignments = ids.length > 0 ? await db.select().from(mspUserTenants).where(inArray(mspUserTenants.userId, ids)) : [];
  return users
    .map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role as UserRole,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      tenantIds: assignments.filter((a) => a.userId === u.id).map((a) => a.tenantId),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export class TeamError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string
  ) {
    super(message);
  }
}

/**
 * Rolle und Tenant-Zuweisungen eines Teammitglieds setzen. Der letzte Owner
 * bleibt Owner; die eigene Rolle laesst sich nicht aendern.
 */
export async function updateTeamMember(mspId: string, actorId: string, userId: string, input: { role?: UserRole; tenantIds?: string[]; isActive?: boolean }): Promise<TeamMember> {
  const user = await db.query.mspUsers.findFirst({ where: and(eq(mspUsers.id, userId), eq(mspUsers.mspId, mspId)) });
  if (!user) throw new TeamError(404, 'Benutzer nicht gefunden');
  if (input.role && input.role !== user.role) {
    if (userId === actorId) throw new TeamError(400, 'Die eigene Rolle laesst sich nicht aendern');
    if (user.role === 'owner') {
      const owners = await db.query.mspUsers.findMany({ where: and(eq(mspUsers.mspId, mspId), eq(mspUsers.role, 'owner'), eq(mspUsers.isActive, true)) });
      if (owners.length <= 1) throw new TeamError(400, 'Der letzte Owner kann nicht herabgestuft werden');
    }
    await db.update(mspUsers).set({ role: input.role }).where(eq(mspUsers.id, userId));
  }
  if (input.isActive !== undefined && input.isActive !== user.isActive) {
    if (userId === actorId) throw new TeamError(400, 'Das eigene Konto laesst sich nicht deaktivieren');
    await db.update(mspUsers).set({ isActive: input.isActive }).where(eq(mspUsers.id, userId));
  }
  if (input.tenantIds) {
    const valid = await db
      .select({ id: managedTenants.id })
      .from(managedTenants)
      .where(and(eq(managedTenants.mspId, mspId), inArray(managedTenants.id, input.tenantIds.length > 0 ? input.tenantIds : ['00000000-0000-0000-0000-000000000000'])));
    const validIds = new Set(valid.map((v) => v.id));
    await db.delete(mspUserTenants).where(eq(mspUserTenants.userId, userId));
    const rows = input.tenantIds.filter((id) => validIds.has(id)).map((tenantId) => ({ userId, tenantId }));
    if (rows.length > 0) await db.insert(mspUserTenants).values(rows).onConflictDoNothing();
  }
  const team = await listTeam(mspId);
  return team.find((m) => m.id === userId) as TeamMember;
}
