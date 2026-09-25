'use client';

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
import { formatDateTime } from '@/components/identity/sign-in-table';
import { appTypeLabels, describeTarget, intentLabels } from '@/components/apps/app-badges';
import type { AppInventory, IntuneApp, IntuneAppType } from '@zerostress/types';

const columns: ColumnDef<IntuneApp>[] = [
  {
    id: 'name',
    header: 'App',
    accessor: (a) => a.displayName,
    cell: (a) => (
      <>
        <span className="block font-medium">{a.displayName}</span>
        <span className="block text-xs text-muted-foreground">{a.publisher ?? '—'}</span>
      </>
    ),
  },
  { id: 'publisher', header: 'Hersteller', accessor: (a) => a.publisher, defaultHidden: true },
  {
    id: 'type',
    header: 'Typ',
    accessor: (a) => a.type,
    filterOptions: (Object.keys(appTypeLabels) as IntuneAppType[]).map((t) => ({ value: t, label: appTypeLabels[t] })),
    cell: (a) => <span className="text-muted-foreground">{appTypeLabels[a.type]}</span>,
    searchable: false,
  },
  { id: 'version', header: 'Version', accessor: (a) => a.version, className: 'font-mono text-xs' },
  {
    id: 'assigned',
    header: 'Zuweisungen',
    accessor: (a) => (a.isAssigned ? 'assigned' : 'unassigned'),
    filterOptions: [
      { value: 'assigned', label: 'Zugewiesen' },
      { value: 'unassigned', label: 'Nicht zugewiesen' },
    ],
    filterLabel: 'Zuweisung',
    sortValue: (a) => -a.assignments.length,
    searchable: false,
    cell: (a) =>
      a.assignments.length === 0 ? (
        <span className="text-xs text-muted-foreground">keine</span>
      ) : (
        <span className="text-xs">
          {a.assignments.slice(0, 3).map((s) => `${intentLabels[s.intent]}: ${describeTarget(s)}`).join(' · ')}
          {a.assignments.length > 3 && ` · +${a.assignments.length - 3}`}
        </span>
      ),
  },
  { id: 'installed', header: 'Installiert', accessor: (a) => a.install?.installed ?? null, align: 'right', cell: (a) => <span className="tabular-nums">{a.install ? a.install.installed : '—'}</span> },
  {
    id: 'failed',
    header: 'Fehlgeschlagen',
    accessor: (a) => a.install?.failed ?? null,
    align: 'right',
    cell: (a) => <span className={clsx('tabular-nums', (a.install?.failed ?? 0) > 0 && 'text-destructive')}>{a.install ? a.install.failed : '—'}</span>,
  },
  { id: 'pending', header: 'Ausstehend', accessor: (a) => a.install?.pending ?? null, align: 'right', cell: (a) => <span className="tabular-nums text-muted-foreground">{a.install ? a.install.pending : '—'}</span> },
  { id: 'modified', header: 'Geaendert', accessor: (a) => (a.modifiedAt ? new Date(a.modifiedAt) : null), cell: (a) => <span className="text-muted-foreground">{a.modifiedAt ? formatDateTime(a.modifiedAt) : '—'}</span>, defaultHidden: true },
];

export default function AppsPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const router = useRouter();

  const query = useQuery({
    queryKey: ['apps', activeTenant?.id],
    queryFn: () => api.get<AppInventory>(`/tenants/${activeTenant!.id}/apps`),
    enabled: !!activeTenant,
    staleTime: 5 * 60 * 1000,
  });

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;
  const inventory = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Apps</h1>
          <p className="text-sm text-muted-foreground">Intune-Anwendungen mit Zuweisungen und Installationsstatus. Zuweisungen laufen als Jobs mit Vorschau.</p>
        </div>
        <SnapshotStatus tenantId={activeTenant.id} kinds={['apps']} invalidate={[['apps', activeTenant.id]]} />
      </div>

      {query.isLoading ? (
        <LoadingTable rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !inventory ? null : !inventory.available ? (
        <CapabilityNotice what="die Intune-Apps" reason={inventory.reason} missingPermission={inventory.missingPermission} detail={inventory.detail} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            <Stat label="Apps" value={inventory.data.stats.total} />
            <Stat label="Zugewiesen" value={inventory.data.stats.assigned} />
            <Stat label="Mit Fehlern" value={inventory.data.stats.withFailures} tone={inventory.data.stats.withFailures > 0 ? 'destructive' : undefined} />
            <Stat label="Win32" value={inventory.data.stats.win32} />
            <Stat label="winget" value={inventory.data.stats.winget} />
          </div>
          {!inventory.data.summaryAvailable && (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Der Intune-Installationsbericht ist nicht verfuegbar; Zahlen zu installiert und fehlgeschlagen fehlen daher.</p>
          )}
          {inventory.data.items.length === 0 ? (
            <EmptyState title="Keine Apps" description="In Intune sind fuer diesen Tenant keine Windows-Apps angelegt." />
          ) : (
            <DataTable
              rows={inventory.data.items}
              columns={columns}
              getRowId={(a) => a.id}
              storageKey="apps"
              initialSort={{ columnId: 'name', direction: 'asc' }}
              searchPlaceholder="App, Hersteller, Version..."
              onRowClick={(a) => router.push(`/apps/${encodeURIComponent(a.id)}`)}
              exportFileName="apps"
            />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'destructive' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'destructive' && 'text-destructive')}>{value}</p>
    </div>
  );
}
