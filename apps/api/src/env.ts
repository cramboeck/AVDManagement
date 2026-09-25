/**
 * ENV-Loader. Muss der ERSTE Import in index.ts sein.
 *
 * ES-Module werten alle statischen Imports aus, bevor der Top-Level-Code
 * einer Datei laeuft. dotenv darf deshalb nicht inline in index.ts stehen,
 * sonst lesen db/index.ts und die Routen ihre Variablen vor dem Laden.
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Beim Start via npm-Workspace ist cwd apps/api, nicht das Monorepo-Root.
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const candidates = ['.env.local', '.env'].map((name) => resolve(monorepoRoot, name));
const envFile = candidates.find((path) => existsSync(path));

if (envFile) {
  config({ path: envFile });
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

const devAuthBypass = process.env.DEV_AUTH_BYPASS === 'true';

if (devAuthBypass && process.env.NODE_ENV === 'production') {
  throw new Error('DEV_AUTH_BYPASS must not be enabled in production');
}

const required = ['DATABASE_URL', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_TENANT_ID', 'JWT_SECRET'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  const hint = envFile ? `loaded ${envFile}` : `no .env.local or .env found in ${monorepoRoot}`;
  throw new Error(`Missing environment variables: ${missing.join(', ')} (${hint})`);
}

if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET === 'dev-secret-change-in-production') {
  throw new Error('JWT_SECRET still has the example value; generate one with: openssl rand -base64 32');
}

console.log(`Environment: ${envFile ?? 'process env only'}${devAuthBypass ? ' (DEV_AUTH_BYPASS active)' : ''}`);
