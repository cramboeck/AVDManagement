/**
 * Tenantweite Softwaresicht: Snapshot aus Intune, Abgleich mit dem
 * winget-Katalog (eigene Pakete, Basis-Set, Versionscache), Sperrliste je
 * MSP und Alerts bei Treffern.
 */

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { buildSoftwareOverview, matchBlockRule, matchWingetId, WingetError, WINGET_BASE_SET, newestVersion, type CatalogPackageRef } from '@zerostress/core';
import type { AnomalyFinding, ManagedTenant, SoftwareBlockRule, SoftwareInventoryItem, SoftwareOverview, TenantId } from '@zerostress/types';
import { db, softwareBlocklist, wingetVersions, mspUsers } from '../db/index.js';
import { getInventoryService } from './inventory.js';
import { listPackages } from './packages.js';
import { getWingetClient } from './winget-catalog.js';
import { getDeviceProvider } from './microsoft-clients.js';
import { notify, storeFindings } from './alerting.js';

const VERSION_TTL_MS = 24 * 60 * 60 * 1000;
// Je Aufruf nur wenige Katalogabfragen, damit das GitHub-Ratenlimit (60/h ohne Token) reicht
const VERSION_REFRESH_PER_CALL = 8;

function targetOf(tenant: ManagedTenant) {
  return { tenantId: tenant.id, mspId: tenant.mspId };
}

async function packageRefs(mspId: string): Promise<CatalogPackageRef[]> {
  const packages = await listPackages(mspId);
  return packages
    .filter((p) => p.manifest.installerType === 'winget' && p.manifest.wingetPackageIdentifier)
    .map((p) => ({ id: p.id, name: p.manifest.name, wingetId: p.manifest.wingetPackageIdentifier as string, version: p.manifest.version, latestVersion: p.latestVersion }));
}

/**
 * Katalogversionen fuer die gegebenen Ids aus dem Cache; abgelaufene werden
 * in kleinen Portionen nachgeladen. Ratenlimit bricht den Nachlauf ab.
 */
export async function latestVersionsFor(ids: string[]): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(ids));
  const map = new Map<string, string | null>();
  if (unique.length === 0) return map;
  const rows = await db.select().from(wingetVersions).where(inArray(wingetVersions.packageId, unique));
  const now = Date.now();
  const stale: string[] = [];
  for (const id of unique) {
    const row = rows.find((r) => r.packageId === id);
    if (row) map.set(id, row.latestVersion);
    if (!row || now - row.checkedAt.getTime() > VERSION_TTL_MS) stale.push(id);
  }
  const client = getWingetClient();
  for (const id of stale.slice(0, VERSION_REFRESH_PER_CALL)) {
    try {
      const latest = newestVersion(await client.listVersions(id));
      map.set(id, latest);
      await db
        .insert(wingetVersions)
        .values({ packageId: id, latestVersion: latest, checkedAt: new Date() })
        .onConflictDoUpdate({ target: wingetVersions.packageId, set: { latestVersion: latest, checkedAt: new Date() } });
    } catch (error) {
      if (error instanceof WingetError && error.code === 'rate-limited') break;
      // Unbekannte Id oder Netzfehler: Zeitstempel setzen, damit nicht jeder Aufruf erneut anfragt
      await db
        .insert(wingetVersions)
        .values({ packageId: id, latestVersion: map.get(id) ?? null, checkedAt: new Date() })
        .onConflictDoUpdate({ target: wingetVersions.packageId, set: { checkedAt: new Date() } });
    }
  }
  return map;
}

