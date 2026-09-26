/**
 * Endpunkte fuer den Windows-Build-Worker
 *
 * Kein Benutzer-Login, sondern ein gemeinsames Geheimnis (WORKER_TOKEN) im
 * Bearer-Header. Der Worker sieht nur den Bauplan des Auftrags, den er
 * gerade haelt: Installer laden, Artefakt hochladen, Fortschritt melden,
 * abschliessen. Ohne konfiguriertes Token antworten alle Pfade mit 503.
 */

import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { createMiddleware } from 'hono/factory';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { appendBuildLog, claimBuild, finishBuild, getOwnedBuild, verifyWorkerToken, workerTokenConfigured } from '../services/builds.js';
import { openFile, storeFile } from '../services/packages.js';

const app = new Hono();

const WORKER_ID = /^[A-Za-z0-9._-]{1,100}$/;

const workerAuth = createMiddleware(async (c, next) => {
  if (!workerTokenConfigured()) {
    return c.json({ type: 'https://api.zerostress.io/problems/not-configured', title: 'WORKER_TOKEN ist nicht gesetzt', status: 503 }, 503);
  }
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!verifyWorkerToken(token)) {
    return c.json({ type: 'https://api.zerostress.io/problems/unauthorized', title: 'Worker token invalid', status: 401 }, 401);
  }
  const workerId = c.req.header('X-Worker-Id') ?? '';
  if (!WORKER_ID.test(workerId)) {
    return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'X-Worker-Id fehlt oder ungueltig', status: 400 }, 400);
  }
  c.set('workerId', workerId);
  await next();
  return undefined;
});

declare module 'hono' {
  interface ContextVariableMap {
    workerId: string;
  }
}

app.use('*', workerAuth);

app.get('/ping', (c) => c.json({ ok: true, workerId: c.get('workerId') }));

// Naechsten Auftrag holen: 204 wenn nichts wartet
app.post('/builds/claim', async (c) => {
  const plan = await claimBuild(c.get('workerId'));
  if (!plan) return c.body(null, 204);
  return c.json(plan);
});

app.get('/builds/:buildId/installer', async (c) => {
  const build = await getOwnedBuild(c.req.param('buildId'), c.get('workerId'));
  if (!build) return c.json({ title: 'Build not found', status: 404 }, 404);
  const opened = await openFile(build.mspId, build.packageId, 'installer');
  if (!opened) return c.json({ title: 'Installer not found', status: 404 }, 404);
  c.header('Content-Type', 'application/octet-stream');
  c.header('Content-Disposition', `attachment; filename="${opened.file.fileName}"`);
  c.header('Content-Length', String(opened.file.sizeBytes));
  c.header('X-Content-Sha256', opened.file.sha256);
  return stream(c, async (s) => {
    for await (const chunk of opened.stream) {
      await s.write(chunk as Uint8Array);
    }
  });
});

const logSchema = z.object({ message: z.string().min(1).max(2000) });

app.post('/builds/:buildId/log', zValidator('json', logSchema), async (c) => {
  const ok = await appendBuildLog(c.req.param('buildId'), c.get('workerId'), c.req.valid('json').message);
  return ok ? c.json({ ok: true }) : c.json({ title: 'Build not found', status: 404 }, 404);
});

// Fertiges .intunewin als roher Body; setzt das Paket auf ready
app.put('/builds/:buildId/artifact', async (c) => {
  const build = await getOwnedBuild(c.req.param('buildId'), c.get('workerId'));
  if (!build) return c.json({ title: 'Build not found', status: 404 }, 404);
  const fileName = c.req.query('fileName');
  if (!fileName) return c.json({ title: 'fileName fehlt', status: 400 }, 400);
  const body = c.req.raw.body;
  if (!body) return c.json({ title: 'Kein Dateiinhalt', status: 400 }, 400);
  try {
    const pkg = await storeFile(build.mspId, build.packageId, 'artifact', fileName, Readable.fromWeb(body as import('node:stream/web').ReadableStream));
    return c.json({ ok: true, artifact: pkg.artifact });
  } catch (error) {
    if (error instanceof Error && /muss/.test(error.message)) return c.json({ title: 'Datei abgelehnt', detail: error.message, status: 400 }, 400);
    throw error;
  }
});

const completeSchema = z.object({ success: z.boolean(), log: z.string().max(200_000).default(''), error: z.string().max(4000).nullable().default(null) });

app.post('/builds/:buildId/complete', zValidator('json', completeSchema), async (c) => {
  const body = c.req.valid('json');
  const ok = await finishBuild(c.req.param('buildId'), c.get('workerId'), { success: body.success, log: body.log, error: body.error });
  return ok ? c.json({ ok: true }) : c.json({ title: 'Build not found or already finished', status: 404 }, 404);
});

export { app as workerRouter };
