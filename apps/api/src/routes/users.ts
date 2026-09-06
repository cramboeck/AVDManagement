/**
 * Benutzer-Routen (Identity-Modul)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { IdentityProvider, GraphClient, TokenProvider } from '@zerostress/core';
import type { SyncedUser, UserLicense, LicenseSku, TenantId } from '@zerostress/types';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Provider-Instanz (in Produktion per DI)
function getIdentityProvider(): IdentityProvider {
  const tokenProvider = new TokenProvider({
    clientId: process.env.ENTRA_CLIENT_ID!,
    clientSecret: process.env.ENTRA_CLIENT_SECRET!,
    tenantId: process.env.ENTRA_TENANT_ID!,
  });

  const graphClient = new GraphClient({
    getAccessToken: (tenantId, scopes) => tokenProvider.getAccessToken(tenantId, scopes),
  });

  return new IdentityProvider(graphClient);
}

// Benutzer auflisten
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const provider = getIdentityProvider();

  const pageSize = parseInt(c.req.query('pageSize') ?? '25', 10);
  const pageToken = c.req.query('pageToken');
  const search = c.req.query('search');

  const result = await provider.listUsers(
    {
      tenantId: tenant.id,
      correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
    },
    { pageSize, pageToken, search }
  );

  return c.json({
    items: result.items,
    nextPageToken: result.nextPageToken,
  });
});

// Einzelnen Benutzer abrufen
app.get('/:userId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const userId = c.req.param('userId');
  const provider = getIdentityProvider();

  const user = await provider.getUser(
    {
      tenantId: tenant.id,
      correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
    },
    userId
  );

  if (!user) {
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/not-found',
        title: 'User not found',
        status: 404,
        detail: `User '${userId}' not found`,
      },
      404
    );
  }

  return c.json(user);
});

// Lizenzen eines Benutzers
app.get('/:userId/licenses', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const userId = c.req.param('userId');
  const provider = getIdentityProvider();

  const licenses = await provider.getUserLicenses(
    {
      tenantId: tenant.id,
      correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
    },
    userId
  );

  return c.json({ items: licenses });
});

// Verfuegbare SKUs im Tenant
app.get('/skus', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const provider = getIdentityProvider();

  const skus = await provider.getAvailableSkus({
    tenantId: tenant.id,
    correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
  });

  return c.json({ items: skus });
});

export { app as usersRouter };
