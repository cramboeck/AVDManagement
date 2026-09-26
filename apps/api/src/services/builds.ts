/**
 * Build-Auftraege fuer den Windows-Worker
 *
 * Die API baut nichts selbst. Sie legt Auftraege an, der Worker holt sie
 * per Claim (atomar, FOR UPDATE SKIP LOCKED), laedt den Installer, baut das
 * .intunewin, laedt es hoch und meldet das Ergebnis. Bleibt ein Worker
 * stumm, faellt der Auftrag nach einer Frist auf "failed" zurueck.
 */

import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { buildPlanFor } from '@zerostress/core';
import type { AppPackage, BuildJob, BuildPlan, BuildStatus } from '@zerostress/types';
import { db, appPackages, buildJobs } from '../db/index.js';
import { detectionPrefix, getPackage } from './packages.js';

type BuildRow = typeof buildJobs.$inferSelect;

/** Nach dieser Frist ohne Lebenszeichen gilt ein laufender Build als verloren. */
export const STALE_BUILD_MS = 2 * 60 * 60 * 1000;
const MAX_LOG_CHARS = 200_000;

function toBuildJob(row: BuildRow): BuildJob {
  return {
    id: row.id,
    packageId: row.packageId,
    status: row.status as BuildStatus,
    workerId: row.workerId,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    log: row.log,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export function workerTokenConfigured(): boolean {
  return (process.env.WORKER_TOKEN ?? '').length >= 16;
}

/** Zeitkonstanter Vergleich des Worker-Tokens. */
export function verifyWorkerToken(presented: string | undefined): boolean {
  const expected = process.env.WORKER_TOKEN ?? '';
  if (!workerTokenConfigured() || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function listBuilds(mspId: string, packageId: string): Promise<BuildJob[]> {
  const rows = await db
    .select()
    .from(buildJobs)
    .where(and(eq(buildJobs.mspId, mspId), eq(buildJobs.packageId, packageId)))
    .orderBy(desc(buildJobs.createdAt))
    .limit(20);
  return rows.map(toBuildJob);
}

/**
 * Build anlegen. Voraussetzung: Installer vorhanden, Typ msi/exe/psadt,
 * kein offener Build fuer dieses Paket.
 */
export async function enqueueBuild(mspId: string, packageId: string): Promise<{ build: BuildJob; pkg: AppPackage }> {
  const pkg = await getPackage(mspId, packageId);
  if (!pkg) throw new BuildError(404, 'Package not found');
  if (!['msi', 'exe', 'psadt'].includes(pkg.manifest.installerType)) throw new BuildError(400, `Pakete vom Typ ${pkg.manifest.installerType} werden nicht gebaut`);
  if (!pkg.installer) throw new BuildError(400, 'Erst den Installer hochladen');
  const open = await db.query.buildJobs.findFirst({ where: and(eq(buildJobs.packageId, packageId), inArray(buildJobs.status, ['queued', 'claimed', 'building'])) });
  if (open) throw new BuildError(409, 'Fuer dieses Paket laeuft bereits ein Build');

  const [row] = await db.insert(buildJobs).values({ mspId, packageId, status: 'queued' }).returning();
  await db.update(appPackages).set({ status: 'queued', buildError: null, updatedAt: new Date() }).where(eq(appPackages.id, packageId));
  return { build: toBuildJob(row), pkg };
}

export class BuildError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

/**
 * Verlorene Builds aufraeumen: claimed/building ohne Lebenszeichen seit STALE_BUILD_MS.
 */
export async function expireStaleBuilds(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_BUILD_MS);
  const stale = await db
    .update(buildJobs)
    .set({ status: 'failed', finishedAt: now, error: 'Worker hat sich nicht mehr gemeldet' })
    .where(and(inArray(buildJobs.status, ['claimed', 'building']), lt(buildJobs.claimedAt, cutoff)))
    .returning({ packageId: buildJobs.packageId });
  for (const s of stale) {
    await db.update(appPackages).set({ status: 'failed', buildError: 'Worker hat sich nicht mehr gemeldet', updatedAt: now }).where(eq(appPackages.id, s.packageId));
  }
  return stale.length;
}

/**
 * Aeltesten wartenden Build atomar dem Worker zuweisen und den Bauplan liefern.
 */
export async function claimBuild(workerId: string): Promise<BuildPlan | null> {
  await expireStaleBuilds();
  const claimed = (await db.execute(sql`
    update build_jobs
    set status = 'claimed', worker_id = ${workerId}, claimed_at = now()
    where id = (
      select id from build_jobs
      where status = 'queued'
      order by created_at
      limit 1
      for update skip locked
    )
    returning id, package_id, msp_id
  `)) as unknown as Array<{ id: string; package_id: string; msp_id: string }>;
  const row = claimed[0];
  if (!row) return null;

  const pkg = await getPackage(row.msp_id, row.package_id);
  if (!pkg || !pkg.installer) {
    await finishBuild(row.id, workerId, { success: false, log: '', error: 'Paket oder Installer beim Claim nicht mehr vorhanden' });
    return null;
  }
  try {
    const plan = buildPlanFor(pkg.manifest, pkg.installer, detectionPrefix(), { buildId: row.id, packageId: row.package_id });
    await db.update(buildJobs).set({ status: 'building' }).where(eq(buildJobs.id, row.id));
    await db.update(appPackages).set({ status: 'building', updatedAt: new Date() }).where(eq(appPackages.id, row.package_id));
    return plan;
  } catch (error) {
    await finishBuild(row.id, workerId, { success: false, log: '', error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Build, der diesem Worker gehoert und noch laeuft; sonst null. */
export async function getOwnedBuild(buildId: string, workerId: string): Promise<BuildRow | null> {
  const row = await db.query.buildJobs.findFirst({ where: and(eq(buildJobs.id, buildId), eq(buildJobs.workerId, workerId), inArray(buildJobs.status, ['claimed', 'building'])) });
  return row ?? null;
}

/** Fortschrittszeile anhaengen; zaehlt zugleich als Lebenszeichen. */
export async function appendBuildLog(buildId: string, workerId: string, line: string): Promise<boolean> {
  const row = await getOwnedBuild(buildId, workerId);
  if (!row) return false;
  const stamp = new Date().toISOString();
  const next = `${row.log ?? ''}${row.log ? '\n' : ''}[${stamp}] ${line.slice(0, 2000)}`.slice(-MAX_LOG_CHARS);
  await db.update(buildJobs).set({ log: next, claimedAt: new Date() }).where(eq(buildJobs.id, buildId));
  return true;
}

/**
 * Abschluss: Erfolg setzt voraus, dass das Artefakt bereits hochgeladen
 * wurde (storeFile setzt dann status ready); sonst bleibt das Paket failed.
 */
export async function finishBuild(buildId: string, workerId: string, result: { success: boolean; log: string; error: string | null }): Promise<boolean> {
  const row = await db.query.buildJobs.findFirst({ where: and(eq(buildJobs.id, buildId), eq(buildJobs.workerId, workerId)) });
  if (!row || row.status === 'succeeded' || row.status === 'failed') return false;
  const now = new Date();
  const mergedLog = [row.log, result.log].filter((s) => s && s.trim()).join('\n').slice(-MAX_LOG_CHARS) || null;
  const pkgRow = await db.query.appPackages.findFirst({ where: eq(appPackages.id, row.packageId) });
  const hasArtifact = !!pkgRow?.artifact;
  const success = result.success && hasArtifact;
  const error = success ? null : (result.error ?? (result.success ? 'Worker meldete Erfolg, aber kein Artefakt wurde hochgeladen' : 'Build fehlgeschlagen'));
  await db.update(buildJobs).set({ status: success ? 'succeeded' : 'failed', finishedAt: now, log: mergedLog, error }).where(eq(buildJobs.id, buildId));
  await db
    .update(appPackages)
    .set({ status: success ? 'ready' : 'failed', buildLog: mergedLog, buildError: error, updatedAt: now })
    .where(eq(appPackages.id, row.packageId));
  return true;
}
