/**
 * Lizenz-Routen
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { IdentityProvider, GraphClient, TokenProvider } from '@zerostress/core';
import type { LicenseSku } from '@zerostress/types';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// IdentityProvider-Instanz (Singleton in Produktion)
let identityProvider: IdentityProvider | null = null;

function getIdentityProvider(): IdentityProvider {
  if (!identityProvider) {
    const tokenProvider = new TokenProvider({
      clientId: process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      tenantId: process.env.ENTRA_TENANT_ID!,
    });

    const graphClient = new GraphClient({
      getAccessToken: (tenantId, scopes) => tokenProvider.getAccessToken(tenantId, scopes),
    });

    identityProvider = new IdentityProvider(graphClient);
  }
  return identityProvider;
}

// Verfuegbare SKUs auflisten
app.get('/skus', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const provider = getIdentityProvider();

  const skus = await provider.getAvailableSkus({
    tenantId: tenant.id,
    correlationId: crypto.randomUUID(),
  });

  return c.json({ items: skus });
});

// Lizenzen eines Benutzers abrufen
app.get('/users/:userId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const userId = c.req.param('userId');
  const provider = getIdentityProvider();

  const licenses = await provider.getUserLicenses(
    {
      tenantId: tenant.id,
      correlationId: crypto.randomUUID(),
    },
    userId
  );

  return c.json({ items: licenses });
});

export { app as licensesRouter };
