/**
 * ZeroStress Cockpit API
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Monorepo-Root finden (von apps/api/src aus: 3 Ebenen hoch)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const monorepoRoot = resolve(__dirname, '..', '..', '..');

// .env.local hat Prioritaet, dann .env (im Monorepo-Root)
const envLocalPath = resolve(monorepoRoot, '.env.local');
const envPath = resolve(monorepoRoot, '.env');

if (existsSync(envLocalPath)) {
  console.log('Loading .env.local from:', envLocalPath);
  config({ path: envLocalPath });
} else if (existsSync(envPath)) {
  console.log('Loading .env from:', envPath);
  config({ path: envPath });
} else {
  console.log('No .env file found in:', monorepoRoot);
}

console.log('DEV_AUTH_BYPASS:', process.env.DEV_AUTH_BYPASS);

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler } from './middleware/error-handler.js';
import { tenantsRouter } from './routes/tenants.js';
import { usersRouter } from './routes/users.js';
import { jobsRouter } from './routes/jobs.js';
import { auditRouter } from './routes/audit.js';
import { licensesRouter } from './routes/licenses.js';
import { avdRouter } from './routes/avd.js';
import { authRouter } from './routes/auth.js';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: [
      process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3002',
      'http://localhost:3000',
      'http://localhost:3002',
    ],
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

// Auth-Routen (ohne Auth-Middleware)
app.route('/auth', authRouter);

// Dev-Mode: Unauthenticated tenant list for testing
if (process.env.NODE_ENV !== 'production') {
  app.get('/dev/tenants', async (c) => {
    const { db, managedTenants } = await import('./db/index.js');
    const tenants = await db.query.managedTenants.findMany({
      limit: 20,
    });
    return c.json({ items: tenants });
  });
}

// Routen
app.route('/tenants', tenantsRouter);
app.route('/tenants/:tenantId/users', usersRouter);
app.route('/tenants/:tenantId/jobs', jobsRouter);
app.route('/tenants/:tenantId/licenses', licensesRouter);
app.route('/tenants/:tenantId/audit', auditRouter);
app.route('/tenants/:tenantId/avd', avdRouter);

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
