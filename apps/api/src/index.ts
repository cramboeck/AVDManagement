/**
 * ZeroStress Cockpit API
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler } from './middleware/error-handler.js';
import { tenantsRouter } from './routes/tenants.js';
import { usersRouter } from './routes/users.js';
import { jobsRouter } from './routes/jobs.js';
import { auditRouter } from './routes/audit.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    credentials: true,
  })
);

// Error-Handler
app.onError(errorHandler);

// Health-Check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API-Info
app.get('/', (c) => {
  return c.json({
    name: 'ZeroStress Cockpit API',
    version: '0.1.0',
    docs: '/docs',
  });
});

// Routen
app.route('/tenants', tenantsRouter);
app.route('/tenants/:tenantId/users', usersRouter);
app.route('/jobs', jobsRouter);
app.route('/audit', auditRouter);

// Session-Info (fuer Frontend)
app.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ authenticated: false });
  }

  // Token validieren (vereinfacht)
  return c.json({
    authenticated: true,
    // User-Daten werden vom authMiddleware gesetzt
  });
});

// Server starten
const port = parseInt(process.env.API_PORT ?? '3001', 10);

console.log(`Starting ZeroStress API on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`ZeroStress API running at http://localhost:${port}`);
