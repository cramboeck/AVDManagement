/**
 * Software eines Geraets dem winget-Katalog zuordnen: verfuegbares Update
 * (aus dem Skript winget-updates), Katalogtreffer (eigene Pakete, Basis-Set),
 * winget-Id aus dem Inventar (Skript winget-inventory) und Sperrregel.
 *
 * Fachlogik fuer die Geraeteseite; die Oberflaeche zeigt nur an.
 */

import type { DetectedApp, DeviceSoftwareMatch, DeviceWingetUpdate, SoftwareBlockRule, WingetCatalogEntry } from '@zerostress/types';
import { matchBlockRule, matchWingetId, normaliseName, type CatalogPackageRef } from './software-catalog.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

/** Updates aus der Ausgabe von winget-updates (Schema zsc.winget-updates/1). */
export function wingetUpdatesFromOutput(outputJson: Record<string, unknown> | null | undefined): DeviceWingetUpdate[] {
  if (!outputJson || outputJson.schema !== 'zsc.winget-updates/1' || !Array.isArray(outputJson.updates)) return [];
  return outputJson.updates
    .map(asRecord)
    .filter((u): u is Record<string, unknown> => u !== null)
    .map((u) => ({ name: text(u.name), id: text(u.id), installed: text(u.installed), available: text(u.available) }));
}

/** Paket-Ids aus der Ausgabe von winget-inventory (Schema zsc.winget-inventory/1, ";"-getrennt). */
export function wingetInventoryFromOutput(outputJson: Record<string, unknown> | null | undefined): { ids: string[]; truncated: boolean } {
  if (!outputJson || outputJson.schema !== 'zsc.winget-inventory/1') return { ids: [], truncated: false };
  const ids = typeof outputJson.ids === 'string' ? outputJson.ids.split(';').map((x) => x.trim()).filter(Boolean) : [];
  return { ids, truncated: outputJson.truncated === true };
}

/** winget kennt Ids, Intune Anzeigenamen; ein Treffer ueber den Namen reicht fuer die Markierung. */
export function matchWingetUpdate(displayName: string, updates: DeviceWingetUpdate[]): DeviceWingetUpdate | null {
  const appName = normaliseName(displayName);
  if (appName.length < 3) return null;
  for (const update of updates) {
    const name = normaliseName(update.name.replace(/\.\.\.$/, ''));
    const idTail = normaliseName(update.id.split('.').slice(1).join(' '));
    if (name.length >= 4 && (appName.includes(name) || name.includes(appName))) return update;
    if (idTail.length >= 4 && appName.includes(idTail)) return update;
  }
  return null;
}

/** Inventar-Id (aus winget list) ueber den Namensteil der Id zuordnen. */
export function matchInventoryId(displayName: string, ids: string[]): string | null {
  const appName = normaliseName(displayName);
  if (appName.length < 3) return null;
  for (const id of ids) {
    const tail = normaliseName(id.split('.').slice(1).join(' '));
    const head = normaliseName(id.split('.')[0] ?? '');
    if (tail.length >= 4 && (appName.includes(tail) || tail.includes(appName))) return id;
    if (head.length >= 4 && tail.length >= 3 && appName.includes(head) && appName.includes(tail)) return id;
  }
  return null;
}

export interface DeviceSoftwareContext {
  updates: DeviceWingetUpdate[];
  inventoryIds: string[];
  packages: CatalogPackageRef[];
  baseSet: WingetCatalogEntry[];
  rules: SoftwareBlockRule[];
}

export function matchDeviceSoftware(app: Pick<DetectedApp, 'displayName'>, ctx: DeviceSoftwareContext): DeviceSoftwareMatch {
  const update = matchWingetUpdate(app.displayName, ctx.updates);
  const hit = matchWingetId(app.displayName, ctx.packages, ctx.baseSet);
  const pkg = hit?.packageId ? ctx.packages.find((p) => p.id === hit.packageId) ?? null : null;
  const entry = hit && !pkg ? ctx.baseSet.find((e) => e.id === hit.wingetId) ?? null : null;
  const catalog = hit ? { id: hit.wingetId, name: pkg?.name ?? entry?.name ?? hit.wingetId, packageId: pkg?.id ?? null, packageVersion: pkg?.version ?? null } : null;
  const wingetId = update?.id ?? matchInventoryId(app.displayName, ctx.inventoryIds) ?? null;
  const blocked = matchBlockRule(app.displayName, wingetId ?? catalog?.id ?? null, ctx.rules);
  return {
    update,
    catalog,
    wingetId,
    wingetState: update ? 'update' : catalog || wingetId ? 'catalog' : 'none',
    blockedBy: blocked ? blocked.pattern : null,
  };
}
