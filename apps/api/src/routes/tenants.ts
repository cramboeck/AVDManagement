/**
 * Tenant-Routen
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, managedTenants } from '../db/index.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import type { TenantId, ManagedTenant, TenantAuthMethod, TenantConnectionStatus } from '@zerostress/types';

const app = new Hono();

app.use('*', authMiddleware);

// Alle Tenants auflisten
app.get('/', async (c) => {
  const auth = c.get('auth');

  const tenants = await db.query.managedTenants.findMany({
    where: and(
      eq(managedTenants.mspId, auth.mspId),
      eq(managedTenants.isActive, true)
    ),
    orderBy: (t, { asc }) => [asc(t.displayName)],
  });

  const items: ManagedTenant[] = tenants.map((t) => ({
    id: t.id as TenantId,
    mspId: auth.mspId,
    microsoftTenantId: t.microsoftTenantId,
    displayName: t.displayName,
    primaryDomain: t.primaryDomain,
    authMethod: t.authMethod as TenantAuthMethod,
    connectionStatus: t.connectionStatus as TenantConnectionStatus,
    missingScopes: (t.missingScopes ?? []) as { scope: string; reason: string }[],
    onboardedAt: t.onboardedAt,
    lastSyncAt: t.lastSyncAt,
    isActive: t.isActive,
  }));

  return c.json({ items });
});

// Tenant-Details
app.get('/:tenantId', async (c) => {
  const auth = c.get('auth');
  const tenantId = c.req.param('tenantId');

  const tenant = await db.query.managedTenants.findFirst({
    where: and(
      eq(managedTenants.id, tenantId),
      eq(managedTenants.mspId, auth.mspId)
    ),
  });

  if (!tenant) {
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/not-found',
        title: 'Tenant not found',
        status: 404,
        detail: `Tenant '${tenantId}' not found`,
      },
      404
    );
  }

  const item: ManagedTenant = {
    id: tenant.id as TenantId,
    mspId: auth.mspId,
    microsoftTenantId: tenant.microsoftTenantId,
    displayName: tenant.displayName,
    primaryDomain: tenant.primaryDomain,
    authMethod: tenant.authMethod as TenantAuthMethod,
    connectionStatus: tenant.connectionStatus as TenantConnectionStatus,
    missingScopes: (tenant.missingScopes ?? []) as { scope: string; reason: string }[],
    onboardedAt: tenant.onboardedAt,
    lastSyncAt: tenant.lastSyncAt,
    isActive: tenant.isActive,
  };

  return c.json(item);
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

  // Pruefen ob Tenant bereits existiert
  const existing = await db.query.managedTenants.findFirst({
    where: and(
      eq(managedTenants.mspId, auth.mspId),
      eq(managedTenants.microsoftTenantId, body.microsoftTenantId)
    ),
  });

  if (existing) {
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

  const item: ManagedTenant = {
    id: tenant.id as TenantId,
    mspId: auth.mspId,
    microsoftTenantId: tenant.microsoftTenantId,
    displayName: tenant.displayName,
    primaryDomain: tenant.primaryDomain,
    authMethod: tenant.authMethod as TenantAuthMethod,
    connectionStatus: tenant.connectionStatus as TenantConnectionStatus,
    missingScopes: [],
    onboardedAt: tenant.onboardedAt,
    lastSyncAt: tenant.lastSyncAt,
    isActive: tenant.isActive,
  };

  return c.json(item, 201);
});

// Consent-URL generieren
app.get('/:tenantId/consent-url', async (c) => {
  const tenantId = c.req.param('tenantId');
  const auth = c.get('auth');

  const tenant = await db.query.managedTenants.findFirst({
    where: and(
      eq(managedTenants.id, tenantId),
      eq(managedTenants.mspId, auth.mspId)
    ),
  });

  if (!tenant) {
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/not-found',
        title: 'Tenant not found',
        status: 404,
      },
      404
    );
  }

  const clientId = process.env.ENTRA_CLIENT_ID;
  const redirectUri = encodeURIComponent(`${process.env.API_URL}/auth/consent-callback`);
  const scopes = encodeURIComponent([
    'https://graph.microsoft.com/.default',
  ].join(' '));

  const consentUrl = `https://login.microsoftonline.com/${tenant.microsoftTenantId}/adminconsent?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scopes}&state=${tenantId}`;

  return c.json({ consentUrl });
});

// Verbindung testen
app.post('/:tenantId/test-connection', async (c) => {
  const tenantId = c.req.param('tenantId');
  const auth = c.get('auth');

  const tenant = await db.query.managedTenants.findFirst({
    where: and(
      eq(managedTenants.id, tenantId),
      eq(managedTenants.mspId, auth.mspId)
    ),
  });

  if (!tenant) {
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/not-found',
        title: 'Tenant not found',
        status: 404,
      },
      404
    );
  }

  // TODO: Echte Verbindungspruefung mit Graph API
  // Hier nur Platzhalter
  const connected = true;
  const missingScopes: { scope: string; reason: string }[] = [];

  const newStatus: TenantConnectionStatus = connected
    ? missingScopes.length > 0
      ? 'permissions-insufficient'
      : 'connected'
    : 'consent-required';

  await db
    .update(managedTenants)
    .set({
      connectionStatus: newStatus,
      missingScopes,
      lastSyncAt: connected ? new Date() : null,
    })
    .where(eq(managedTenants.id, tenantId));

  return c.json({
    status: newStatus,
    missingScopes,
  });
});

export { app as tenantsRouter };
