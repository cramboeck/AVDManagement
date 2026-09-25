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
import { FlagBadges, KindBadge, kindLabels, visibilityLabels } from '@/components/groups/group-badges';
import type { GroupFlag, GroupInventory, GroupKind, GroupSummary, GroupVisibility } from '@zerostress/types';

const flagFilter: { value: GroupFlag; label: string }[] = [
  { value: 'ownerless', label: 'Ohne Besitzer' },
  { value: 'single-owner', label: 'Ein Besitzer' },
  { value: 'public-team', label: 'Oeffentliches Team' },
  { value: 'has-guests', label: 'Mit Gaesten' },
  { value: 'dynamic', label: 'Dynamisch' },
  { value: 'empty', label: 'Leer' },
];

const columns: ColumnDef<GroupSummary>[] = [
  {
    id: 'name',
    header: 'Gruppe',
    accessor: (g) => g.displayName,
    cell: (g) => (
      <>
        <span className="block font-medium">{g.displayName}</span>
        <span className="block truncate text-xs text-muted-foreground">{g.mail ?? g.description ?? ''}</span>
      </>
    ),
  },
  {
    id: 'kind',
    header: 'Typ',
    accessor: (g) => g.kind,
    filterOptions: (Object.keys(kindLabels) as GroupKind[]).map((k) => ({ value: k, label: kindLabels[k] })),
    cell: (g) => <KindBadge kind={g.kind} />,
  },
  {
    id: 'visibility',
    header: 'Sichtbarkeit',
    accessor: (g) => g.visibility,
    filterOptions: (['Public', 'Private', 'HiddenMembership'] as GroupVisibility[]).map((v) => ({ value: v, label: visibilityLabels[v] })),
    cell: (g) => <span className={clsx(g.visibility === 'Public' && g.kind === 'team' && 'text-warning')}>{visibilityLabels[g.visibility]}</span>,
    searchable: false,
  },
  { id: 'owners', header: 'Besitzer', accessor: (g) => g.ownerCount, align: 'right', cell: (g) => <span className={clsx('tabular-nums', g.ownerCount === 0 && (g.kind === 'team' || g.kind === 'microsoft365') && 'text-destructive')}>{g.ownerCount}</span> },
  { id: 'members', header: 'Mitglieder', accessor: (g) => g.memberCount, align: 'right', cell: (g) => <span className="tabular-nums">{g.memberCount ?? '—'}</span> },
  { id: 'guests', header: 'Gaeste', accessor: (g) => g.guestCount, align: 'right', cell: (g) => <span className={clsx('tabular-nums', (g.guestCount ?? 0) > 0 && 'text-primary')}>{g.guestCount ?? '—'}</span> },
  {
    id: 'flags',
    header: 'Auffaellig',
    // Filter arbeitet auf dem ersten Flag; Suche trifft alle
    accessor: (g) => g.flags.join(' '),
    sortValue: (g) => -g.flags.length,
    filterOptions: flagFilter,
    filterLabel: 'Auffaelligkeit',
    cell: (g) => <FlagBadges flags={g.flags} />,
  },
  { id: 'created', header: 'Erstellt', accessor: (g) => (g.createdAt ? new Date(g.createdAt) : null), cell: (g) => <span className="text-muted-foreground">{g.createdAt ? formatDateTime(g.createdAt) : '—'}</span>, defaultHidden: true },
  { id: 'sync', header: 'Quelle', accessor: (g) => (g.onPremisesSynced ? 'Lokales AD' : 'Cloud'), filterOptions: [{ value: 'Cloud', label: 'Cloud' }, { value: 'Lokales AD', label: 'Lokales AD' }], defaultHidden: true, searchable: false },
];

export default function GroupsPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const router = useRouter();

  const query = useQuery({
    queryKey: ['groups', activeTenant?.id],
    queryFn: () => api.get<GroupInventory>(`/tenants/${activeTenant!.id}/groups`),
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
          <h1 className="text-2xl font-semibold">Gruppen</h1>
          <p className="text-sm text-muted-foreground">Teams, Microsoft 365-, Sicherheits- und Verteilergruppen mit Besitzern, Gaesten und Auffaelligkeiten.</p>
        </div>
        <SnapshotStatus tenantId={activeTenant.id} kinds={['groups']} invalidate={[['groups', activeTenant.id]]} />
      </div>

      {query.isLoading ? (
        <LoadingTable rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !inventory ? null : !inventory.available ? (
        <CapabilityNotice what="die Gruppen" reason={inventory.reason} missingPermission={inventory.missingPermission} detail={inventory.detail} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Gruppen" value={inventory.data.stats.total} />
            <Stat label="Teams" value={inventory.data.stats.teams} />
            <Stat label="Ohne Besitzer" value={inventory.data.stats.ownerless} tone={inventory.data.stats.ownerless > 0 ? 'destructive' : undefined} />
            <Stat label="Oeffentliche Teams" value={inventory.data.stats.publicTeams} tone={inventory.data.stats.publicTeams > 0 ? 'warning' : undefined} />
            <Stat label="Mit Gaesten" value={inventory.data.stats.withGuests} />
            <Stat label="Dynamisch" value={inventory.data.stats.dynamic} />
          </div>

          {inventory.data.countsTruncated && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
              Der Tenant hat sehr viele Gruppen; Mitglieder- und Gastzahlen wurden nur fuer die ersten 1500 ermittelt.
            </p>
          )}

          {inventory.data.items.length === 0 ? (
            <EmptyState title="Keine Gruppen" description="In diesem Tenant gibt es keine Gruppen." />
          ) : (
            <DataTable
              rows={inventory.data.items}
              columns={columns}
              getRowId={(g) => g.id}
              storageKey="groups"
              initialSort={{ columnId: 'flags', direction: 'asc' }}
              searchPlaceholder="Name, E-Mail, Beschreibung..."
              onRowClick={(g) => router.push(`/groups/${encodeURIComponent(g.id)}`)}
              exportFileName="gruppen"
            />
          )}
        </>
      )}
    </div>
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
