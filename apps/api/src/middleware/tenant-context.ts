/**
 * Tenant-Context Middleware
 *
 * Stellt sicher, dass der Tenant-Kontext korrekt gesetzt ist.
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { eq, and } from 'drizzle-orm';
import { db, managedTenants } from '../db/index.js';
import type { TenantId, ManagedTenant } from '@zerostress/types';

declare module 'hono' {
  interface ContextVariableMap {
    tenant: ManagedTenant;
  }
}

export const tenantContextMiddleware = createMiddleware(async (c, next) => {
  const tenantId = c.req.param('tenantId');

  if (!tenantId) {
    await next();
    return;
  }

  const auth = c.get('auth');
  if (!auth) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  const tenant = await db.query.managedTenants.findFirst({
    where: and(
      eq(managedTenants.id, tenantId),
      eq(managedTenants.mspId, auth.mspId),
      eq(managedTenants.isActive, true)
    ),
  });

  if (!tenant) {
    throw new HTTPException(404, {
      message: `Tenant '${tenantId}' not found or access denied`,
    });
  }

  c.set('tenant', {
    id: tenant.id as TenantId,
    mspId: auth.mspId,
    microsoftTenantId: tenant.microsoftTenantId,
    displayName: tenant.displayName,
    primaryDomain: tenant.primaryDomain,
    authMethod: tenant.authMethod as 'gdap' | 'app-consent',
    connectionStatus: tenant.connectionStatus as 'connected' | 'consent-required' | 'permissions-insufficient' | 'error',
    missingScopes: (tenant.missingScopes ?? []) as { scope: string; reason: string }[],
    onboardedAt: tenant.onboardedAt,
    lastSyncAt: tenant.lastSyncAt,
    isActive: tenant.isActive,
  });

  await next();
});

export const requireConnectedTenant = createMiddleware(async (c, next) => {
  const tenant = c.get('tenant');

  if (!tenant) {
    throw new HTTPException(400, { message: 'Tenant context required' });
  }

  if (tenant.connectionStatus !== 'connected') {
    throw new HTTPException(403, {
      message: getTenantConnectionMessage(tenant),
    });
  }

  await next();
});

function getTenantConnectionMessage(tenant: ManagedTenant): string {
  switch (tenant.connectionStatus) {
    case 'consent-required':
      return `Admin consent required for tenant '${tenant.displayName}'. Please complete the consent process.`;
    case 'permissions-insufficient':
      const scopes = tenant.missingScopes.map((s) => s.scope).join(', ');
      return `Missing permissions for tenant '${tenant.displayName}': ${scopes}`;
    case 'error':
      return `Connection error with tenant '${tenant.displayName}'. Please check the configuration.`;
    default:
      return `Tenant '${tenant.displayName}' is not connected.`;
  }
}
