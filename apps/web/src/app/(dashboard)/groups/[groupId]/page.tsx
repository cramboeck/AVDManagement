'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingPage } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { Collapsible } from '@/components/ui/collapsible';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { FlagBadges, KindBadge, flagLabels, kindLabels, visibilityLabels } from '@/components/groups/group-badges';
import { MembershipJobDialog, PickUserDialog, type MembershipAction } from '@/components/groups/membership-dialogs';
import type { CapabilityResult, GroupDetail, GroupMember, GroupMemberType } from '@zerostress/types';

const memberTypeLabels: Record<GroupMemberType, string> = {
  user: 'Benutzer',
  guest: 'Gast',
  group: 'Gruppe',
  servicePrincipal: 'Anwendung',
  device: 'Geraet',
  other: 'Sonstige',
};

type Pending = { action: MembershipAction; target: { objectId: string; objectDisplayName: string; objectUpn: string | null } } | { action: 'add-member' | 'add-owner'; pick: true };

export default function GroupDetailPage({ params }: { params: { groupId: string } }) {
  const groupId = decodeURIComponent(params.groupId);
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);

  const query = useQuery({
    queryKey: ['group', activeTenant?.id, groupId],
    queryFn: () => api.get<CapabilityResult<GroupDetail>>(`/tenants/${activeTenant!.id}/groups/${encodeURIComponent(groupId)}`),
    enabled: !!activeTenant,
    staleTime: 2 * 60 * 1000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['group', activeTenant?.id, groupId] });
    queryClient.invalidateQueries({ queryKey: ['groups', activeTenant?.id] });
    queryClient.invalidateQueries({ queryKey: ['jobs', activeTenant?.id] });
  };

  const group = query.data?.available ? query.data.data.group : null;
  const canEditMembers = !!group && !group.isDynamic && !group.onPremisesSynced;

  const memberColumns: ColumnDef<GroupMember>[] = useMemo(
    () => [
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
          <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', m.type === 'guest' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{memberTypeLabels[m.type]}</span>
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
      {
        id: 'actions',
        header: '',
        accessor: () => null,
        sortable: false,
        searchable: false,
        align: 'right',
        cell: (m) =>
          canEditMembers ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPending({ action: 'remove-member', target: { objectId: m.id, objectDisplayName: m.displayName, objectUpn: m.userPrincipalName } });
              }}
              className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            >
              Entfernen
            </button>
          ) : null,
      },
    ],
    [canEditMembers]
  );

  if (tenantLoading) return <LoadingPage message="Lade Tenant..." />;
  if (!activeTenant) return <NoTenantSelected />;
  if (query.isLoading) return <LoadingPage message="Lade Gruppe..." />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const result = query.data;
  if (!result) return <EmptyState title="Gruppe nicht gefunden" />;
  if (!result.available) return <CapabilityNotice what="die Gruppe" reason={result.reason} missingPermission={result.missingPermission} detail={result.detail} />;
  const { owners, members, membersTruncated } = result.data;
  const g = result.data.group;
  const guests = members.filter((m) => m.type === 'guest').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href="/groups" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Zurueck zur Gruppenliste">
            ←
          </Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{g.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              {g.mail ?? kindLabels[g.kind]}
              {g.description && <> · {g.description}</>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <KindBadge kind={g.kind} />
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{visibilityLabels[g.visibility]}</span>
              {g.isDynamic && <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Dynamisch</span>}
              {g.onPremisesSynced && <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Aus lokalem AD</span>}
              <FlagBadges flags={g.flags} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPending({ action: 'add-owner', pick: true })} disabled={g.onPremisesSynced} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
            Besitzer hinzufuegen
          </button>
          <button onClick={() => setPending({ action: 'add-member', pick: true })} disabled={!canEditMembers} title={canEditMembers ? undefined : g.isDynamic ? 'Dynamische Gruppe: Mitglieder kommen aus der Regel' : 'Aus dem lokalen AD synchronisiert'} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Mitglied hinzufuegen
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Mitglieder" value={g.memberCount === null ? 'mehr als 2000' : String(g.memberCount)} />
        <Stat label="Gaeste" value={String(guests)} tone={guests > 0 ? 'primary' : undefined} />
        <Stat label="Besitzer" value={String(owners.length)} tone={owners.length === 0 && (g.kind === 'team' || g.kind === 'microsoft365') ? 'destructive' : owners.length === 1 ? 'warning' : undefined} />
        <Stat label="Erstellt" value={g.createdAt ? formatDateTime(g.createdAt).split(',')[0] : '—'} />
        <Stat label="Zuletzt verlaengert" value={g.renewedAt ? formatDateTime(g.renewedAt).split(',')[0] : '—'} />
      </div>

      {g.flags.length > 0 && (
        <Collapsible summary={`${g.flags.length} Auffaelligkeit${g.flags.length === 1 ? '' : 'en'}: ${g.flags.map((f) => flagLabels[f].label).join(', ')}`} defaultOpen={g.flags.includes('ownerless') || g.flags.includes('public-team')}>
          <ul className="space-y-1 text-sm">
            {g.flags.map((f) => (
              <li key={f}>
                <span className="font-medium">{flagLabels[f].label}:</span> {flagLabels[f].hint}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      <section className="rounded-lg border p-4">
        <h2 className="mb-2 font-medium">Besitzer</h2>
        {owners.length === 0 ? (
          <p className="text-sm text-destructive">Diese Gruppe hat keinen Besitzer. Niemand kann Mitglieder pflegen oder die Gruppe verlaengern.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {owners.map((o) => (
              <li key={o.id} className="flex items-center gap-2 rounded-full border py-1 pl-3 pr-1 text-sm">
                {o.type === 'user' || o.type === 'guest' ? (
                  <Link href={`/users/${encodeURIComponent(o.id)}`} className="font-medium text-primary hover:underline">
                    {o.displayName}
                  </Link>
                ) : (
                  <span className="font-medium">{o.displayName}</span>
                )}
                {!g.onPremisesSynced && (
                  <button
                    onClick={() => setPending({ action: 'remove-owner', target: { objectId: o.id, objectDisplayName: o.displayName, objectUpn: o.userPrincipalName } })}
                    aria-label={`${o.displayName} als Besitzer entfernen`}
                    title="Als Besitzer entfernen"
                    className="rounded-full px-1.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Mitglieder</h2>
        {membersTruncated && <p className="text-xs text-warning">Es werden nur die ersten 2000 Mitglieder geladen.</p>}
        {members.length === 0 ? (
          <EmptyState title="Keine Mitglieder" description={canEditMembers ? 'Mit "Mitglied hinzufuegen" Benutzer aufnehmen.' : undefined} />
        ) : (
          <DataTable
            rows={members}
            columns={memberColumns}
            getRowId={(m) => m.id}
            storageKey="group-members"
            initialSort={{ columnId: 'name', direction: 'asc' }}
            searchPlaceholder="Name, UPN..."
            onRowClick={(m) => (m.type === 'user' || m.type === 'guest' ? router.push(`/users/${encodeURIComponent(m.id)}`) : undefined)}
            exportFileName={`gruppe-${g.displayName}`}
            dense
          />
        )}
      </section>

      {pending && 'pick' in pending && (
        <PickUserDialog tenantId={activeTenant.id} groupId={g.id} groupName={g.displayName} action={pending.action} excludeIds={(pending.action === 'add-owner' ? owners : members).map((m) => m.id)} onClose={() => setPending(null)} onCompleted={refresh} />
      )}
      {pending && 'target' in pending && (
        <MembershipJobDialog tenantId={activeTenant.id} groupId={g.id} groupName={g.displayName} action={pending.action} target={pending.target} onClose={() => setPending(null)} onCompleted={refresh} />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'destructive' | 'primary' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-xl font-semibold tabular-nums', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive', tone === 'primary' && 'text-primary')}>{value}</p>
    </div>
  );
}
