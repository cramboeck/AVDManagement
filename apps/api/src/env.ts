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

// Secrets (Client-Secret oder Zertifikat, JWT_SECRET) duerfen auch aus dem Key Vault kommen;
// das prueft index.ts nach dem Laden. Hier nur, was sofort gebraucht wird.
const required = ['DATABASE_URL', 'ENTRA_CLIENT_ID', 'ENTRA_TENANT_ID'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  const hint = envFile ? `loaded ${envFile}` : `no .env.local or .env found in ${monorepoRoot}`;
  throw new Error(`Missing environment variables: ${missing.join(', ')} (${hint})`);
}

/** Nach dem Laden aus dem Key Vault: Anmeldedaten und Signierschluessel muessen da sein. */
export function assertSecretsPresent(): void {
  const problems: string[] = [];
  if (!process.env.ENTRA_CLIENT_SECRET && !process.env.ENTRA_CLIENT_CERTIFICATE_PEM && !process.env.ENTRA_CLIENT_CERTIFICATE_PATH) {
    problems.push('ENTRA_CLIENT_CERTIFICATE_PEM/PATH or ENTRA_CLIENT_SECRET');
  }
  if (!process.env.JWT_SECRET) problems.push('JWT_SECRET');
  if (problems.length > 0) {
    throw new Error(`Missing secrets: ${problems.join(', ')} (set them in the environment or provide KEY_VAULT_URL)`);
  }
  if (process.env.NODE_ENV === 'production' && process.env.ENTRA_CLIENT_SECRET && !process.env.ENTRA_CLIENT_CERTIFICATE_PEM && !process.env.ENTRA_CLIENT_CERTIFICATE_PATH) {
    console.warn('ENTRA_CLIENT_SECRET in use; a client certificate is recommended for production (see docs/setup/local-development.md)');
  }
}

if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET === 'dev-secret-change-in-production') {
  throw new Error('JWT_SECRET still has the example value; generate one with: openssl rand -base64 32');
}

console.log(`Environment: ${envFile ?? 'process env only'}${devAuthBypass ? ' (DEV_AUTH_BYPASS active)' : ''}`);
