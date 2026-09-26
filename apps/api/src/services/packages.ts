/**
 * Paketkatalog: Manifest, Artefakt, Installer und Deployments je MSP
 */

import { Readable } from 'node:stream';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { detectionKeyPath, normalizeManifest, packageIdentifier, usesWrapper } from '@zerostress/core';
import type { AppDeployment, AppManifest, AppPackage, DeploymentStatus, PackageStatus, StoredFile, TenantId } from '@zerostress/types';
import { db, appPackages, appDeployments, managedTenants, mspUsers } from '../db/index.js';
import { getArtifactStore } from './artifact-store.js';

type PackageRow = typeof appPackages.$inferSelect;
type DeploymentRow = typeof appDeployments.$inferSelect;

export function detectionPrefix(): string {
  const raw = process.env.APP_DETECTION_PREFIX ?? 'ZSC';
  return raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'ZSC';
}

function toDeployment(row: DeploymentRow, tenantName: string): AppDeployment {
  return {
    id: row.id,
    packageId: row.packageId,
    tenantId: row.tenantId as TenantId,
    tenantDisplayName: tenantName,
    intuneAppId: row.intuneAppId,
    contentVersion: row.contentVersion,
    status: row.status as DeploymentStatus,
    error: row.error,
    jobId: row.jobId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function toPackage(row: PackageRow, createdByEmail: string, deployments: AppDeployment[]): Promise<AppPackage> {
  return {
    id: row.id,
    manifest: row.manifest as AppManifest,
    status: row.status as PackageStatus,
    artifact: (row.artifact as StoredFile | null) ?? null,
    installer: (row.installer as StoredFile | null) ?? null,
    buildLog: row.buildLog,
    buildError: row.buildError,
    detectionKeyPath: row.detectionKeyPath,
    latestVersion: row.latestVersion,
    latestCheckedAt: row.latestCheckedAt?.toISOString() ?? null,
    createdByEmail,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deployments,
  };
}

async function loadDeployments(packageIds: string[]): Promise<Map<string, AppDeployment[]>> {
  const map = new Map<string, AppDeployment[]>();
  if (packageIds.length === 0) return map;
  const rows = await db
    .select({ deployment: appDeployments, tenantName: managedTenants.displayName })
    .from(appDeployments)
    .innerJoin(managedTenants, eq(managedTenants.id, appDeployments.tenantId))
    .where(inArray(appDeployments.packageId, packageIds));
  for (const r of rows) {
    const list = map.get(r.deployment.packageId) ?? [];
    list.push(toDeployment(r.deployment, r.tenantName));
    map.set(r.deployment.packageId, list);
  }
  return map;
}

export async function listPackages(mspId: string): Promise<AppPackage[]> {
  const rows = await db
    .select({ pkg: appPackages, email: mspUsers.email })
    .from(appPackages)
    .innerJoin(mspUsers, eq(mspUsers.id, appPackages.createdBy))
    .where(eq(appPackages.mspId, mspId))
    .orderBy(desc(appPackages.updatedAt));
  const deployments = await loadDeployments(rows.map((r) => r.pkg.id));
  return Promise.all(rows.map((r) => toPackage(r.pkg, r.email, deployments.get(r.pkg.id) ?? [])));
}

export async function getPackage(mspId: string, packageId: string): Promise<AppPackage | null> {
  const [row] = await db
    .select({ pkg: appPackages, email: mspUsers.email })
    .from(appPackages)
    .innerJoin(mspUsers, eq(mspUsers.id, appPackages.createdBy))
    .where(and(eq(appPackages.mspId, mspId), eq(appPackages.id, packageId)));
  if (!row) return null;
  const deployments = await loadDeployments([row.pkg.id]);
  return toPackage(row.pkg, row.email, deployments.get(row.pkg.id) ?? []);
}

function initialStatus(manifest: AppManifest): PackageStatus {
  // store braucht kein Artefakt; winget hat den Installer aus dem Katalog; der Rest wartet auf Upload
  if (manifest.installerType === 'store') return 'ready';
  if (manifest.installerType === 'winget') return 'installer-uploaded';
  return 'draft';
}

export async function createPackage(mspId: string, userId: string, input: Record<string, unknown>): Promise<AppPackage> {
  const manifest = normalizeManifest(input as Partial<AppManifest> & Record<string, unknown>);
  const [row] = await db
    .insert(appPackages)
    .values({
      mspId,
      manifest,
      status: initialStatus(manifest),
      detectionKeyPath: usesWrapper(manifest) ? detectionKeyPath(detectionPrefix(), manifest) : null,
      createdBy: userId,
    })
    .returning();
  return (await getPackage(mspId, row.id)) as AppPackage;
}

export async function updateManifest(mspId: string, packageId: string, input: Record<string, unknown>): Promise<AppPackage | null> {
  const existing = await getPackage(mspId, packageId);
  if (!existing) return null;
  const manifest = normalizeManifest(input as Partial<AppManifest> & Record<string, unknown>);
  // Bezeichner aendern hiesse: neues Paket. Version, Vendor, Name bleiben nach dem ersten Artefakt fest.
  if (existing.artifact && packageIdentifier(manifest) !== packageIdentifier(existing.manifest)) {
    throw new Error('Vendor, Name, Version, Sprache, Revision und Architektur sind nach dem Upload fest; fuer eine neue Version ein neues Paket anlegen');
  }
  await db
    .update(appPackages)
    .set({
      manifest,
      detectionKeyPath: usesWrapper(manifest) ? detectionKeyPath(detectionPrefix(), manifest) : null,
      status: existing.status === 'draft' ? initialStatus(manifest) : existing.status,
      updatedAt: new Date(),
    })
    .where(eq(appPackages.id, packageId));
  return getPackage(mspId, packageId);
}

export async function deletePackage(mspId: string, packageId: string): Promise<boolean> {
  const existing = await getPackage(mspId, packageId);
  if (!existing) return false;
  const store = getArtifactStore();
  for (const file of [existing.artifact, existing.installer]) {
    if (file) await store.delete(file.storageKey).catch(() => undefined);
  }
  await db.delete(appPackages).where(eq(appPackages.id, packageId));
  return true;
}

function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.{2,}/g, '')
    .replace(/^[._]+/, '')
    .trim();
  return !cleaned || /^\.+$/.test(cleaned) ? 'file.bin' : cleaned.slice(0, 200);
}

