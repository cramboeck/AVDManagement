/**
 * Session-Management
 */

import type { SessionUser, UserRole } from '@zerostress/types';

export interface SessionConfig {
  secret: string;
  maxAge: number;
  secure: boolean;
}

export interface Session {
  user: SessionUser | null;
  activeTenantId: string | null;
  expiresAt: Date;
}

export function createEmptySession(): Session {
  return {
    user: null,
    activeTenantId: null,
    expiresAt: new Date(0),
  };
}

export function hasPermission(role: UserRole, requiredRole: UserRole): boolean {
  const roleHierarchy: Record<UserRole, number> = {
    owner: 3,
    engineer: 2,
    readonly: 1,
  };

  return roleHierarchy[role] >= roleHierarchy[requiredRole];
}

export function canReadTenant(role: UserRole): boolean {
  return hasPermission(role, 'readonly');
}

export function canWriteTenant(role: UserRole): boolean {
  return hasPermission(role, 'engineer');
}

export function canManageMsp(role: UserRole): boolean {
  return hasPermission(role, 'owner');
}
