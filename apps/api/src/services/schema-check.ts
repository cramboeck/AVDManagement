/**
 * Schema-Pruefung beim Start: fehlen Tabellen oder Spalten, die der Code
 * voraussetzt, meldet die API das einmal deutlich statt bei jedem Aufruf
 * mit "column ... does not exist" zu scheitern. Das Schema wird mit
 * `npm run db:push` angeglichen; die API fuehrt keine Migration selbst aus.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/** Spalten, die in juengeren Schemaaenderungen hinzugekommen sind. */
const REQUIRED_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['inventory_snapshots', 'unavailable'],
  ['alerts', 'id'],
  ['app_packages', 'id'],
  ['app_packages', 'latest_version'],
  ['app_deployments', 'id'],
  ['build_jobs', 'id'],
  ['cve_explanations', 'cve_id'],
];

export interface SchemaCheckResult {
  ok: boolean;
  missing: string[];
}

let lastResult: SchemaCheckResult | null = null;

export async function checkSchema(): Promise<SchemaCheckResult> {
  const rows = (await db.execute(sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = current_schema()
  `)) as unknown as Array<{ table_name: string; column_name: string }>;
  const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  const missing = REQUIRED_COLUMNS.filter(([table, column]) => !present.has(`${table}.${column}`)).map(([table, column]) => `${table}.${column}`);
  lastResult = { ok: missing.length === 0, missing };
  return lastResult;
}

export function getSchemaHealth(): SchemaCheckResult | null {
  return lastResult;
}

/** Beim Start aufrufen; ein Fehler der Pruefung selbst bricht den Start nicht ab. */
export async function reportSchemaAtStartup(): Promise<void> {
  try {
    const result = await checkSchema();
    if (result.ok) return;
    console.error('Database schema is behind the code. Missing: ' + result.missing.join(', '));
    console.error('Run "npm run db:push" in the repository root, then restart the API.');
  } catch (error) {
    console.error('Schema check failed:', error instanceof Error ? error.message : String(error));
  }
}
