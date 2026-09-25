/**
 * Benutzer-Routen (Identity-Modul)
 */

import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getIdentityProvider } from '../services/microsoft-clients.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { CorrelationId, TenantId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

function providerContext(c: Context, tenantId: TenantId) {
  return {
    tenantId,
    correlationId: c.req.header('X-Correlation-ID') ?? randomUUID(),
  };
}

function notFound(userId: string) {
  return {
    type: 'https://api.zerostress.io/problems/not-found',
    title: 'User not found',
    status: 404,
    detail: `User '${userId}' not found`,
  };
}

// Benutzer auflisten
app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const provider = getIdentityProvider();

  const pageSize = parseInt(c.req.query('pageSize') ?? '25', 10);
  const pageToken = c.req.query('pageToken');
  const search = c.req.query('search');

  const result = await provider.listUsers(providerContext(c, tenant.id), {
    pageSize,
    pageToken,
    search,
  });

  return c.json({
    items: result.items,
    nextPageToken: result.nextPageToken,
  });
});

// Einzelnen Benutzer abrufen (Basisdaten)
app.get('/:userId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const userId = c.req.param('userId');

  const user = await getIdentityProvider().getUser(providerContext(c, tenant.id), userId);
  if (!user) {
    return c.json(notFound(userId), 404);
  }

  return c.json(user);
});

// Benutzerdetail (Profil + Anmeldeaktivitaet)
app.get('/:userId/detail', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const userId = c.req.param('userId');

  const user = await getIdentityProvider().getUserDetail(providerContext(c, tenant.id), userId);
  if (!user) {
    return c.json(notFound(userId), 404);
  }

  return c.json(user);
});

// Lizenzen eines Benutzers
app.get('/:userId/licenses', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const userId = c.req.param('userId');

  const licenses = await getIdentityProvider().getUserLicenses(providerContext(c, tenant.id), userId);

  return c.json({ items: licenses });
});

// Gruppenmitgliedschaften
app.get('/:userId/groups', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const userId = c.req.param('userId');

  const groups = await getIdentityProvider().getUserGroups(providerContext(c, tenant.id), userId);

  return c.json({ items: groups });
});

// Authentifizierungsmethoden (MFA-Status)
app.get('/:userId/auth-methods', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const userId = c.req.param('userId');

  const result = await getIdentityProvider().getUserAuthenticationMethods(
    providerContext(c, tenant.id),
    userId
  );

  return c.json(result);
});

// Anmeldeprotokoll eines Benutzers. Personenbezogen, daher jeder Abruf im Audit.
app.get('/:userId/sign-ins', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const userId = c.req.param('userId');
  const ctx = providerContext(c, tenant.id);

  const result = await getIdentityProvider().listSignIns(ctx, {
    userId,
    top: parseInt(c.req.query('top') ?? '50', 10),
    since: c.req.query('since'),
    failuresOnly: c.req.query('failuresOnly') === 'true',
  });

  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'identity.sign-ins.view',
    targetType: 'user',
    targetId: userId,
    targetDisplayName: userId,
    result: result.available ? 'success' : 'failure',
    errorMessage: result.available ? undefined : result.reason,
    correlationId: ctx.correlationId as CorrelationId,
  });

  return c.json(result);
});

// Entra-Verzeichnisaudit zu einem Benutzer
app.get('/:userId/audit', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const auth = c.get('auth');
  const userId = c.req.param('userId');
  const ctx = providerContext(c, tenant.id);

  const result = await getIdentityProvider().listDirectoryAudits(ctx, {
    userId,
    top: parseInt(c.req.query('top') ?? '50', 10),
    since: c.req.query('since'),
  });

  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant.id,
    userId: auth.user.id,
    action: 'identity.directory-audit.view',
    targetType: 'user',
    targetId: userId,
    targetDisplayName: userId,
    result: result.available ? 'success' : 'failure',
    errorMessage: result.available ? undefined : result.reason,
    correlationId: ctx.correlationId as CorrelationId,
  });

  return c.json(result);
});

export { app as usersRouter };
