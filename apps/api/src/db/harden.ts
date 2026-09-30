/**
 * db/harden.sql gegen DATABASE_URL ausfuehren (npm run db:harden)
 *
 * Getrennt von drizzle-kit push, weil drizzle keine Trigger verwaltet.
 * Nach jedem push erneut ausfuehren ist unschaedlich (idempotent).
 */

import '../env.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const sqlFile = resolve(here, '..', '..', 'db', 'harden.sql');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 1 });
  try {
    const script = readFileSync(sqlFile, 'utf8');
    await sql.unsafe(script);
    const triggers = await sql`select tgname from pg_trigger where tgrelid = 'audit_entries'::regclass and not tgisinternal`;
    console.log(`Audit hardening applied; triggers: ${triggers.map((t) => t.tgname).join(', ')}`);
  } finally {
    await sql.end();
  }
}

main().catch((error: Error) => {
  console.error('db:harden failed:', error.message);
  process.exit(1);
});
