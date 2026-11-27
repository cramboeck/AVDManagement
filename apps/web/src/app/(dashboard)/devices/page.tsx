'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { SnapshotStatus } from '@/components/inventory/snapshot-status';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import {
  ComplianceBadge,
  ExposureBadge,
  RiskBadge,
  SourceChips,
  complianceLabels,
  formatRelative,
} from '@/components/devices/device-badges';
import type { Job, Device, DeviceInventory, DeviceComplianceState, DeviceExposureLevel, DeviceRiskScore } from '@zerostress/types';

const exposureRank: Record<DeviceExposureLevel, number> = { High: 0, Medium: 1, Low: 2, None: 3, Unknown: 4 };
const riskRank: Record<DeviceRiskScore, number> = { High: 0, Medium: 1, Low: 2, Informational: 3, None: 4, Unknown: 5 };

function sourceOf(d: Device): 'both' | 'intune-only' | 'defender-only' {
  if (d.intune && d.defender) return 'both';
  return d.intune ? 'intune-only' : 'defender-only';
}

export default function DevicesPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'sync' | 'restart' | 'defender-scan' | null>(null);

  const inventoryQuery = useQuery({
    queryKey: ['devices', activeTenant?.id],
    queryFn: () => api.get<DeviceInventory>(`/tenants/${activeTenant!.id}/devices`),
    enabled: !!activeTenant,
    staleTime: 5 * 60 * 1000,
  });

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;

  const inventory = inventoryQuery.data;
  const devices = inventory?.items ?? [];
  const intuneAvailable = inventory?.intune.available ?? true;
  const defenderAvailable = inventory?.defender.available ?? true;

  const counts = {
    total: devices.length,
    noncompliant: devices.filter((d) => d.intune?.complianceState === 'noncompliant').length,
    highExposure: devices.filter((d) => d.defender?.exposureLevel === 'High').length,
    stale: devices.filter((d) => d.lastActivityAt && Date.now() - new Date(d.lastActivityAt).getTime() > 30 * 86400000).length,
  };

  const columns: ColumnDef<Device>[] = [
    {
      id: 'name',
      header: 'Geraet',
      accessor: (d) => d.name,
      cell: (d) => (
        <>
          <span className="block font-medium">{d.name}</span>
          <span className="block text-xs text-muted-foreground">{d.primaryUser ?? '—'}</span>
        </>
      ),
    },
    { id: 'primaryUser', header: 'Benutzer', accessor: (d) => d.primaryUser, defaultHidden: true },
    {
      id: 'os',
      header: 'Betriebssystem',
      accessor: (d) => [d.operatingSystem, d.osVersion].filter(Boolean).join(' ') || null,
      cell: (d) => (
        <>
          <span className="block">{d.operatingSystem ?? '—'}</span>
          <span className="block text-xs text-muted-foreground">{d.osVersion ?? ''}</span>
        </>
      ),
    },
    {
      id: 'compliance',
      header: 'Compliance',
      accessor: (d) => d.intune?.complianceState ?? null,
      filterOptions: (Object.keys(complianceLabels) as DeviceComplianceState[]).map((s) => ({ value: s, label: complianceLabels[s] })),
      cell: (d) =>
        d.intune ? (
          <ComplianceBadge state={d.intune.complianceState} />
        ) : (
          <span className="text-xs text-muted-foreground">{intuneAvailable ? 'nicht in Intune' : 'Intune nicht verfuegbar'}</span>
        ),
    },
    {
      id: 'exposure',
      header: 'Exposure',
      accessor: (d) => d.defender?.exposureLevel ?? null,
      sortValue: (d) => (d.defender ? exposureRank[d.defender.exposureLevel] : 99),
      filterOptions: (['High', 'Medium', 'Low', 'None', 'Unknown'] as DeviceExposureLevel[]).map((l) => ({ value: l, label: `Exposure ${l}` })),
      cell: (d) =>
        d.defender ? (
          <ExposureBadge level={d.defender.exposureLevel} />
        ) : (
          <span className="text-xs text-muted-foreground" title={defenderAvailable ? 'Kein Defender-Datensatz fuer dieses Geraet' : 'Defender-Quelle nicht verfuegbar, siehe Hinweis oben'}>
            {defenderAvailable ? 'nicht onboarded' : 'Defender nicht verfuegbar'}
          </span>
        ),
    },
    {
      id: 'risk',
      header: 'Risiko',
      accessor: (d) => d.defender?.riskScore ?? null,
      sortValue: (d) => (d.defender ? riskRank[d.defender.riskScore] : 99),
      filterOptions: (['High', 'Medium', 'Low', 'Informational', 'None'] as DeviceRiskScore[]).map((r) => ({ value: r, label: `Risiko ${r}` })),
      cell: (d) => (d.defender ? <RiskBadge score={d.defender.riskScore} /> : <span className="text-xs text-muted-foreground">—</span>),
    },
    {
      id: 'lastActivity',
      header: 'Zuletzt aktiv',
      accessor: (d) => (d.lastActivityAt ? new Date(d.lastActivityAt) : null),
      cell: (d) => (
        <span className="text-muted-foreground" title={d.lastActivityAt ?? undefined}>
          {formatRelative(d.lastActivityAt)}
        </span>
      ),
    },
    {
      id: 'source',
      header: 'Quellen',
      accessor: (d) => sourceOf(d),
      filterOptions: [
        { value: 'both', label: 'In Intune und Defender' },
        { value: 'intune-only', label: 'Nur Intune' },
        { value: 'defender-only', label: 'Nur Defender' },
      ],
      filterLabel: 'Quelle',
      searchable: false,
      cell: (d) => <SourceChips intune={!!d.intune} defender={!!d.defender} />,
    },
    { id: 'serial', header: 'Seriennummer', accessor: (d) => d.intune?.serialNumber ?? null, defaultHidden: true, className: 'font-mono text-xs' },
    { id: 'model', header: 'Modell', accessor: (d) => [d.intune?.manufacturer, d.intune?.model].filter(Boolean).join(' ') || null, defaultHidden: true },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Geraete</h1>
          <p className="text-sm text-muted-foreground">
            Alle Endpunkte aus Intune und Defender for Endpoint — Compliance, Exposure und offene Sicherheitsupdates.
          </p>
        </div>
        <SnapshotStatus tenantId={activeTenant.id} kinds={['devices']} invalidate={[['devices', activeTenant.id]]} />
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

          {inventory && !inventory.intune.available && <CapabilityNotice what="Intune-Geraete" {...inventory.intune} compact />}
          {inventory && !inventory.defender.available && (
            <CapabilityNotice what="Defender-Daten (Exposure, Schwachstellen, fehlende Updates)" {...inventory.defender} compact />
          )}

          {devices.length === 0 ? (
            <EmptyState
              title="Keine Geraete gefunden"
              description="In diesem Tenant sind weder Intune-verwaltete noch Defender-onboardete Geraete sichtbar."
            />
          ) : (
            <>
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-accent/50 px-4 py-2 text-sm" role="region" aria-label="Sammelaktionen">
                  <span className="font-medium">{selected.size} ausgewaehlt</span>
                  {selected.size > 50 && <span className="text-xs text-destructive">Hoechstens 50 je Sammelaktion</span>}
                  <button onClick={() => setBulkAction('sync')} disabled={selected.size > 50} className="rounded-md border px-3 py-1 text-xs hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
                    Synchronisieren
                  </button>
                  <button onClick={() => setBulkAction('defender-scan')} disabled={selected.size > 50} className="rounded-md border px-3 py-1 text-xs hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
                    Defender-Schnellscan
                  </button>
                  <button onClick={() => setBulkAction('restart')} disabled={selected.size > 50} className="rounded-md border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:opacity-50">
                    Neu starten
                  </button>
                  <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    Auswahl aufheben
                  </button>
                </div>
              )}
              <DataTable
                rows={devices}
                columns={columns}
                getRowId={(d) => d.id}
                storageKey="devices"
                initialSort={{ columnId: 'name', direction: 'asc' }}
                searchPlaceholder="Name, Benutzer, OS, Seriennummer..."
                onRowClick={(d) => router.push(`/devices/${encodeURIComponent(d.id)}`)}
                exportFileName="geraete"
                // Nur Intune-verwaltete Geraete lassen sich per Intune-Aktion ansprechen
                selectedIds={selected}
                onSelectionChange={setSelected}
                isSelectable={(d) => !!d.intune}
              />
              {bulkAction && (
                <JobActionDialog
                  title={`${bulkAction === 'sync' ? 'Synchronisieren' : bulkAction === 'restart' ? 'Neu starten' : 'Defender-Schnellscan'}: ${selected.size} Geraete`}
                  description="Ein Job, eine Vorschau je Geraet; das Ergebnis steht je Geraet im Job."
                  confirmLabel={bulkAction === 'restart' ? 'Neu starten' : 'Starten'}
                  tone={bulkAction === 'restart' ? 'destructive' : 'default'}
                  createJob={() =>
                    api.post<Job>(`/tenants/${activeTenant.id}/jobs/device-bulk`, {
                      action: bulkAction,
                      devices: devices.filter((d) => selected.has(d.id) && d.intune).map((d) => ({ managedDeviceId: d.intune!.managedDeviceId, deviceName: d.name })),
                    })
                  }
                  renderResult={(job) => <DeviceBulkResult job={job} />}
                  onClose={() => setBulkAction(null)}
                  onCompleted={() => setSelected(new Set())}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function DeviceBulkResult({ job }: { job: Job }) {
  const outcomes = (job.result as { outcomes?: Array<{ managedDeviceId: string; deviceName: string; success: boolean; message: string | null }> } | null)?.outcomes ?? [];
  if (outcomes.length === 0) return <p className="text-sm text-muted-foreground">{job.error ?? 'Kein Ergebnis.'}</p>;
  return (
    <ul className="max-h-64 space-y-1 overflow-auto text-sm">
      {outcomes.map((o) => (
        <li key={o.managedDeviceId} className="flex justify-between gap-3">
          <span>{o.deviceName}</span>
          <span className={o.success ? 'text-success' : 'text-destructive'}>{o.success ? 'angefordert' : o.message ?? 'fehlgeschlagen'}</span>
        </li>
      ))}
    </ul>
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
