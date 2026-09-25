/**
 * Bestands-Snapshot der API
 *
 * Lesende Seiten (Geraeteliste, Geraetedetail, Schwachstellen,
 * Sicherheitslage) lesen hier statt direkt aus Graph und Defender.
 * Schreibende Aktionen und Geheimnisse gehen weiterhin live.
 */

import { Redis } from 'ioredis';
import { and, eq } from 'drizzle-orm';
import { InventorySyncService, INVENTORY_KINDS, type SyncTarget } from '@zerostress/core';
import type {
  Device,
  DeviceInventory,
  GroupInventory,
  InventoryKind,
  MailOverview,
  ManagedTenant,
  SnapshotMeta,
  TenantInventoryStatus,
  TenantVulnerabilityList,
  VulnerabilitySeverity,
} from '@zerostress/types';
import { db, managedTenants } from '../db/index.js';
import { DrizzleSnapshotStore } from './inventory-store.js';
import { getDeviceProvider, getGroupProvider, getMailProvider, rememberMicrosoftTenantId } from './microsoft-clients.js';

// Der Snapshot haelt alle CVEs; die Route schneidet je Anfrage zu
const VULNERABILITY_SNAPSHOT_LIMIT = 5000;

let service: InventorySyncService | null = null;

async function listTargets(): Promise<SyncTarget[]> {
  const rows = await db
    .select({ id: managedTenants.id, mspId: managedTenants.mspId, microsoftTenantId: managedTenants.microsoftTenantId })
    .from(managedTenants)
    .where(and(eq(managedTenants.isActive, true), eq(managedTenants.connectionStatus, 'connected')));

  // Der Worker laeuft ohne Request; die Tenant-Aufloesung muss trotzdem sitzen
  for (const row of rows) rememberMicrosoftTenantId(row.id, row.microsoftTenantId);

  return rows.map((row) => ({ tenantId: row.id as SyncTarget['tenantId'], mspId: row.mspId as SyncTarget['mspId'] }));
}

export function getInventoryService(): InventorySyncService {
  if (!service) {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    redis.on('error', (error: Error) => {
      console.error('Redis connection error (inventory):', error.message);
    });

    service = new InventorySyncService({
      redis,
      store: new DrizzleSnapshotStore(),
      listTargets,
      loaders: {
        devices: (ctx) => getDeviceProvider().listDevices(ctx),
        vulnerabilities: (ctx) => getDeviceProvider().getTenantVulnerabilities(ctx, { top: VULNERABILITY_SNAPSHOT_LIMIT }),
        groups: (ctx) => getGroupProvider().listGroups(ctx),
        mail: (ctx) => getMailProvider().getMailOverview(ctx, 'D30'),
      },
      onSynced: async (target, kind) => {
        if (kind === 'devices') {
          await db.update(managedTenants).set({ lastSyncAt: new Date() }).where(eq(managedTenants.id, target.tenantId));
        }
      },
    });
  }
  return service;
}

export async function startInventorySync(): Promise<void> {
  await getInventoryService().start();
}

export function getInventoryHealth(): { redis: string; worker: boolean } {
  if (!service) {
    return { redis: 'not-started', worker: false };
  }
  const health = service.getHealth();
  return { redis: health.redisStatus, worker: health.workerRunning };
}

function targetOf(tenant: ManagedTenant): SyncTarget {
  return { tenantId: tenant.id, mspId: tenant.mspId };
}

export async function getDeviceInventory(tenant: ManagedTenant): Promise<DeviceInventory> {
  const read = await getInventoryService().getOrLoad(targetOf(tenant), 'devices');
  return { ...read.payload, snapshot: read.meta };
}

/**
 * Geraet aus dem Snapshot; ein unbekanntes Geraet loest einmal einen
 * direkten Abgleich aus, damit frisch enrollte Geraete sofort erreichbar sind.
 */
export async function findDevice(tenant: ManagedTenant, deviceId: string): Promise<Device | null> {
  const target = targetOf(tenant);
  const svc = getInventoryService();
  const read = await svc.getOrLoad(target, 'devices');
  const hit = read.payload.items.find((d) => d.id === deviceId);
  if (hit || read.meta.live) {
    return hit ?? null;
  }
  const fresh = await svc.sync(target, 'devices');
  return fresh.payload?.items.find((d) => d.id === deviceId) ?? null;
}

export async function getTenantVulnerabilities(
  tenant: ManagedTenant,
  options: { severity?: VulnerabilitySeverity; top?: number } = {}
): Promise<TenantVulnerabilityList> {
  const read = await getInventoryService().getOrLoad(targetOf(tenant), 'vulnerabilities');
  if (!read.payload.available) {
    return { ...read.payload, snapshot: read.meta };
  }
  const filtered = options.severity ? read.payload.data.items.filter((v) => v.severity === options.severity) : read.payload.data.items;
  const top = options.top ?? filtered.length;
  return {
    available: true,
    data: { items: filtered.slice(0, top), truncated: read.payload.data.truncated || filtered.length > top },
    snapshot: read.meta,
  };
}

export async function getGroupInventory(tenant: ManagedTenant): Promise<GroupInventory> {
  const read = await getInventoryService().getOrLoad(targetOf(tenant), 'groups');
  return { ...read.payload, snapshot: read.meta };
}

export async function getMailOverview(tenant: ManagedTenant): Promise<MailOverview> {
  const read = await getInventoryService().getOrLoad(targetOf(tenant), 'mail');
  return { ...read.payload, snapshot: read.meta };
}

export async function getInventoryStatus(tenant: ManagedTenant): Promise<TenantInventoryStatus> {
  const snapshots: SnapshotMeta[] = await getInventoryService().getStatus(tenant.id);
  return { tenantId: tenant.id, snapshots, generatedAt: new Date().toISOString() };
}

export async function requestInventoryRefresh(tenant: ManagedTenant, kinds: InventoryKind[] = INVENTORY_KINDS): Promise<void> {
  await getInventoryService().requestRefresh(targetOf(tenant), kinds, 'manual');
}
