'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { SnapshotStatus } from '@/components/inventory/snapshot-status';
import { BulkWingetDialog, type BulkMode } from '@/components/software/bulk-winget-dialog';
import { BlocklistPanel } from '@/components/software/blocklist-panel';
import type { SoftwareBlockRule, SoftwareCatalogStatus, SoftwareOverview, SoftwareOverviewRow } from '@zerostress/types';

const statusMeta: Record<SoftwareCatalogStatus, { label: string; className: string }> = {
  current: { label: 'aktuell', className: 'bg-success/10 text-success' },
  outdated: { label: 'veraltet', className: 'bg-warning/10 text-warning' },
  unknown: { label: 'unbekannt', className: 'bg-muted text-muted-foreground' },
};

export default function SoftwarePage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ row: SoftwareOverviewRow; mode: BulkMode; versionId?: string | null } | null>(null);

  const query = useQuery({
    queryKey: ['software', activeTenant?.id],
    queryFn: () => api.get<SoftwareOverview>(`/tenants/${activeTenant!.id}/software`),
    enabled: !!activeTenant,
    staleTime: 5 * 60 * 1000,
  });
  const block = useMutation({
    mutationFn: (row: SoftwareOverviewRow) => api.post<SoftwareBlockRule>(`/tenants/${activeTenant!.id}/software/blocklist`, row.wingetId ? { kind: 'winget-id', pattern: row.wingetId, note: row.displayName } : { kind: 'name', pattern: row.displayName, note: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['software-blocklist'] });
      queryClient.invalidateQueries({ queryKey: ['software', activeTenant?.id] });
    },
  });

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;
  const tenantId = activeTenant.id;
  const overview = query.data;

  const columns: ColumnDef<SoftwareOverviewRow>[] = [
    {
      id: 'name',
      header: 'Software',
      accessor: (r) => r.displayName,
      cell: (r) => (
        <>
          <span className={clsx('block font-medium', r.blockedBy && 'text-destructive')}>
            {r.displayName}
            {r.blockedBy && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">gesperrt</span>}
          </span>
          <span className="block text-xs text-muted-foreground">{r.publisher ?? '—'}</span>
        </>
      ),
    },
    {
      id: 'versions',
      header: 'Versionen',
      accessor: (r) => r.versions.map((v) => v.version ?? '?').join(', '),
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.versions.slice(0, 4).map((v) => (
            <span key={v.id} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]" title={`${v.deviceCount} Geraete`}>
              {v.version ?? '?'} <span className="text-muted-foreground">×{v.deviceCount}</span>
            </span>
          ))}
          {r.versions.length > 4 && <span className="text-xs text-muted-foreground">+{r.versions.length - 4}</span>}
        </div>
      ),
    },
    { id: 'devices', header: 'Geraete', accessor: (r) => r.deviceCount, align: 'right', cell: (r) => <span className="tabular-nums">{r.deviceCount}</span> },
    {
      id: 'status',
      header: 'Katalog',
      accessor: (r) => r.status,
      filterOptions: (['outdated', 'current', 'unknown'] as SoftwareCatalogStatus[]).map((s) => ({ value: s, label: statusMeta[s].label })),
      searchable: false,
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className={clsx('inline-flex w-fit rounded-full px-2 py-0.5 text-xs', statusMeta[r.status].className)}>{statusMeta[r.status].label}</span>
          {r.latestVersion && (
            <span className="text-[11px] text-muted-foreground">
              Katalog {r.latestVersion}
              {r.outdatedDevices > 0 ? ` · ${r.outdatedDevices} Geraete alt` : ''}
            </span>
          )}
        </div>
      ),
    },
    { id: 'winget', header: 'winget-Id', accessor: (r) => r.wingetId ?? '', cell: (r) => (r.wingetId ? <span className="font-mono text-xs">{r.wingetId}</span> : <span className="text-xs text-muted-foreground">—</span>) },
    {
      id: 'blocked',
      header: 'Sperre',
      accessor: (r) => (r.blockedBy ? 'gesperrt' : 'frei'),
      filterOptions: [
        { value: 'gesperrt', label: 'Gesperrt' },
        { value: 'frei', label: 'Nicht gesperrt' },
      ],
      searchable: false,
      defaultHidden: true,
    },
    {
      id: 'actions',
      header: '',
      accessor: () => '',
      searchable: false,
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.wingetId && r.status === 'outdated' && (
            <button onClick={() => setDialog({ row: r, mode: 'upgrade' })} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
              Aktualisieren
            </button>
          )}
          {r.wingetId && (
            <button onClick={() => setDialog({ row: r, mode: 'uninstall' })} className="rounded-md border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10">
              Deinstallieren
            </button>
          )}
          {r.packageId ? (
            <Link href={`/apps/catalog/${r.packageId}`} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
              Paket
            </Link>
          ) : r.wingetId ? (
            <Link href={`/apps/catalog?wingetId=${encodeURIComponent(r.wingetId)}`} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
              Als Paket
            </Link>
          ) : null}
          {!r.blockedBy && (
            <button onClick={() => block.mutate(r)} disabled={block.isPending} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
              Sperren
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Software</h1>
          <p className="text-sm text-muted-foreground">Alle von Intune erkannten Programme des Tenants mit Versionen und Geraetezahl, abgeglichen mit dem winget-Katalog. Sammelaktionen laufen als ein Job mit Vorschau je Geraet.</p>
        </div>
        <SnapshotStatus tenantId={tenantId} kinds={['software']} invalidate={[['software', tenantId]]} />
      </div>

      {query.isLoading ? (
        <LoadingTable rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !overview ? null : !overview.available ? (
        <CapabilityNotice what="das Softwareinventar" reason={overview.reason} missingPermission={overview.missingPermission} detail={overview.detail} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Programme" value={overview.data.totals.software} />
            <Stat label="Im winget-Katalog" value={overview.data.totals.matched} sub="per Name zugeordnet" />
            <Stat label="Veraltet" value={overview.data.totals.outdated} tone={overview.data.totals.outdated > 0 ? 'warning' : undefined} />
            <Stat label="Gesperrt" value={overview.data.totals.blocked} tone={overview.data.totals.blocked > 0 ? 'destructive' : undefined} />
          </div>
          {overview.data.rows.length === 0 ? (
            <EmptyState title="Noch kein Inventar" description="Intune hat fuer diesen Tenant noch keine erkannten Apps gemeldet. Der Intune-Client meldet das Inventar etwa woechentlich." />
          ) : (
            <DataTable rows={overview.data.rows} columns={columns} getRowId={(r) => r.key} storageKey="software" initialSort={{ columnId: 'devices', direction: 'desc' }} searchPlaceholder="Software, Hersteller, winget-Id..." exportFileName="software" dense />
          )}
          <BlocklistPanel tenantId={tenantId} />
        </>
      )}

      {dialog && (
        <BulkWingetDialog
          tenantId={tenantId}
          row={dialog.row}
          mode={dialog.mode}
          versionId={dialog.versionId ?? null}
          onClose={() => setDialog(null)}
          onCompleted={() => {
            queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] });
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'warning' | 'destructive' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
