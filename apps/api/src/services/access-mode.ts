/**
 * Nur-Lese-Betrieb: Schalter fuer die ganze Konsole (CONSOLE_READ_ONLY) und
 * Betriebsart je Tenant (managed_tenants.access_mode). Die Sperre selbst
 * sitzt in der JobQueue (packages/core/src/jobs/write-guard.ts).
 */

import { eq } from 'drizzle-orm';
import { createWriteGuard, type WriteGuard } from '@zerostress/core';
import type { ConsoleMode, TenantAccessMode, TenantId } from '@zerostress/types';
import { db, managedTenants } from '../db/index.js';

export function isConsoleReadOnly(): boolean {
  return process.env.CONSOLE_READ_ONLY === 'true';
}

export function consoleMode(): ConsoleMode {
  return { readOnly: isConsoleReadOnly() };
}

/** Betriebsart eines Tenants; ein unbekannter Tenant gilt als gesperrt. */
export async function tenantAccessMode(tenantId: TenantId): Promise<TenantAccessMode> {
  const row = await db.query.managedTenants.findFirst({ where: eq(managedTenants.id, tenantId), columns: { accessMode: true } });
  if (!row) return 'read-only';
  return row.accessMode === 'full' ? 'full' : 'read-only';
}

export function getWriteGuard(): WriteGuard {
  return createWriteGuard(isConsoleReadOnly, tenantAccessMode);
}
