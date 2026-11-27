/**
 * Zwischenspeicher fuer Tenant-Dashboards im API-Prozess.
 *
 * Frisch (bis maxAgeMs) wird direkt geliefert, danach bis staleMs der alte
 * Stand mit Erneuerung im Hintergrund, spaeter wird gewartet. Gleichzeitige
 * Aufrufe fuer denselben Tenant teilen sich einen Abruf. Schluessel ist die
 * Tenant-Id; ein Tenant sieht nie den Stand eines anderen.
 */

import type { ManagedTenant, TenantDashboard } from '@zerostress/types';

interface Entry {
  value: TenantDashboard | null;
  at: number;
  inflight: Promise<TenantDashboard> | null;
}

export interface DashboardCacheOptions {
  maxAgeMs?: number;
  staleMs?: number;
  now?: () => number;
}

export class DashboardCache {
  private readonly entries = new Map<string, Entry>();
  private readonly maxAgeMs: number;
  private readonly staleMs: number;
  private readonly now: () => number;

  constructor(
    private readonly build: (tenant: ManagedTenant) => Promise<TenantDashboard>,
    options: DashboardCacheOptions = {}
  ) {
    this.maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
    this.staleMs = options.staleMs ?? 30 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  async get(tenant: ManagedTenant, options: { refresh?: boolean } = {}): Promise<TenantDashboard> {
    const entry = this.entries.get(tenant.id) ?? { value: null, at: 0, inflight: null };
    this.entries.set(tenant.id, entry);
    const age = this.now() - entry.at;

    if (!options.refresh && entry.value && age < this.maxAgeMs) return entry.value;
    if (!options.refresh && entry.value && age < this.staleMs) {
      void this.load(tenant, entry).catch(() => undefined);
      return entry.value;
    }
    return this.load(tenant, entry);
  }

  /** Nach Aenderungen am Tenant (z. B. Consent) den Stand verwerfen. */
  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
  }

  private load(tenant: ManagedTenant, entry: Entry): Promise<TenantDashboard> {
    if (entry.inflight) return entry.inflight;
    entry.inflight = this.build(tenant)
      .then((value) => {
        entry.value = value;
        entry.at = this.now();
        return value;
      })
      .finally(() => {
        entry.inflight = null;
      });
    return entry.inflight;
  }
}
