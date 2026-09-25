/**
 * Benutzer-Routen (Identity-Modul)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getIdentityProvider } from '../services/microsoft-clients.js';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

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
