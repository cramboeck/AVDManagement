'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState, NoResults } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import {
  ComplianceBadge,
  ExposureBadge,
  RiskBadge,
  SourceChips,
  complianceLabels,
  formatRelative,
} from '@/components/devices/device-badges';
import type { Device, DeviceInventory, DeviceComplianceState, DeviceExposureLevel } from '@zerostress/types';

type ComplianceFilter = 'all' | DeviceComplianceState;
type ExposureFilter = 'all' | DeviceExposureLevel;
type SourceFilter = 'all' | 'intune-only' | 'defender-only' | 'both';

export default function DevicesPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [compliance, setCompliance] = useState<ComplianceFilter>('all');
  const [exposure, setExposure] = useState<ExposureFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');

  const inventoryQuery = useQuery({
    queryKey: ['devices', activeTenant?.id],
    queryFn: () => api.get<DeviceInventory>(`/tenants/${activeTenant!.id}/devices`),
    enabled: !!activeTenant,
    staleTime: 5 * 60 * 1000,
  });

  const devices = inventoryQuery.data?.items ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (term && !`${d.name} ${d.primaryUser ?? ''} ${d.operatingSystem ?? ''}`.toLowerCase().includes(term)) return false;
      if (compliance !== 'all' && d.intune?.complianceState !== compliance) return false;
      if (exposure !== 'all' && d.defender?.exposureLevel !== exposure) return false;
      if (source === 'intune-only' && (!d.intune || d.defender)) return false;
      if (source === 'defender-only' && (d.intune || !d.defender)) return false;
      if (source === 'both' && !(d.intune && d.defender)) return false;
      return true;
    });
  }, [devices, search, compliance, exposure, source]);

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;

  const inventory = inventoryQuery.data;
  const counts = {
    total: devices.length,
    noncompliant: devices.filter((d) => d.intune?.complianceState === 'noncompliant').length,
    highExposure: devices.filter((d) => d.defender?.exposureLevel === 'High').length,
    stale: devices.filter((d) => d.lastActivityAt && Date.now() - new Date(d.lastActivityAt).getTime() > 30 * 86400000).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Geraete</h1>
          <p className="text-sm text-muted-foreground">
            Alle Endpunkte aus Intune und Defender for Endpoint — Compliance, Exposure und offene Sicherheitsupdates.
          </p>
        </div>
        <button
          onClick={() => inventoryQuery.refetch()}
          disabled={inventoryQuery.isFetching}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          {inventoryQuery.isFetching ? 'Aktualisiere...' : 'Aktualisieren'}
        </button>
      </div>

      {inventoryQuery.isLoading ? (
        <LoadingTable rows={8} />
      ) : inventoryQuery.error ? (
        <ErrorState error={inventoryQuery.error as Error} onRetry={inventoryQuery.refetch} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Geraete" value={counts.total} />
            <Stat label="Nicht konform" value={counts.noncompliant} tone={counts.noncompliant > 0 ? 'destructive' : undefined} />
            <Stat label="Exposure hoch" value={counts.highExposure} tone={counts.highExposure > 0 ? 'destructive' : undefined} />
            <Stat label="Seit 30 Tagen inaktiv" value={counts.stale} tone={counts.stale > 0 ? 'warning' : undefined} />
          </div>

          {inventory && !inventory.intune.available && (
            <CapabilityNotice what="Intune-Geraete" {...inventory.intune} compact />
          )}
          {inventory && !inventory.defender.available && (
            <CapabilityNotice what="Defender-Daten (Exposure, Schwachstellen, fehlende Updates)" {...inventory.defender} compact />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Name, Benutzer oder OS..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-64 rounded-md border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Geraete suchen"
            />
            <Select value={compliance} onChange={(v) => setCompliance(v as ComplianceFilter)} label="Compliance">
              <option value="all">Compliance: alle</option>
              {(Object.keys(complianceLabels) as DeviceComplianceState[]).map((s) => (
                <option key={s} value={s}>
                  {complianceLabels[s]}
                </option>
              ))}
            </Select>
            <Select value={exposure} onChange={(v) => setExposure(v as ExposureFilter)} label="Exposure">
              <option value="all">Exposure: alle</option>
              {(['High', 'Medium', 'Low', 'None', 'Unknown'] as DeviceExposureLevel[]).map((l) => (
                <option key={l} value={l}>
                  Exposure {l}
                </option>
              ))}
            </Select>
            <Select value={source} onChange={(v) => setSource(v as SourceFilter)} label="Quelle">
              <option value="all">Quelle: alle</option>
              <option value="both">In Intune und Defender</option>
              <option value="intune-only">Nur Intune</option>
              <option value="defender-only">Nur Defender</option>
            </Select>
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} von {devices.length}
            </span>
          </div>

          {devices.length === 0 ? (
            <EmptyState
              title="Keine Geraete gefunden"
              description="In diesem Tenant sind weder Intune-verwaltete noch Defender-onboardete Geraete sichtbar."
            />
          ) : filtered.length === 0 ? (
            <NoResults query={search} />
          ) : (
            <DeviceTable devices={filtered} onOpen={(d) => router.push(`/devices/${encodeURIComponent(d.id)}`)} />
          )}
        </>
      )}
    </div>
  );
}

function DeviceTable({ devices, onOpen }: { devices: Device[]; onOpen: (device: Device) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Geraet</th>
            <th className="px-3 py-2 font-medium">Betriebssystem</th>
            <th className="px-3 py-2 font-medium">Compliance</th>
            <th className="px-3 py-2 font-medium">Defender</th>
            <th className="px-3 py-2 font-medium">Zuletzt aktiv</th>
            <th className="px-3 py-2 font-medium">Quellen</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr
              key={d.id}
              tabIndex={0}
              onClick={() => onOpen(d)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen(d);
              }}
              className="cursor-pointer border-b last:border-0 hover:bg-accent/50 focus:outline-none focus-visible:bg-accent"
            >
              <td className="px-3 py-2">
                <span className="block font-medium">{d.name}</span>
                <span className="block text-xs text-muted-foreground">{d.primaryUser ?? '—'}</span>
              </td>
              <td className="px-3 py-2">
                <span className="block">{d.operatingSystem ?? '—'}</span>
                <span className="block text-xs text-muted-foreground">{d.osVersion ?? ''}</span>
              </td>
              <td className="px-3 py-2">
                {d.intune ? <ComplianceBadge state={d.intune.complianceState} /> : <span className="text-xs text-muted-foreground">nicht in Intune</span>}
              </td>
              <td className="px-3 py-2">
                {d.defender ? (
                  <span className="flex flex-wrap gap-1">
                    <ExposureBadge level={d.defender.exposureLevel} />
                    <RiskBadge score={d.defender.riskScore} />
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">nicht onboarded</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground" title={d.lastActivityAt ?? undefined}>
                {formatRelative(d.lastActivityAt)}
              </td>
              <td className="px-3 py-2">
                <SourceChips intune={!!d.intune} defender={!!d.defender} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Select({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-9 rounded-md border bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
    </select>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'destructive' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>{value}</p>
    </div>
  );
}