/**
 * Datei ablegen: kind artifact = fertiges .intunewin, installer = Roh-Installer fuer den Worker.
 */
export async function storeFile(mspId: string, packageId: string, kind: 'artifact' | 'installer', fileName: string, body: Readable): Promise<AppPackage> {
  const existing = await getPackage(mspId, packageId);
  if (!existing) throw new Error('Package not found');
  const name = safeFileName(fileName);
  if (kind === 'artifact' && !name.toLowerCase().endsWith('.intunewin')) throw new Error('Artefakt muss eine .intunewin-Datei sein');
  if (kind === 'installer' && !/\.(msi|exe|zip)$/i.test(name)) throw new Error('Installer muss msi, exe oder zip sein');

  const store = getArtifactStore();
  const storageKey = `packages/${packageId}/${kind}/${name}`;
  const stored = await store.put(storageKey, body);
  const previous = kind === 'artifact' ? existing.artifact : existing.installer;
  if (previous && previous.storageKey !== storageKey) await store.delete(previous.storageKey).catch(() => undefined);

  const file: StoredFile = { fileName: name, sha256: stored.sha256, sizeBytes: stored.sizeBytes, storageKey, uploadedAt: new Date().toISOString() };
  const patch: Partial<typeof appPackages.$inferInsert> = { updatedAt: new Date() };
  if (kind === 'artifact') {
    patch.artifact = file;
    patch.status = 'ready';
    patch.buildError = null;
  } else {
    patch.installer = file;
    if (existing.status === 'draft' || existing.status === 'failed') patch.status = 'installer-uploaded';
    // Manifest merkt sich den Dateinamen, damit Kommandozeilen und Worker denselben Namen nutzen
    if (!existing.manifest.installerFileName || existing.manifest.installerFileName !== name) {
      patch.manifest = { ...existing.manifest, installerFileName: name };
    }
  }
  await db.update(appPackages).set(patch).where(eq(appPackages.id, packageId));
  return (await getPackage(mspId, packageId)) as AppPackage;
}

export async function openFile(mspId: string, packageId: string, kind: 'artifact' | 'installer'): Promise<{ file: StoredFile; stream: Readable } | null> {
  const existing = await getPackage(mspId, packageId);
  const file = kind === 'artifact' ? existing?.artifact : existing?.installer;
  if (!existing || !file) return null;
  return { file, stream: await getArtifactStore().get(file.storageKey) };
}

export async function upsertDeployment(
  mspId: string,
  packageId: string,
  tenantId: string,
  patch: Partial<{ intuneAppId: string | null; contentVersion: string | null; status: DeploymentStatus; error: string | null; jobId: string | null; publishedAt: Date | null }>
): Promise<void> {
  const existing = await db.query.appDeployments.findFirst({ where: and(eq(appDeployments.packageId, packageId), eq(appDeployments.tenantId, tenantId)) });
  if (existing) {
    await db.update(appDeployments).set({ ...patch, updatedAt: new Date() }).where(eq(appDeployments.id, existing.id));
    return;
  }
  await db.insert(appDeployments).values({ mspId, packageId, tenantId, status: patch.status ?? 'pending', intuneAppId: patch.intuneAppId ?? null, contentVersion: patch.contentVersion ?? null, error: patch.error ?? null, jobId: patch.jobId ?? null, publishedAt: patch.publishedAt ?? null });
}

export async function setLatestVersion(packageId: string, latestVersion: string | null, checkedAt: Date): Promise<void> {
  await db.update(appPackages).set({ latestVersion, latestCheckedAt: checkedAt }).where(eq(appPackages.id, packageId));
}

/** Alle winget-Pakete (MSP-uebergreifend) fuer die naechtliche Versionspruefung. */
export async function listWingetPackagesForCheck(): Promise<Array<{ id: string; mspId: string; manifest: AppManifest; latestCheckedAt: Date | null }>> {
  const rows = await db.select({ id: appPackages.id, mspId: appPackages.mspId, manifest: appPackages.manifest, latestCheckedAt: appPackages.latestCheckedAt }).from(appPackages);
  return rows.map((r) => ({ id: r.id, mspId: r.mspId, manifest: r.manifest as AppManifest, latestCheckedAt: r.latestCheckedAt })).filter((r) => r.manifest.installerType === 'winget');
}

export async function getDeployment(packageId: string, tenantId: string): Promise<DeploymentRow | null> {
  return (await db.query.appDeployments.findFirst({ where: and(eq(appDeployments.packageId, packageId), eq(appDeployments.tenantId, tenantId)) })) ?? null;
}
