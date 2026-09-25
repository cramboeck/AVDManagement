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
import type { CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);

function problem(status: number, title: string, detail?: string) {
  return { type: `https://api.zerostress.io/problems/${status === 404 ? 'not-found' : 'validation'}`, title, status, detail };
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
    const pkg = await updateManifest(auth.mspId, c.req.param('packageId'), body);
    return pkg ? c.json(pkg) : c.json(problem(404, 'Package not found'), 404);
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
