/**
 * Hash-Kette fuer das Audit-Log
 *
 * Jeder Eintrag traegt den Hash seines Vorgaengers (je MSP) und seinen
 * eigenen Hash ueber die fachlichen Felder. Wird ein Eintrag nachtraeglich
 * geaendert oder entfernt, stimmt die Kette ab dieser Stelle nicht mehr.
 * Reine Funktionen, damit die Pruefung ohne Datenbank testbar ist.
 */

import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainedFields {
  mspId: string;
  tenantId: string | null;
  timestamp: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  targetDisplayName: string | null;
  beforeState: unknown;
  afterState: unknown;
  result: string;
  errorMessage: string | null;
  correlationId: string;
}

/** Stabile Serialisierung: Schluessel sortiert, undefined weggelassen. */
export function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeEntryHash(prevHash: string, fields: ChainedFields): string {
  return createHash('sha256').update(`${prevHash}|${canonical(fields)}`).digest('hex');
}
