/**
 * Tenant-Routen
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, managedTenants } from '../db/index.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import { createConsentState } from '../services/consent-state.js';
import { testTenantConnection, persistConnectionTestResult } from '../services/tenant-connection.js';
import { toManagedTenant, type TenantRow } from '../services/tenant-mapper.js';
import { DrizzleSnapshotStore } from '../services/inventory-store.js';
import type { TenantId, MspId, UserId, CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);

async function findOwnTenant(tenantId: string, mspId: MspId): Promise<TenantRow | undefined> {
  return db.query.managedTenants.findFirst({
    where: and(eq(managedTenants.id, tenantId), eq(managedTenants.mspId, mspId)),
  });
}

function notFound(tenantId: string) {
  return {
    type: 'https://api.zerostress.io/problems/not-found',
    title: 'Tenant not found',
    status: 404,
    detail: `Tenant '${tenantId}' not found`,
  };
}

// Alle Tenants auflisten
app.get('/', async (c) => {
  const auth = c.get('auth');

  const tenants = await db.query.managedTenants.findMany({
    where: and(eq(managedTenants.mspId, auth.mspId), eq(managedTenants.isActive, true)),
    orderBy: (t, { asc }) => [asc(t.displayName)],
  });

  return c.json({ items: tenants.map(toManagedTenant) });
});

// Tenant-Details
app.get('/:tenantId', async (c) => {
  const auth = c.get('auth');
  const tenantId = c.req.param('tenantId');

  const tenant = await findOwnTenant(tenantId, auth.mspId);
  if (!tenant) {
    return c.json(notFound(tenantId), 404);
  }

  return c.json(toManagedTenant(tenant));
});

// Neuen Tenant onboarden
const createTenantSchema = z.object({
  microsoftTenantId: z.string().uuid(),
  displayName: z.string().min(1).max(255),
  primaryDomain: z.string().min(1).max(255),
  authMethod: z.enum(['gdap', 'app-consent']),
});

app.post('/', requireRole('engineer'), zValidator('json', createTenantSchema), async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const correlationId = randomUUID() as CorrelationId;

  const existing = await db.query.managedTenants.findFirst({
    where: and(
      eq(managedTenants.mspId, auth.mspId),
      eq(managedTenants.microsoftTenantId, body.microsoftTenantId)
    ),
  });

  if (existing) {
    await audit.log({
      mspId: auth.mspId,
      tenantId: existing.id as TenantId,
      userId: auth.user.id,
      action: 'tenant.create',
      targetType: 'tenant',
      targetId: body.microsoftTenantId,
      targetDisplayName: body.displayName,
      result: 'failure',
      errorMessage: 'Tenant already onboarded',
      correlationId,
    });

    return c.json(
      {
        type: 'https://api.zerostress.io/problems/conflict',
        title: 'Tenant already exists',
        status: 409,
        detail: `Tenant with Microsoft ID '${body.microsoftTenantId}' is already onboarded`,
      },
      409
    );
  }

  const [tenant] = await db
    .insert(managedTenants)
    .values({
      mspId: auth.mspId,
      microsoftTenantId: body.microsoftTenantId,
      displayName: body.displayName,
      primaryDomain: body.primaryDomain,
      authMethod: body.authMethod,
      connectionStatus: 'consent-required',
    })
    .returning();

  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id as TenantId,
    userId: auth.user.id,
    action: 'tenant.create',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    afterState: { connectionStatus: tenant.connectionStatus, authMethod: tenant.authMethod },
    result: 'success',
    correlationId,
  });

  return c.json(toManagedTenant(tenant), 201);
});

// Tenant aus der Konsole entfernen. Bewusst kein harter Loeschvorgang:
// Jobs und Audit-Eintraege verweisen auf den Tenant und bleiben nachvollziehbar.
// Der Consent im Kundentenant bleibt bestehen, bis die Enterprise-Anwendung
// dort entfernt wird; die Konsole kann ihn mit App-Berechtigungen nicht widerrufen.
const removeTenantSchema = z.object({
  // Der Anzeigename muss abgetippt werden, damit nichts versehentlich verschwindet
  confirmName: z.string().min(1),
});

app.delete('/:tenantId', requireRole('owner'), zValidator('json', removeTenantSchema), async (c) => {
  const auth = c.get('auth');
  const tenantId = c.req.param('tenantId');
  const { confirmName } = c.req.valid('json');
  const correlationId = randomUUID() as CorrelationId;

  const tenant = await findOwnTenant(tenantId, auth.mspId);
  if (!tenant) {
    return c.json(notFound(tenantId), 404);
  }

  const auditBase = {
    mspId: auth.mspId,
    tenantId: tenant.id as TenantId,
    userId: auth.user.id,
    action: 'tenant.remove',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    beforeState: { connectionStatus: tenant.connectionStatus, isActive: true },
    correlationId,
  };

  if (confirmName.trim() !== tenant.displayName) {
    await audit.log({ ...auditBase, result: 'failure', errorMessage: 'Confirmation name did not match' });
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/validation',
        title: 'Confirmation does not match',
        status: 400,
        detail: 'Der eingegebene Name stimmt nicht mit dem Anzeigenamen des Tenants ueberein',
      },
      400
    );
  }

  await db.update(managedTenants).set({ isActive: false }).where(eq(managedTenants.id, tenant.id));
  await new DrizzleSnapshotStore().deleteForTenant(tenant.id as TenantId);

  await audit.log({ ...auditBase, afterState: { isActive: false }, result: 'success' });

  return c.json({ removed: true, tenantId: tenant.id });
});

// Consent-URL generieren
app.get('/:tenantId/consent-url', requireRole('engineer'), async (c) => {
  const tenantId = c.req.param('tenantId');
  const auth = c.get('auth');

  const tenant = await findOwnTenant(tenantId, auth.mspId);
  if (!tenant) {
    return c.json(notFound(tenantId), 404);
  }

  const state = await createConsentState({
    tenantId: tenant.id as TenantId,
    mspId: auth.mspId,
    userId: auth.user.id as UserId,
  });

  const apiUrl = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? '3001'}`;
  const params = new URLSearchParams({
    client_id: process.env.ENTRA_CLIENT_ID!,
    redirect_uri: `${apiUrl}/auth/consent-callback`,
    scope: 'https://graph.microsoft.com/.default',
    state,
  });

  const consentUrl = `https://login.microsoftonline.com/${tenant.microsoftTenantId}/v2.0/adminconsent?${params}`;

  return c.json({ consentUrl });
});

// Verbindung testen
app.post('/:tenantId/test-connection', requireRole('engineer'), async (c) => {
  const tenantId = c.req.param('tenantId');
  const auth = c.get('auth');
  const correlationId = randomUUID() as CorrelationId;

  const tenant = await findOwnTenant(tenantId, auth.mspId);
  if (!tenant) {
    return c.json(notFound(tenantId), 404);
  }

  const result = await testTenantConnection(tenant.microsoftTenantId);
  await persistConnectionTestResult(tenant.id, result);

  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id as TenantId,
    userId: auth.user.id,
    action: 'tenant.test-connection',
    targetType: 'tenant',
    targetId: tenant.microsoftTenantId,
    targetDisplayName: tenant.displayName,
    beforeState: { connectionStatus: tenant.connectionStatus },
    afterState: { connectionStatus: result.status, missingScopes: result.missingScopes },
    result: result.status === 'connected' ? 'success' : 'failure',
    errorMessage: result.detail ?? undefined,
    correlationId,
  });

  return c.json(result);
});

export { app as tenantsRouter };
