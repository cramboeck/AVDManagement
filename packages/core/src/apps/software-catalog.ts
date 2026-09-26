/**
 * Abgleich des Softwareinventars mit dem winget-Katalog
 *
 * Intune kennt Anzeigenamen, winget kennt Ids. Der Abgleich laeuft ueber
 * normalisierte Namen gegen die eigenen Pakete und das Basis-Set; die
 * neueste Katalogversion kommt aus einem Cache (Paket oder taeglich
 * aufgeloeste Basis-Set-Ids). Daraus entsteht je Software eine Zeile mit
 * Versionen, Geraetezahl, Katalogstand und Sperre.
 */

import type { SoftwareBlockRule, SoftwareCatalogStatus, SoftwareInventoryItem, SoftwareOverviewRow, SoftwareOverviewSet, WingetCatalogEntry } from '@zerostress/types';
import { compareVersions } from './winget.js';

export interface CatalogPackageRef {
  id: string;
  name: string;
  wingetId: string;
  version: string;
  latestVersion: string | null;
}

export function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Namensteil einer winget-Id (alles nach dem Herausgeber). */
function idTail(id: string): string {
  return normaliseName(id.split('.').slice(1).join(' '));
}

/**
 * Anzeigename einer Software einer winget-Id zuordnen: erst eigene Pakete,
 * dann Basis-Set. Kurze Namen werden nicht zugeordnet, um Fehltreffer zu vermeiden.
 */
export function matchWingetId(displayName: string, packages: CatalogPackageRef[], baseSet: WingetCatalogEntry[]): { wingetId: string; packageId: string | null } | null {
  const name = normaliseName(displayName);
  if (name.length < 3) return null;
  for (const p of packages) {
    const pn = normaliseName(p.name);
    if (pn.length >= 3 && (name.includes(pn) || pn.includes(name))) return { wingetId: p.wingetId, packageId: p.id };
  }
  for (const e of baseSet) {
    const en = normaliseName(e.name);
    const tail = idTail(e.id);
    if ((en.length >= 3 && (name.includes(en) || en.includes(name))) || (tail.length >= 4 && name.includes(tail))) return { wingetId: e.id, packageId: null };
  }
  return null;
}

/** Version des Inventars gegen die Katalogversion: nur numerische Praefixe vergleichen. */
export function versionStatus(installed: string | null, latest: string | null): SoftwareCatalogStatus {
  if (!installed || !latest) return 'unknown';
  const a = installed.match(/^\d+(\.\d+)*/)?.[0];
  const b = latest.match(/^\d+(\.\d+)*/)?.[0];
  if (!a || !b) return 'unknown';
  return compareVersions(a, b) < 0 ? 'outdated' : 'current';
}

export function matchBlockRule(displayName: string, wingetId: string | null, rules: SoftwareBlockRule[]): SoftwareBlockRule | null {
  const name = displayName.toLowerCase();
  for (const r of rules) {
    if (r.kind === 'winget-id' && wingetId && wingetId.toLowerCase() === r.pattern.toLowerCase()) return r;
    if (r.kind === 'name' && r.pattern.trim() && name.includes(r.pattern.trim().toLowerCase())) return r;
  }
  return null;
}

/**
 * Inventar zu Zeilen je Software (Name + Herausgeber) mit allen Versionen zusammenfassen.
 */
export function buildSoftwareOverview(
  items: SoftwareInventoryItem[],
  packages: CatalogPackageRef[],
  baseSet: WingetCatalogEntry[],
  latestVersions: Map<string, string | null>,
  rules: SoftwareBlockRule[]
): SoftwareOverviewSet {
  const groups = new Map<string, SoftwareOverviewRow>();
  for (const item of items) {
    const key = `${normaliseName(item.displayName)}|${normaliseName(item.publisher ?? '')}`;
    let row = groups.get(key);
    if (!row) {
      const match = matchWingetId(item.displayName, packages, baseSet);
      const pkg = match?.packageId ? packages.find((p) => p.id === match.packageId) : null;
      const latest = match ? (pkg?.latestVersion ?? pkg?.version ?? latestVersions.get(match.wingetId) ?? null) : null;
      row = {
        key,
        displayName: item.displayName,
        publisher: item.publisher,
        platform: item.platform,
        versions: [],
        deviceCount: 0,
        wingetId: match?.wingetId ?? null,
        packageId: match?.packageId ?? null,
        latestVersion: latest,
        status: 'unknown',
        outdatedDevices: 0,
        blockedBy: null,
      };
      row.blockedBy = matchBlockRule(item.displayName, row.wingetId, rules)?.pattern ?? null;
      groups.set(key, row);
    }
    row.versions.push({ id: item.id, version: item.version, deviceCount: item.deviceCount });
    row.deviceCount += item.deviceCount;
  }
  const rows = Array.from(groups.values()).map((row) => {
    row.versions.sort((a, b) => b.deviceCount - a.deviceCount);
    const statuses = row.versions.map((v) => versionStatus(v.version, row.latestVersion));
    row.outdatedDevices = row.versions.reduce((n, v, i) => n + (statuses[i] === 'outdated' ? v.deviceCount : 0), 0);
    row.status = statuses.includes('outdated') ? 'outdated' : statuses.includes('current') ? 'current' : 'unknown';
    return row;
  });
  rows.sort((a, b) => Number(!!b.blockedBy) - Number(!!a.blockedBy) || Number(b.status === 'outdated') - Number(a.status === 'outdated') || b.deviceCount - a.deviceCount || a.displayName.localeCompare(b.displayName, 'de'));
  return {
    rows,
    totals: {
      software: rows.length,
      matched: rows.filter((r) => r.wingetId).length,
      outdated: rows.filter((r) => r.status === 'outdated').length,
      blocked: rows.filter((r) => r.blockedBy).length,
    },
  };
}
