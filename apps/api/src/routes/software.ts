/**
 * Tenantweite Softwaresicht, Geraete je Software, Sperrliste
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { compareVersions, mapWithLimit } from '@zerostress/core';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { tenantContextMiddleware, requireConnectedTenant } from '../middleware/tenant-context.js';
import { addBlockRule, getSoftwareOverview, listBlockRules, listSoftwareDevices, removeBlockRule } from '../services/software.js';
import { requestInventoryRefresh } from '../services/inventory.js';
import { DrizzleAuditLogger } from '../services/audit-logger.js';
import type { CorrelationId } from '@zerostress/types';

const app = new Hono();
const audit = new DrizzleAuditLogger();

app.use('*', authMiddleware);
app.use('*', tenantContextMiddleware);

app.get('/', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  return c.json(await getSoftwareOverview(tenant));
});

// Sperrliste ist MSP-weit; der Tenant-Kontext dient nur der Navigation
app.get('/blocklist', async (c) => {
  const auth = c.get('auth');
  return c.json({ items: await listBlockRules(auth.mspId) });
});

const blockSchema = z.object({ kind: z.enum(['name', 'winget-id']), pattern: z.string().min(3).max(200), note: z.string().max(500).nullable().default(null) });

app.post('/blocklist', requireRole('engineer'), validate('json', blockSchema), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const body = c.req.valid('json');
  try {
    const rule = await addBlockRule(auth.mspId, auth.user.id, body);
    await audit.log({
      mspId: auth.mspId,
      tenantId: tenant?.id ?? null,
      userId: auth.user.id,
      action: 'software.blocklist.add',
      targetType: 'software-rule',
      targetId: rule.id,
      targetDisplayName: `${rule.kind}: ${rule.pattern}`,
      afterState: { kind: rule.kind, pattern: rule.pattern, note: rule.note },
      result: 'success',
      correlationId: randomUUID() as CorrelationId,
    });
    // Treffer sollen nicht auf den naechsten 6-Stunden-Sync warten
    if (tenant) await requestInventoryRefresh(tenant, ['software']).catch(() => undefined);
    return c.json(rule, 201);
  } catch (error) {
    if (error instanceof Error && /existiert|Zeichen/.test(error.message)) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: error.message, status: 400 }, 400);
    throw error;
  }
});

app.delete('/blocklist/:ruleId', requireRole('engineer'), async (c) => {
  const auth = c.get('auth');
  const tenant = c.get('tenant');
  const ruleId = c.req.param('ruleId');
  const removed = await removeBlockRule(auth.mspId, ruleId);
  if (!removed) return c.json({ type: 'https://api.zerostress.io/problems/not-found', title: 'Rule not found', status: 404 }, 404);
  await audit.log({
    mspId: auth.mspId,
    tenantId: tenant?.id ?? null,
    userId: auth.user.id,
    action: 'software.blocklist.remove',
    targetType: 'software-rule',
    targetId: ruleId,
    targetDisplayName: ruleId,
    result: 'success',
    correlationId: randomUUID() as CorrelationId,
  });
  return c.json({ removed: true });
});

// Geraete mehrerer Versionen in einem Aufruf (Sammelaktion), serverseitig mit begrenzter Parallelitaet.
// Mit latest markiert die API veraltete Installationen, die Oberflaeche vergleicht keine Versionen selbst.
app.get('/devices', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const ids = (c.req.query('ids') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const latest = c.req.query('latest') || null;
  if (ids.length === 0 || ids.length > 50 || ids.some((id) => !/^[A-Za-z0-9-]{8,64}$/.test(id))) {
    return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'ids ungueltig (1 bis 50 App-Ids)', status: 400 }, 400);
  }
  const versionOf = new Map((c.req.query('versions') ?? '').split(',').map((pair) => pair.split('=') as [string, string]).filter((p) => p.length === 2));
  const results = await mapWithLimit(ids, 4, async (id) => ({ id, result: await listSoftwareDevices(tenant, id) }));
  const unavailable = results.find((r) => !r.result.available)?.result ?? null;
  const devices = new Map<string, Record<string, unknown>>();
  for (const { id, result } of results) {
    if (!result.available) continue;
    const version = versionOf.get(id) ? decodeURIComponent(versionOf.get(id) as string) : null;
    for (const d of result.data) {
      if (devices.has(d.managedDeviceId)) continue;
      const outdated = latest && version ? compareVersions(version, latest) < 0 : null;
      devices.set(d.managedDeviceId, { ...d, version, outdated });
    }
  }
  const sorted = Array.from(devices.values()).sort((a, b) => String(a.deviceName).localeCompare(String(b.deviceName), 'de'));
  return c.json({ devices: sorted, unavailable: unavailable && !unavailable.available ? unavailable : null });
});

// Geraete, auf denen eine erkannte App (Version) installiert ist
app.get('/:appId/devices', requireConnectedTenant, async (c) => {
  const tenant = c.get('tenant');
  const appId = c.req.param('appId');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(appId)) return c.json({ type: 'https://api.zerostress.io/problems/validation', title: 'appId ungueltig', status: 400 }, 400);
  return c.json(await listSoftwareDevices(tenant, appId));
});

export { app as softwareRouter };
