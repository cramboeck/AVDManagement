'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingPage, LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { FlagBadges, KindBadge, flagLabels, visibilityLabels } from '@/components/groups/group-badges';
import type { CapabilityResult, GroupDetail, GroupMember, GroupMemberType } from '@zerostress/types';

const memberTypeLabels: Record<GroupMemberType, string> = {
  user: 'Benutzer',
  guest: 'Gast',
  group: 'Gruppe',
  servicePrincipal: 'Anwendung',
  device: 'Geraet',
  other: 'Sonstige',
};

const memberColumns: ColumnDef<GroupMember>[] = [
  {
    id: 'name',
    header: 'Name',
    accessor: (m) => m.displayName,
    cell: (m) =>
      m.type === 'user' || m.type === 'guest' ? (
        <Link href={`/users/${encodeURIComponent(m.id)}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {m.displayName}
        </Link>
      ) : (
        <span className="font-medium">{m.displayName}</span>
      ),
  },
  { id: 'upn', header: 'UPN', accessor: (m) => m.userPrincipalName, className: 'text-muted-foreground' },
  {
    id: 'type',
    header: 'Typ',
    accessor: (m) => m.type,
    filterOptions: (Object.keys(memberTypeLabels) as GroupMemberType[]).map((t) => ({ value: t, label: memberTypeLabels[t] })),
    cell: (m) => (
      <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', m.type === 'guest' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
        {memberTypeLabels[m.type]}
      </span>
    ),
  },
  {
    id: 'enabled',
    header: 'Konto',
    accessor: (m) => (m.accountEnabled === null ? null : m.accountEnabled ? 'Aktiv' : 'Deaktiviert'),
    filterOptions: [
      { value: 'Aktiv', label: 'Aktiv' },
      { value: 'Deaktiviert', label: 'Deaktiviert' },
    ],
    searchable: false,
    cell: (m) => (m.accountEnabled === null ? <span className="text-muted-foreground">—</span> : <span className={m.accountEnabled ? 'text-success' : 'text-muted-foreground'}>{m.accountEnabled ? 'Aktiv' : 'Deaktiviert'}</span>),
  },
];

export default function GroupDetailPage({ params }: { params: { groupId: string } }) {
  const groupId = decodeURIComponent(params.groupId);
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const router = useRouter();

  const query = useQuery({
    queryKey: ['group', activeTenant?.id, groupId],
    queryFn: () => api.get<CapabilityResult<GroupDetail>>(`/tenants/${activeTenant!.id}/groups/${encodeURIComponent(groupId)}`),
    enabled: !!activeTenant,
    staleTime: 2 * 60 * 1000,
  });

  if (tenantLoading) return <LoadingPage message="Lade Tenant..." />;
  if (!activeTenant) return <NoTenantSelected />;
  if (query.isLoading) return <LoadingPage message="Lade Gruppe..." />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const result = query.data;
  if (!result) return <EmptyState title="Gruppe nicht gefunden" />;
  if (!result.available) return <CapabilityNotice what="die Gruppe" reason={result.reason} missingPermission={result.missingPermission} detail={result.detail} />;
  const { group, owners, members, membersTruncated } = result.data;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Link href="/groups" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Zurueck zur Gruppenliste">
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{group.displayName}</h1>
          <p className="text-sm text-muted-foreground">
            {group.mail ?? '—'}
            {group.description && <> · {group.description}</>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <KindBadge kind={group.kind} />
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{visibilityLabels[group.visibility]}</span>
            <FlagBadges flags={group.flags} />
          </div>
        </div>
      </div>

      {group.flags.length > 0 && (
        <ul className="rounded-lg border border-dashed p-4 text-sm">
          {group.flags.map((f) => (
            <li key={f}>
              <span className="font-medium">{flagLabels[f].label}:</span> {flagLabels[f].hint}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Eckdaten</h2>
          <dl className="grid gap-y-2 text-sm">
            <Row label="Mitglieder" value={group.memberCount === null ? 'mehr als 2000' : String(group.memberCount)} />
            <Row label="Gaeste" value={group.guestCount === null ? '—' : String(group.guestCount)} />
            <Row label="Besitzer" value={String(group.ownerCount)} />
            <Row label="Mitgliedschaft" value={group.isDynamic ? 'dynamisch (Regel)' : 'zugewiesen'} />
            <Row label="Quelle" value={group.onPremisesSynced ? 'Lokales AD (synchronisiert)' : 'Cloud'} />
            <Row label="Erstellt" value={group.createdAt ? formatDateTime(group.createdAt) : '—'} />
            <Row label="Zuletzt verlaengert" value={group.renewedAt ? formatDateTime(group.renewedAt) : '—'} />
          </dl>
        </section>

        <section className="rounded-lg border p-4 lg:col-span-2">
          <h2 className="mb-3 font-medium">Besitzer</h2>
          {owners.length === 0 ? (
            <p className="text-sm text-destructive">Diese Gruppe hat keinen Besitzer.</p>
          ) : (
            <ul className="divide-y">
              {owners.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-1.5 text-sm">
                  {o.type === 'user' || o.type === 'guest' ? (
                    <Link href={`/users/${encodeURIComponent(o.id)}`} className="font-medium text-primary hover:underline">
                      {o.displayName}
                    </Link>
                  ) : (
                    <span className="font-medium">{o.displayName}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{o.userPrincipalName ?? memberTypeLabels[o.type]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">Mitglieder</h2>
        {membersTruncated && <p className="text-xs text-warning">Es werden nur die ersten 2000 Mitglieder geladen.</p>}
        {members.length === 0 ? (
          <EmptyState title="Keine Mitglieder" />
        ) : query.isFetching && !members.length ? (
          <LoadingTable rows={5} />
        ) : (
          <DataTable
            rows={members}
            columns={memberColumns}
            getRowId={(m) => m.id}
            storageKey="group-members"
            initialSort={{ columnId: 'name', direction: 'asc' }}
            searchPlaceholder="Name, UPN..."
            onRowClick={(m) => (m.type === 'user' || m.type === 'guest' ? router.push(`/users/${encodeURIComponent(m.id)}`) : undefined)}
            exportFileName={`gruppe-${group.displayName}`}
            dense
          />
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
