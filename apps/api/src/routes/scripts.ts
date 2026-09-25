/**
 * Skriptbibliothek: Stand der Bibliothek gegen den Tenant
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getRemediationProvider } from '../services/microsoft-clients.js';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Welche Bibliotheksskripte im Tenant fehlen, veraltet oder aktuell sind
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const status = await getRemediationProvider().getLibraryStatus({
    tenantId: tenant.id,
    correlationId: c.req.header('X-Correlation-ID') ?? randomUUID(),
  });
  return c.json(status);
});

export { app as scriptsRouter };
