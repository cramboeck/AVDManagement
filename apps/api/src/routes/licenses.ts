/**
 * Lizenz-Routen
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getIdentityProvider } from '../services/microsoft-clients.js';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

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
