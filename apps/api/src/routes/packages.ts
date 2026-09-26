/**
 * Paketkatalog-Routen (MSP-weit, nicht tenantgebunden)
 */

import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { ManifestError } from '@zerostress/core';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import { createPackage, deletePackage, getPackage, listPackages, openFile, storeFile, updateManifest, detectionPrefix } from '../services/packages.js';
import { getArtifactStore } from '../services/artifact-store.js';
import { startRollout } from '../services/publishing.js';
import { BuildError, enqueueBuild, listBuilds, workerTokenConfigured } from '../services/builds.js';
import { baseSet, browsePublisher, checkPackageVersion, createNewVersion, manifestFromResolution, resolveWinget } from '../services/winget-catalog.js';
import { WingetError } from '@zerostress/core';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AppManifest, CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);

/** Die sicherheitsrelevanten Felder eines Manifests fuer Vorher/Nachher im Audit. */
function manifestAuditView(m: AppManifest): Record<string, unknown> {
  return {
    installerType: m.installerType,
    version: m.version,
    installCommand: m.installCommand,
    uninstallCommand: m.uninstallCommand,
    installContext: m.installContext,
    detection: m.detection.map((d) => (d.type === 'registry' ? `registry ${d.keyPath}` : d.type === 'file' ? `file ${d.path}\\${d.fileOrFolderName}` : d.type === 'msi' ? `msi ${d.productCode}` : 'script')),
    processesToClose: m.processesToClose,
    wingetPackageIdentifier: m.wingetPackageIdentifier,
    sourceInstaller: m.sourceInstaller ? { url: m.sourceInstaller.url, sha256: m.sourceInstaller.sha256, version: m.sourceInstaller.version } : null,
  };
}

function problem(status: number, title: string, detail?: string) {
  const kind = status === 404 ? 'not-found' : status === 409 ? 'conflict' : 'validation';
  return { type: `https://api.zerostress.io/problems/${kind}`, title, status, detail };
}

app.get('/', async (c) => {
  const auth = c.get('auth');
  return c.json({ items: await listPackages(auth.mspId), detectionPrefix: detectionPrefix(), store: getArtifactStore().kind });
});

