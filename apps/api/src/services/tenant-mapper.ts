/**
 * Datenbankzeile -> API-Modell fuer verwaltete Tenants
 */

import type { managedTenants } from '../db/index.js';
import type {
  ManagedTenant,
  MissingScope,
  MspId,
  TenantAuthMethod,
  TenantConnectionStatus,
  TenantId,
} from '@zerostress/types';

export type TenantRow = typeof managedTenants.$inferSelect;

export function toManagedTenant(row: TenantRow): ManagedTenant {
  return {
    id: row.id as TenantId,
    mspId: row.mspId as MspId,
    microsoftTenantId: row.microsoftTenantId,
    displayName: row.displayName,
    primaryDomain: row.primaryDomain,
    authMethod: row.authMethod as TenantAuthMethod,
    connectionStatus: row.connectionStatus as TenantConnectionStatus,
    missingScopes: (row.missingScopes ?? []) as MissingScope[],
    onboardedAt: row.onboardedAt,
    lastSyncAt: row.lastSyncAt,
    isActive: row.isActive,
  };
}
