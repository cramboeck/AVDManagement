/**
 * Datenbank-Verbindung
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://zerostress:dev_password_only@localhost:5432/zerostress';

const client = postgres(connectionString);
export const db = drizzle(client, { schema });

export * from './schema.js';
