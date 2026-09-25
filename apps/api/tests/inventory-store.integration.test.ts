/**
 * Integrationstest des Snapshot-Speichers gegen ein echtes Postgres.
 * Laeuft nur mit TEST_DATABASE_URL, z. B.
 * TEST_DATABASE_URL=postgresql://zerostress:dev_password_only@localhost:5432/zerostress
 *
 * Beweist die Tenant-Isolation: Tenant A sieht nie den Stand von Tenant B,
 * auch nicht nach Sync, Fehler oder Loeschung des anderen Tenants.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { MspId, TenantId } from '@zerostress/types';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

describe.skipIf(!databaseUrl)('DrizzleSnapshotStore with Postgres', () => {
  let store: import('../src/services/inventory-store.js').DrizzleSnapshotStore;
  let db: typeof import('../src/db/index.js').db;
  let schema: typeof import('../src/db/index.js');
  let mspId: MspId;
  let tenantA: TenantId;
  let tenantB: TenantId;

  beforeAll(async () => {
    schema = await import('../src/db/index.js');
    db = schema.db;
    const { DrizzleSnapshotStore } = await import('../src/services/inventory-store.js');
    store = new DrizzleSnapshotStore();

    const [msp] = await db
      .insert(schema.mspOrganizations)
      .values({ name: 'Isolation Test MSP', slug: `isolation-${Date.now()}` })
      .returning({ id: schema.mspOrganizations.id });
    mspId = msp.id as MspId;

    const tenants = await db
      .insert(schema.managedTenants)
      .values([
        { mspId, microsoftTenantId: crypto.randomUUID(), displayName: 'Tenant A', primaryDomain: 'a.test', authMethod: 'app-consent' },
        { mspId, microsoftTenantId: crypto.randomUUID(), displayName: 'Tenant B', primaryDomain: 'b.test', authMethod: 'app-consent' },
      ])
      .returning({ id: schema.managedTenants.id });
    tenantA = tenants[0].id as TenantId;
    tenantB = tenants[1].id as TenantId;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.managedTenants).where(eq(schema.managedTenants.mspId, mspId));
    await db.delete(schema.mspOrganizations).where(eq(schema.mspOrganizations.id, mspId));
  });

  it('keeps tenants apart across write, read, failure and delete', async () => {
    const now = new Date();
    await store.markRunning({ tenantId: tenantA, mspId, kind: 'devices' }, now);
    await store.complete({ tenantId: tenantA, mspId, kind: 'devices' }, { payload: { owner: 'A' }, itemCount: 1, syncedAt: now, durationMs: 5, unavailable: false });
    await store.markRunning({ tenantId: tenantB, mspId, kind: 'devices' }, now);
    await store.complete({ tenantId: tenantB, mspId, kind: 'devices' }, { payload: { owner: 'B' }, itemCount: 2, syncedAt: now, durationMs: 5, unavailable: false });

    expect((await store.get<{ owner: string }>(tenantA, 'devices'))?.payload).toEqual({ owner: 'A' });
    expect((await store.get<{ owner: string }>(tenantB, 'devices'))?.payload).toEqual({ owner: 'B' });
    expect((await store.list(tenantA)).map((r) => r.tenantId)).toEqual([tenantA]);

    // Fehler bei B laesst A unberuehrt und B behaelt seinen alten Stand
    await store.fail({ tenantId: tenantB, mspId, kind: 'devices' }, { error: 'boom', durationMs: 1 });
    expect((await store.get(tenantA, 'devices'))?.status).toBe('ready');
    const b = await store.get<{ owner: string }>(tenantB, 'devices');
    expect(b?.status).toBe('error');
    expect(b?.payload).toEqual({ owner: 'B' });

    // Loeschen von B entfernt nichts von A
    await store.deleteForTenant(tenantB);
    expect(await store.get(tenantB, 'devices')).toBeNull();
    expect((await store.get<{ owner: string }>(tenantA, 'devices'))?.payload).toEqual({ owner: 'A' });

    // Tenant-Loeschung raeumt den Snapshot mit auf (ON DELETE CASCADE)
    await db.delete(schema.managedTenants).where(eq(schema.managedTenants.id, tenantA));
    expect(await store.get(tenantA, 'devices')).toBeNull();
  });
});
