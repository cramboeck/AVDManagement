/**
 * AVD-Routen (Azure Virtual Desktop)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { getAvdProvider } from '../services/microsoft-clients.js';
import { getJobQueue } from '../services/job-queue.js';

const app = new Hono();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

// Die ARM-Resource-ID kommt URL-kodiert als ein Segment an; Hono dekodiert
// sie inklusive fuehrendem Slash. Defensiv auf genau einen Slash normieren.
function toArmResourceId(param: string): string {
  return '/' + param.replace(/^\/+/, '');
}

// ============================================
// Host Pools
// ============================================

app.get('/host-pools', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const provider = getAvdProvider();

  const result = await provider.listHostPools(
    {
      tenantId: tenant.id,
      correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
    }
  );

  return c.json({
    items: result.items,
    nextPageToken: result.nextPageToken,
    warnings: result.warnings,
  });
});

app.get('/host-pools/:resourceId', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const resourceId = toArmResourceId(c.req.param('resourceId'));
  const provider = getAvdProvider();

  const hostPool = await provider.getHostPool(
    {
      tenantId: tenant.id,
      correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
    },
    resourceId
  );

  if (!hostPool) {
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/not-found',
        title: 'Host Pool not found',
        status: 404,
        detail: `Host Pool '${resourceId}' not found`,
      },
      404
    );
  }

  return c.json(hostPool);
});

app.get('/host-pools/:resourceId/summary', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const resourceId = toArmResourceId(c.req.param('resourceId'));
  const provider = getAvdProvider();

  const summary = await provider.getHostPoolSummary(
    {
      tenantId: tenant.id,
      correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
    },
    resourceId
  );

  if (!summary) {
    return c.json(
      {
        type: 'https://api.zerostress.io/problems/not-found',
        title: 'Host Pool not found',
        status: 404,
      },
      404
    );
  }

  return c.json(summary);
});

// ============================================
// Session Hosts
// ============================================

app.get('/host-pools/:resourceId/session-hosts', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const resourceId = toArmResourceId(c.req.param('resourceId'));
  const provider = getAvdProvider();

  const sessionHosts = await provider.listSessionHosts(
    {
      tenantId: tenant.id,
      correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
    },
    resourceId
  );

  return c.json({ items: sessionHosts });
});

app.get(
  '/host-pools/:resourceId/session-hosts/:sessionHostName',
  requireConnectedTenant,
  async (c) => {
    const tenant = c.get('tenant');
    const resourceId = toArmResourceId(c.req.param('resourceId'));
    const sessionHostName = c.req.param('sessionHostName');
    const provider = getAvdProvider();

    const sessionHost = await provider.getSessionHost(
      {
        tenantId: tenant.id,
        correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
      },
      resourceId,
      sessionHostName
    );

    if (!sessionHost) {
      return c.json(
        {
          type: 'https://api.zerostress.io/problems/not-found',
          title: 'Session Host not found',
          status: 404,
        },
        404
      );
    }

    return c.json(sessionHost);
  }
);

// ============================================
// User Sessions
// ============================================

app.get(
  '/host-pools/:resourceId/session-hosts/:sessionHostName/sessions',
  requireConnectedTenant,
  async (c) => {
    const tenant = c.get('tenant');
    const resourceId = toArmResourceId(c.req.param('resourceId'));
    const sessionHostName = c.req.param('sessionHostName');
    const provider = getAvdProvider();

    const sessions = await provider.listUserSessions(
      {
        tenantId: tenant.id,
        correlationId: c.req.header('X-Correlation-ID') ?? crypto.randomUUID(),
      },
      resourceId,
      sessionHostName
    );

    return c.json({ items: sessions });
  }
);

// ============================================
// Aktionen (als Jobs)
// ============================================

const setDrainModeSchema = z.object({
  hostPoolId: z.string(),
  hostPoolName: z.string(),
  sessionHostId: z.string(),
  sessionHostName: z.string(),
  allowNewSession: z.boolean(),
});

app.post(
  '/actions/set-drain-mode',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', setDrainModeSchema),
  async (c) => {
    const auth = c.get('auth');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const queue = getJobQueue();

    const job = await queue.createJob({
      type: 'avd.set-drain-mode',
      tenantId: tenant.id,
      mspId: auth.mspId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      payload: {
        hostPoolId: body.hostPoolId,
        hostPoolName: body.hostPoolName,
        sessionHostId: body.sessionHostId,
        sessionHostName: body.sessionHostName,
        allowNewSession: body.allowNewSession,
        targetType: 'session-host',
        targetId: body.sessionHostId,
        targetDisplayName: body.sessionHostName,
      },
    });

    return c.json(job, 202);
  }
);

// Bibliotheksskript auf einem Session-Host ueber Azure Run Command
const runScriptSchema = z.object({
  hostPoolId: z.string(),
  hostPoolName: z.string(),
  sessionHostId: z.string(),
  sessionHostName: z.string(),
  vmResourceId: z.string().min(1),
  scriptId: z.enum(['update-status', 'update-scan', 'system-info', 'winget-updates', 'network-info', 'storage-info']),
});

app.post('/actions/run-script', requireRole('engineer'), requireConnectedTenant, zValidator('json', runScriptSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const body = c.req.valid('json');
  const queue = getJobQueue();

  const job = await queue.createJob({
    type: 'avd.run-script',
    tenantId: tenant.id,
    mspId: auth.mspId,
    userId: auth.user.id,
    userEmail: auth.user.email,
    payload: {
      ...body,
      targetType: 'session-host',
      targetId: body.sessionHostId,
      targetDisplayName: `${body.sessionHostName} - ${body.scriptId}`,
    },
  });

  return c.json(job, 202);
});

const startStopSessionHostSchema = z.object({
  hostPoolId: z.string(),
  hostPoolName: z.string(),
  sessionHostId: z.string(),
  sessionHostName: z.string(),
  vmResourceId: z.string(),
});

app.post(
  '/actions/start-session-host',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', startStopSessionHostSchema),
  async (c) => {
    const auth = c.get('auth');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const queue = getJobQueue();

    const job = await queue.createJob({
      type: 'avd.start-session-host',
      tenantId: tenant.id,
      mspId: auth.mspId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      payload: {
        hostPoolId: body.hostPoolId,
        hostPoolName: body.hostPoolName,
        sessionHostId: body.sessionHostId,
        sessionHostName: body.sessionHostName,
        vmResourceId: body.vmResourceId,
        targetType: 'session-host',
        targetId: body.sessionHostId,
        targetDisplayName: body.sessionHostName,
      },
    });

    return c.json(job, 202);
  }
);

app.post(
  '/actions/stop-session-host',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', startStopSessionHostSchema.extend({ force: z.boolean().optional() })),
  async (c) => {
    const auth = c.get('auth');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const queue = getJobQueue();

    const job = await queue.createJob({
      type: 'avd.stop-session-host',
      tenantId: tenant.id,
      mspId: auth.mspId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      payload: {
        hostPoolId: body.hostPoolId,
        hostPoolName: body.hostPoolName,
        sessionHostId: body.sessionHostId,
        sessionHostName: body.sessionHostName,
        vmResourceId: body.vmResourceId,
        force: body.force ?? false,
        targetType: 'session-host',
        targetId: body.sessionHostId,
        targetDisplayName: body.sessionHostName,
      },
    });

    return c.json(job, 202);
  }
);

const disconnectSessionSchema = z.object({
  hostPoolId: z.string(),
  hostPoolName: z.string(),
  sessionHostId: z.string(),
  sessionHostName: z.string(),
  sessionId: z.string(),
  userPrincipalName: z.string(),
});

app.post(
  '/actions/disconnect-session',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', disconnectSessionSchema),
  async (c) => {
    const auth = c.get('auth');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const queue = getJobQueue();

    const job = await queue.createJob({
      type: 'avd.disconnect-session',
      tenantId: tenant.id,
      mspId: auth.mspId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      payload: {
        hostPoolId: body.hostPoolId,
        hostPoolName: body.hostPoolName,
        sessionHostId: body.sessionHostId,
        sessionHostName: body.sessionHostName,
        sessionId: body.sessionId,
        userPrincipalName: body.userPrincipalName,
        targetType: 'user-session',
        targetId: body.sessionId,
        targetDisplayName: body.userPrincipalName,
      },
    });

    return c.json(job, 202);
  }
);

const logoffSessionSchema = disconnectSessionSchema.extend({
  force: z.boolean().optional(),
});

app.post(
  '/actions/logoff-session',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', logoffSessionSchema),
  async (c) => {
    const auth = c.get('auth');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const queue = getJobQueue();

    const job = await queue.createJob({
      type: 'avd.logoff-session',
      tenantId: tenant.id,
      mspId: auth.mspId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      payload: {
        hostPoolId: body.hostPoolId,
        hostPoolName: body.hostPoolName,
        sessionHostId: body.sessionHostId,
        sessionHostName: body.sessionHostName,
        sessionId: body.sessionId,
        userPrincipalName: body.userPrincipalName,
        force: body.force ?? false,
        targetType: 'user-session',
        targetId: body.sessionId,
        targetDisplayName: body.userPrincipalName,
      },
    });

    return c.json(job, 202);
  }
);

const sendMessageSchema = z.object({
  hostPoolId: z.string(),
  hostPoolName: z.string(),
  sessionHostId: z.string(),
  sessionHostName: z.string(),
  sessionId: z.string(),
  userPrincipalName: z.string(),
  messageTitle: z.string().min(1).max(100),
  messageBody: z.string().min(1).max(1000),
});

app.post(
  '/actions/send-message',
  requireRole('engineer'),
  requireConnectedTenant,
  zValidator('json', sendMessageSchema),
  async (c) => {
    const auth = c.get('auth');
    const tenant = c.get('tenant');
    const body = c.req.valid('json');
    const queue = getJobQueue();

    const job = await queue.createJob({
      type: 'avd.send-message',
      tenantId: tenant.id,
      mspId: auth.mspId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      payload: {
        hostPoolId: body.hostPoolId,
        hostPoolName: body.hostPoolName,
        sessionHostId: body.sessionHostId,
        sessionHostName: body.sessionHostName,
        sessionId: body.sessionId,
        userPrincipalName: body.userPrincipalName,
        messageTitle: body.messageTitle,
        messageBody: body.messageBody,
        targetType: 'user-session',
        targetId: body.sessionId,
        targetDisplayName: body.userPrincipalName,
      },
    });

    return c.json(job, 202);
  }
);

export { app as avdRouter };