export async function listBlockRules(mspId: string): Promise<SoftwareBlockRule[]> {
  const rows = await db
    .select({ rule: softwareBlocklist, email: mspUsers.email })
    .from(softwareBlocklist)
    .innerJoin(mspUsers, eq(mspUsers.id, softwareBlocklist.createdBy))
    .where(eq(softwareBlocklist.mspId, mspId));
  return rows
    .map((r) => ({ id: r.rule.id, kind: r.rule.kind as SoftwareBlockRule['kind'], pattern: r.rule.pattern, note: r.rule.note, createdByEmail: r.email, createdAt: r.rule.createdAt.toISOString() }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

export async function addBlockRule(mspId: string, userId: string, input: { kind: 'name' | 'winget-id'; pattern: string; note: string | null }): Promise<SoftwareBlockRule> {
  const pattern = input.pattern.trim();
  if (pattern.length < 3 || pattern.length > 200) throw new Error('Muster muss zwischen 3 und 200 Zeichen lang sein');
  const existing = await db.query.softwareBlocklist.findFirst({ where: and(eq(softwareBlocklist.mspId, mspId), eq(softwareBlocklist.kind, input.kind), eq(softwareBlocklist.pattern, pattern)) });
  if (existing) throw new Error('Regel existiert bereits');
  const [row] = await db.insert(softwareBlocklist).values({ mspId, kind: input.kind, pattern, note: input.note?.trim() || null, createdBy: userId }).returning();
  const user = await db.query.mspUsers.findFirst({ where: eq(mspUsers.id, userId) });
  return { id: row.id, kind: input.kind, pattern, note: row.note, createdByEmail: user?.email ?? '', createdAt: row.createdAt.toISOString() };
}

export async function removeBlockRule(mspId: string, ruleId: string): Promise<boolean> {
  const rows = await db.delete(softwareBlocklist).where(and(eq(softwareBlocklist.mspId, mspId), eq(softwareBlocklist.id, ruleId))).returning({ id: softwareBlocklist.id });
  return rows.length > 0;
}

/** Softwarezeilen des Tenants mit Katalogstand und Sperren. */
export async function getSoftwareOverview(tenant: ManagedTenant): Promise<SoftwareOverview> {
  const read = await getInventoryService().getOrLoad(targetOf(tenant), 'software');
  if (!read.payload.available) return { ...read.payload, snapshot: read.meta };
  const [packages, rules] = await Promise.all([packageRefs(tenant.mspId), listBlockRules(tenant.mspId)]);
  const items = read.payload.data.items;
  // Nur Ids nachschlagen, die tatsaechlich im Inventar vorkommen
  const matchedIds = new Set<string>();
  for (const item of items) {
    const match = matchWingetId(item.displayName, packages, WINGET_BASE_SET);
    if (match && !match.packageId) matchedIds.add(match.wingetId);
  }
  const versions = await latestVersionsFor(Array.from(matchedIds));
  return { available: true, data: buildSoftwareOverview(items, packages, WINGET_BASE_SET, versions, rules), snapshot: read.meta };
}

export async function listSoftwareDevices(tenant: ManagedTenant, detectedAppId: string) {
  return getDeviceProvider().listDetectedAppDevices({ tenantId: tenant.id as TenantId, correlationId: randomUUID() }, detectedAppId);
}

/**
 * Sperrliste gegen das Inventar: je Treffer ein Alert (Fingerabdruck aus
 * Regel und Software, stabil ueber Laeufe), Benachrichtigung bei neuen.
 */
export async function evaluateBlockedSoftware(target: { id: string; mspId: string; displayName: string }, items: SoftwareInventoryItem[]): Promise<number> {
  const rules = await listBlockRules(target.mspId);
  if (rules.length === 0) return 0;
  const packages = await packageRefs(target.mspId);
  const findings: AnomalyFinding[] = [];
  const now = new Date().toISOString();
  const byKey = new Map<string, { rule: SoftwareBlockRule; name: string; devices: number; versions: Set<string> }>();
  for (const item of items) {
    const wingetId = matchWingetId(item.displayName, packages, WINGET_BASE_SET)?.wingetId ?? null;
    const rule = matchBlockRule(item.displayName, wingetId, rules);
    if (!rule) continue;
    const key = `${rule.id}|${item.displayName.toLowerCase()}`;
    const entry = byKey.get(key) ?? { rule, name: item.displayName, devices: 0, versions: new Set<string>() };
    entry.devices += item.deviceCount;
    if (item.version) entry.versions.add(item.version);
    byKey.set(key, entry);
  }
  for (const [key, e] of byKey) {
    findings.push({
      ruleId: 'blocked-software',
      severity: 'medium',
      fingerprint: createHash('sha256').update(`blocked-software|${target.id}|${key}`).digest('hex').slice(0, 32),
      title: `Gesperrte Software: ${e.name}`,
      summary: `${e.name} ist auf ${e.devices} Geraet${e.devices === 1 ? '' : 'en'} installiert und trifft die Sperrregel "${e.rule.pattern}"${e.rule.note ? ` (${e.rule.note})` : ''}.`,
      userId: null,
      userPrincipalName: null,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrences: e.devices,
      evidence: { software: e.name, rule: e.rule.pattern, ruleKind: e.rule.kind, devices: e.devices, versions: Array.from(e.versions).slice(0, 10) },
    });
  }
  const created = await storeFindings(target.mspId, target.id, findings);
  if (created.length > 0) {
    await notify(target.displayName, created).catch((error: Error) => console.error(`Alert mail failed for tenant ${target.id}:`, error.message));
  }
  return findings.length;
}

/** Nach jedem Software-Sync die Sperrliste anwenden. */
export async function onSoftwareSynced(tenantId: string): Promise<void> {
  const { managedTenants } = await import('../db/index.js');
  const tenant = await db.query.managedTenants.findFirst({ where: eq(managedTenants.id, tenantId) });
  if (!tenant) return;
  const read = await getInventoryService().getOrLoad({ tenantId: tenant.id as TenantId, mspId: tenant.mspId as ManagedTenant['mspId'] }, 'software');
  if (!read.payload.available) return;
  await evaluateBlockedSoftware({ id: tenant.id, mspId: tenant.mspId, displayName: tenant.displayName }, read.payload.data.items);
}

// Alte Cache-Zeilen aufraeumen, damit die Tabelle nicht waechst
export async function pruneWingetVersions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const rows = await db.delete(wingetVersions).where(lt(wingetVersions.checkedAt, cutoff)).returning({ id: wingetVersions.packageId });
  return rows.length;
}
