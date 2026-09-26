/**
 * winget-Katalog: Aufloesung fuer das Paketformular, Basis-Set, Blaettern
 * nach Herausgeber, naechtliche Versionspruefung und "neue Version anlegen".
 */

import { eq } from 'drizzle-orm';
import { WingetClient, WingetError, WINGET_BASE_SET, newestVersion } from '@zerostress/core';
import type { AppManifest, AppPackage, PackageArchitecture, WingetCatalogEntry, WingetResolution } from '@zerostress/types';
import { db, appPackages } from '../db/index.js';
import { createPackage, getPackage, listWingetPackagesForCheck, setLatestVersion } from './packages.js';
import { enqueueBuild } from './builds.js';

// Einmal am Tag reicht; Pakete, die juenger geprueft wurden, werden uebersprungen
export const VERSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;

let client: WingetClient | null = null;

export function getWingetClient(): WingetClient {
  if (!client) client = new WingetClient({ githubToken: process.env.GITHUB_TOKEN || null });
  return client;
}

export function baseSet(): WingetCatalogEntry[] {
  return WINGET_BASE_SET;
}

export function resolveWinget(id: string, version: string | null, architecture: PackageArchitecture): Promise<WingetResolution> {
  return getWingetClient().resolve(id.trim(), version?.trim() || 'latest', architecture);
}

export function browsePublisher(publisher: string): Promise<string[]> {
  return getWingetClient().browsePublisher(publisher);
}

/**
 * Manifest-Vorschlag aus der Katalogaufloesung; der Nutzer kann alles im
 * Formular noch aendern.
 */
export function manifestFromResolution(r: WingetResolution, architecture: PackageArchitecture): Partial<AppManifest> {
  return {
    installerType: 'winget',
    vendor: r.publisher.replace(/[^A-Za-z0-9 ._+()-]/g, '').slice(0, 80) || r.packageIdentifier.split('.')[0],
    name: r.name.replace(/[^A-Za-z0-9 ._+()-]/g, '').slice(0, 80) || r.packageIdentifier.split('.').slice(1).join(' '),
    version: r.version.replace(/[^0-9A-Za-z.-]/g, '').slice(0, 40),
    architecture,
    installerFileName: r.installer.fileName,
    msiProductCode: r.installer.productCode,
    publisher: r.publisher,
    description: r.description ?? undefined,
    informationUrl: r.homepage,
    wingetPackageIdentifier: r.packageIdentifier,
    wingetVersion: 'latest',
    sourceInstaller: r.installer,
    requirements: { minimumWindowsRelease: '1809', architecture: architecture === 'x86' ? 'x86' : 'x64', minDiskMb: null, minRamMb: null },
  };
}

/** Katalogversion eines Pakets pruefen und merken. */
export async function checkPackageVersion(mspId: string, packageId: string): Promise<{ current: string; latest: string | null; newer: boolean }> {
  const pkg = await getPackage(mspId, packageId);
  if (!pkg) throw new Error('Package not found');
  if (pkg.manifest.installerType !== 'winget' || !pkg.manifest.wingetPackageIdentifier) throw new Error('Nur winget-Pakete haben eine Katalogversion');
  const versions = await getWingetClient().listVersions(pkg.manifest.wingetPackageIdentifier);
  const latest = newestVersion(versions);
  await setLatestVersion(packageId, latest, new Date());
  return { current: pkg.manifest.version, latest, newer: latest !== null && latest !== pkg.manifest.version && isNewer(latest, pkg.manifest.version) };
}

function isNewer(candidate: string, current: string): boolean {
  const split = (v: string) => v.split(/[.\-+]/).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  const a = split(candidate);
  const b = split(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return false;
    if (y === undefined) return true;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x > y;
    } else {
      const c = String(x).localeCompare(String(y), undefined, { numeric: true });
      if (c !== 0) return c > 0;
    }
  }
  return false;
}

/**
 * Neue Version als eigenes Paket anlegen: Manifest kopieren, Installer neu
 * aufloesen, Build sofort einreihen. Rollout bleibt ein eigener Schritt.
 */
export async function createNewVersion(mspId: string, userId: string, packageId: string, version: string | null): Promise<AppPackage> {
  const pkg = await getPackage(mspId, packageId);
  if (!pkg) throw new Error('Package not found');
  const m = pkg.manifest;
  if (m.installerType !== 'winget' || !m.wingetPackageIdentifier) throw new Error('Nur winget-Pakete koennen eine neue Version aus dem Katalog ziehen');
  const resolution = await resolveWinget(m.wingetPackageIdentifier, version, m.architecture);
  if (resolution.version === m.version) throw new WingetError(`Version ${m.version} ist bereits das aktuelle Paket`, 'invalid');
  const draft: Record<string, unknown> = {
    ...m,
    version: resolution.version,
    installerFileName: resolution.installer.fileName,
    msiProductCode: resolution.installer.productCode,
    sourceInstaller: resolution.installer,
    notes: m.notes ? `${m.notes}\nNachfolger von ${packageIdentifierOf(m)}` : `Nachfolger von ${packageIdentifierOf(m)}`,
  };
  const created = await createPackage(mspId, userId, draft);
  await setLatestVersion(packageId, resolution.version, new Date());
  try {
    await enqueueBuild(mspId, created.id);
  } catch {
    // Ohne Worker bleibt das Paket mit Installerquelle stehen; Build spaeter von Hand
  }
  return (await getPackage(mspId, created.id)) as AppPackage;
}

function packageIdentifierOf(m: AppManifest): string {
  return `${m.vendor} ${m.name} ${m.version}`;
}

/**
 * Naechtlicher Durchlauf: je winget-Paket hoechstens einmal am Tag die
 * Katalogversion lesen. Bei Ratenlimit sofort abbrechen, naechste Stunde weiter.
 */
export async function runVersionSweep(now = new Date()): Promise<{ checked: number; newer: number }> {
  const due = (await listWingetPackagesForCheck()).filter((p) => !p.latestCheckedAt || now.getTime() - p.latestCheckedAt.getTime() >= VERSION_CHECK_INTERVAL_MS);
  let checked = 0;
  let newer = 0;
  for (const p of due) {
    try {
      const result = await checkPackageVersion(p.mspId, p.id);
      checked += 1;
      if (result.newer) newer += 1;
    } catch (error) {
      if (error instanceof WingetError && error.code === 'rate-limited') break;
      // Einzelfehler (Paket entfernt, Netz) nicht durchreichen; naechster Tag
      await db.update(appPackages).set({ latestCheckedAt: now }).where(eq(appPackages.id, p.id));
    }
  }
  return { checked, newer };
}

let timer: NodeJS.Timeout | null = null;

export function startVersionSweep(): void {
  if (timer) return;
  const tick = () =>
    runVersionSweep()
      .then((r) => {
        if (r.checked > 0) console.log(`winget version sweep: ${r.checked} checked, ${r.newer} newer`);
      })
      .catch((error: Error) => console.error('winget version sweep failed:', error.message));
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  // Erster Lauf kurz nach dem Start, damit der Katalogstand nicht einen Tag alt ist
  setTimeout(tick, 60 * 1000).unref();
}