app.post('/', requireRole('engineer'), async (c) => {
  const auth = c.get('auth');
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json(problem(400, 'Manifest fehlt'), 400);
  try {
    const pkg = await createPackage(auth.mspId, auth.user.id, body);
    await audit.log({
      mspId: auth.mspId,
      tenantId: null,
      userId: auth.user.id,
      action: 'apps.package.create',
      targetType: 'package',
      targetId: pkg.id,
      targetDisplayName: `${pkg.manifest.vendor} ${pkg.manifest.name} ${pkg.manifest.version}`,
      afterState: { installerType: pkg.manifest.installerType },
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
    return c.json(pkg, 201);
  } catch (error) {
    if (error instanceof ManifestError) return c.json({ ...problem(400, 'Manifest ungueltig', error.message), problems: error.problems }, 400);
    throw error;
  }
});

// winget-Katalog: Basis-Set, Blaettern nach Herausgeber, Aufloesung einer Id
app.get('/winget/base-set', (c) => c.json({ items: baseSet(), githubToken: !!process.env.GITHUB_TOKEN }));

app.get('/winget/browse', async (c) => {
  const publisher = c.req.query('publisher') ?? '';
  if (!publisher.trim()) return c.json(problem(400, 'publisher fehlt'), 400);
  try {
    return c.json({ items: await browsePublisher(publisher) });
  } catch (error) {
    if (error instanceof WingetError) return c.json(problem(error.code === 'invalid' ? 400 : 502, 'winget-Katalog', error.message), error.code === 'invalid' ? 400 : 502);
    throw error;
  }
});

const resolveSchema = z.object({ id: z.string().min(3).max(128), version: z.string().max(40).nullable().default(null), architecture: z.enum(['x64', 'x86', 'arm64', 'neutral']).default('x64') });

app.post('/winget/resolve', requireRole('engineer'), zValidator('json', resolveSchema), async (c) => {
  const body = c.req.valid('json');
  try {
    const resolution = await resolveWinget(body.id, body.version, body.architecture);
    return c.json({ resolution, manifest: manifestFromResolution(resolution, body.architecture) });
  } catch (error) {
    if (error instanceof WingetError) {
      const status = error.code === 'invalid' ? 400 : error.code === 'not-found' || error.code === 'unsupported' ? 404 : 502;
      return c.json({ ...problem(status, 'winget-Katalog', error.message), code: error.code }, status);
    }
    throw error;
  }
});

app.get('/:packageId', async (c) => {
  const auth = c.get('auth');
  const pkg = await getPackage(auth.mspId, c.req.param('packageId'));
  return pkg ? c.json(pkg) : c.json(problem(404, 'Package not found'), 404);
});

app.put('/:packageId', requireRole('engineer'), async (c) => {
  const auth = c.get('auth');
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json(problem(400, 'Manifest fehlt'), 400);
  try {
    const packageId = c.req.param('packageId');
    const before = await getPackage(auth.mspId, packageId);
    if (!before) return c.json(problem(404, 'Package not found'), 404);
    const pkg = await updateManifest(auth.mspId, packageId, body);
    if (!pkg) return c.json(problem(404, 'Package not found'), 404);
    // Das Manifest ist Code, der als SYSTEM auf Kundengeraeten laeuft: jede Aenderung mit Vorher/Nachher ins Audit
    await audit.log({
      mspId: auth.mspId,
      tenantId: null,
      userId: auth.user.id,
      action: 'apps.package.update',
      targetType: 'package',
      targetId: pkg.id,
      targetDisplayName: `${pkg.manifest.vendor} ${pkg.manifest.name} ${pkg.manifest.version}`,
      beforeState: manifestAuditView(before.manifest),
      afterState: manifestAuditView(pkg.manifest),
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
    return c.json(pkg);
  } catch (error) {
    if (error instanceof ManifestError) return c.json({ ...problem(400, 'Manifest ungueltig', error.message), problems: error.problems }, 400);
    if (error instanceof Error && /nach dem Upload fest/.test(error.message)) return c.json(problem(400, 'Bezeichner fest', error.message), 400);
    throw error;
  }
});

app.delete('/:packageId', requireRole('owner'), async (c) => {
  const auth = c.get('auth');
  const packageId = c.req.param('packageId');
  const pkg = await getPackage(auth.mspId, packageId);
  if (!pkg) return c.json(problem(404, 'Package not found'), 404);
  await deletePackage(auth.mspId, packageId);
  await audit.log({
    mspId: auth.mspId,
    tenantId: null,
    userId: auth.user.id,
    action: 'apps.package.delete',
    targetType: 'package',
    targetId: packageId,
    targetDisplayName: `${pkg.manifest.vendor} ${pkg.manifest.name} ${pkg.manifest.version}`,
    beforeState: { deployments: pkg.deployments.length },
    result: 'success',
    correlationId: randomUUID() as CorrelationId,
  });
  return c.json({ deleted: true });
});

// Rollout: je gewaehltem Tenant ein Job apps.publish mit Vorschau
const rolloutSchema = z.object({ tenantIds: z.array(z.string().uuid()).min(1).max(100), autoApprove: z.boolean().default(false) });

app.post('/:packageId/rollout', requireRole('engineer'), zValidator('json', rolloutSchema), async (c) => {
  const auth = c.get('auth');
  const packageId = c.req.param('packageId');
  const body = c.req.valid('json');
  try {
    const jobs = await startRollout({ mspId: auth.mspId, userId: auth.user.id, userEmail: auth.user.email, packageId, tenantIds: body.tenantIds, autoApprove: body.autoApprove });
    await audit.log({
      mspId: auth.mspId,
      tenantId: null,
      userId: auth.user.id,
      action: 'apps.package.rollout',
      targetType: 'package',
      targetId: packageId,
      targetDisplayName: packageId,
      afterState: { tenants: body.tenantIds.length, jobs: jobs.length, autoApprove: body.autoApprove },
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
    return c.json({ jobs }, 202);
  } catch (error) {
    if (error instanceof Error && /Package not found/.test(error.message)) return c.json(problem(404, 'Package not found'), 404);
    if (error instanceof Error && /nicht bereit|nicht gebaut/.test(error.message)) return c.json(problem(400, 'Paket nicht bereit', error.message), 400);
    throw error;
  }
});

// Build: Auftrag fuer den Windows-Worker anlegen (Installer + Manifest -> .intunewin)
app.post('/:packageId/build', requireRole('engineer'), async (c) => {
  const auth = c.get('auth');
  const packageId = c.req.param('packageId');
  try {
    const { build, pkg } = await enqueueBuild(auth.mspId, packageId);
    await audit.log({
      mspId: auth.mspId,
      tenantId: null,
      userId: auth.user.id,
      action: 'apps.package.build',
      targetType: 'package',
      targetId: packageId,
      targetDisplayName: `${pkg.manifest.vendor} ${pkg.manifest.name} ${pkg.manifest.version}`,
      afterState: { buildId: build.id, installer: pkg.installer?.fileName ?? null, installerType: pkg.manifest.installerType },
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
    return c.json({ ...build, workerConfigured: workerTokenConfigured() }, 202);
  } catch (error) {
    if (error instanceof BuildError) return c.json(problem(error.status, error.message), error.status);
    throw error;
  }
});

// winget: Katalogversion pruefen, neue Version als Paket anlegen
app.post('/:packageId/check-version', requireRole('engineer'), async (c) => {
  const auth = c.get('auth');
  try {
    return c.json(await checkPackageVersion(auth.mspId, c.req.param('packageId')));
  } catch (error) {
    if (error instanceof WingetError) return c.json(problem(502, 'winget-Katalog', error.message), 502);
    if (error instanceof Error && /Package not found/.test(error.message)) return c.json(problem(404, 'Package not found'), 404);
    if (error instanceof Error && /Nur winget/.test(error.message)) return c.json(problem(400, error.message), 400);
    throw error;
  }
});

const newVersionSchema = z.object({ version: z.string().max(40).nullable().default(null) });

app.post('/:packageId/new-version', requireRole('engineer'), zValidator('json', newVersionSchema), async (c) => {
  const auth = c.get('auth');
  const packageId = c.req.param('packageId');
  try {
    const created = await createNewVersion(auth.mspId, auth.user.id, packageId, c.req.valid('json').version);
    await audit.log({
      mspId: auth.mspId,
      tenantId: null,
      userId: auth.user.id,
      action: 'apps.package.new-version',
      targetType: 'package',
      targetId: created.id,
      targetDisplayName: `${created.manifest.vendor} ${created.manifest.name} ${created.manifest.version}`,
      beforeState: { predecessor: packageId },
      afterState: { version: created.manifest.version, source: created.manifest.sourceInstaller?.url ?? null, status: created.status },
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
    return c.json(created, 201);
  } catch (error) {
    if (error instanceof WingetError) {
      const status = error.code === 'invalid' ? 400 : error.code === 'not-found' || error.code === 'unsupported' ? 404 : 502;
      return c.json(problem(status, 'winget-Katalog', error.message), status);
    }
    if (error instanceof ManifestError) return c.json({ ...problem(400, 'Manifest ungueltig', error.message), problems: error.problems }, 400);
    if (error instanceof Error && /Package not found/.test(error.message)) return c.json(problem(404, 'Package not found'), 404);
    if (error instanceof Error && /Nur winget/.test(error.message)) return c.json(problem(400, error.message), 400);
    throw error;
  }
});

app.get('/:packageId/builds', async (c) => {
  const auth = c.get('auth');
  return c.json({ items: await listBuilds(auth.mspId, c.req.param('packageId')), workerConfigured: workerTokenConfigured() });
});

// Datei-Upload als roher Body (Content-Type application/octet-stream), Dateiname als Query
app.put('/:packageId/:kind{artifact|installer}', requireRole('engineer'), async (c) => {
  const auth = c.get('auth');
  const packageId = c.req.param('packageId');
  const kind = c.req.param('kind') as 'artifact' | 'installer';
  const fileName = c.req.query('fileName');
  if (!fileName) return c.json(problem(400, 'fileName fehlt'), 400);
  const body = c.req.raw.body;
  if (!body) return c.json(problem(400, 'Kein Dateiinhalt'), 400);
  try {
    const pkg = await storeFile(auth.mspId, packageId, kind, fileName, Readable.fromWeb(body as import('node:stream/web').ReadableStream));
    await audit.log({
      mspId: auth.mspId,
      tenantId: null,
      userId: auth.user.id,
      action: `apps.package.upload-${kind}`,
      targetType: 'package',
      targetId: packageId,
      targetDisplayName: `${pkg.manifest.vendor} ${pkg.manifest.name} ${pkg.manifest.version}`,
      afterState: { fileName, sha256: (kind === 'artifact' ? pkg.artifact : pkg.installer)?.sha256 ?? null },
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
    return c.json(pkg);
  } catch (error) {
    if (error instanceof Error && /Package not found/.test(error.message)) return c.json(problem(404, 'Package not found'), 404);
    if (error instanceof Error && /muss/.test(error.message)) return c.json(problem(400, 'Datei abgelehnt', error.message), 400);
    throw error;
  }
});

app.get('/:packageId/:kind{artifact|installer}', async (c) => {
  const auth = c.get('auth');
  const kind = c.req.param('kind') as 'artifact' | 'installer';
  const opened = await openFile(auth.mspId, c.req.param('packageId'), kind);
  if (!opened) return c.json(problem(404, 'File not found'), 404);
  c.header('Content-Type', 'application/octet-stream');
  c.header('Content-Disposition', `attachment; filename="${opened.file.fileName}"`);
  c.header('Content-Length', String(opened.file.sizeBytes));
  return stream(c, async (s) => {
    for await (const chunk of opened.stream) {
      await s.write(chunk as Uint8Array);
    }
  });
});

export { app as packagesRouter };
