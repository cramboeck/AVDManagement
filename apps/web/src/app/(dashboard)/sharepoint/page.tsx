'use client';

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
import { formatCount } from '@/components/charts/tones';
import type { SharePointOverview, SharePointSite, SharingUser } from '@zerostress/types';

const kindLabels: Record<SharePointSite['kind'], string> = { team: 'Team / M365-Gruppe', communication: 'Kommunikation', classic: 'Klassisch', onedrive: 'OneDrive', other: 'Sonstige' };

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

function siteName(url: string | null): string {
  if (!url) return '—';
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  return path === '' || path === '/' ? 'Stammwebsite' : decodeURIComponent(path.replace(/^\/sites\//, '').replace(/^\/personal\//, 'OneDrive: '));
}

const siteColumns: ColumnDef<SharePointSite>[] = [
  {
    id: 'site',
    header: 'Website',
    accessor: (s) => siteName(s.url),
    cell: (s) => (
      <>
        {s.url ? (
          <a href={s.url} target="_blank" rel="noreferrer" className="block font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {siteName(s.url)}
          </a>
        ) : (
          <span className="block font-medium">—</span>
        )}
        <span className="block text-xs text-muted-foreground">{s.ownerPrincipalName ?? s.ownerDisplayName ?? '—'}</span>
      </>
    ),
  },
  { id: 'kind', header: 'Typ', accessor: (s) => s.kind, filterOptions: (Object.keys(kindLabels) as SharePointSite['kind'][]).map((k) => ({ value: k, label: kindLabels[k] })), cell: (s) => <span className="text-muted-foreground">{kindLabels[s.kind]}</span>, searchable: false },
  { id: 'storage', header: 'Speicher', accessor: (s) => s.storageUsedBytes, align: 'right', cell: (s) => <span className="tabular-nums">{formatBytes(s.storageUsedBytes)}</span> },
  { id: 'files', header: 'Dateien', accessor: (s) => s.fileCount, align: 'right', cell: (s) => <span className="tabular-nums text-muted-foreground">{s.fileCount === null ? '—' : formatCount(s.fileCount)}</span> },
  {
    id: 'anonymous',
    header: 'Anonyme Links',
    accessor: (s) => s.anonymousLinkCount,
    align: 'right',
    cell: (s) => <span className={clsx('tabular-nums', (s.anonymousLinkCount ?? 0) > 0 && 'font-medium text-destructive')}>{s.anonymousLinkCount ?? '—'}</span>,
  },
  {
    id: 'guest',
    header: 'Gastlinks',
    accessor: (s) => s.secureLinkForGuestCount,
    align: 'right',
    cell: (s) => <span className={clsx('tabular-nums', (s.secureLinkForGuestCount ?? 0) > 0 && 'text-warning')}>{s.secureLinkForGuestCount ?? '—'}</span>,
  },
  { id: 'company', header: 'Firmenlinks', accessor: (s) => s.companyLinkCount, align: 'right', defaultHidden: true, cell: (s) => <span className="tabular-nums text-muted-foreground">{s.companyLinkCount ?? '—'}</span> },
  {
    id: 'activity',
    header: 'Letzte Aktivitaet',
    accessor: (s) => (s.lastActivityAt ? new Date(s.lastActivityAt) : null),
    cell: (s) => {
      const d = daysSince(s.lastActivityAt);
      return <span className={clsx('text-muted-foreground', d !== null && d > 90 && 'text-warning')}>{d === null ? 'nie' : d === 0 ? 'heute' : `vor ${d} Tagen`}</span>;
    },
  },
];

const userColumns: ColumnDef<SharingUser>[] = [
  { id: 'user', header: 'Benutzer', accessor: (u) => u.userPrincipalName, cell: (u) => <span className="font-medium">{u.userPrincipalName}</span> },
  { id: 'external', header: 'Extern geteilt', accessor: (u) => u.sharedExternallyFileCount, align: 'right', cell: (u) => <span className={clsx('tabular-nums', u.sharedExternallyFileCount > 0 && 'font-medium text-warning')}>{u.sharedExternallyFileCount}</span> },
  { id: 'internal', header: 'Intern geteilt', accessor: (u) => u.sharedInternallyFileCount, align: 'right', cell: (u) => <span className="tabular-nums text-muted-foreground">{u.sharedInternallyFileCount}</span> },
  { id: 'edited', header: 'Bearbeitet', accessor: (u) => u.viewedOrEditedFileCount, align: 'right', defaultHidden: true, cell: (u) => <span className="tabular-nums text-muted-foreground">{u.viewedOrEditedFileCount}</span> },
  { id: 'activity', header: 'Letzte Aktivitaet', accessor: (u) => (u.lastActivityAt ? new Date(u.lastActivityAt) : null), cell: (u) => <span className="text-muted-foreground">{u.lastActivityAt ?? '—'}</span> },
];

export default function SharePointPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const query = useQuery({
    queryKey: ['sharepoint', activeTenant?.id],
    queryFn: () => api.get<SharePointOverview>(`/tenants/${activeTenant!.id}/sharepoint`),
    enabled: !!activeTenant,
    staleTime: 10 * 60 * 1000,
  });

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;
  const overview = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">SharePoint und OneDrive</h1>
          <p className="text-sm text-muted-foreground">
            Websites mit Speicher, Freigabelinks und Aktivitaet sowie Benutzer, die im Zeitraum Dateien extern geteilt haben. Aus den Microsoft-Nutzungsberichten, etwa zwei Tage Verzug.
          </p>
        </div>
        <SnapshotStatus tenantId={activeTenant.id} kinds={['sharepoint']} invalidate={[['sharepoint', activeTenant.id]]} />
      </div>

      {query.isLoading ? (
        <LoadingTable rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !overview ? null : !overview.available ? (
        <CapabilityNotice what="die SharePoint-Berichte" reason={overview.reason} missingPermission={overview.missingPermission} detail={overview.detail} />
      ) : (
        <>
          {overview.data.anonymised && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
              Dieser Tenant verbirgt Namen in Berichten. Zum Anzeigen im Microsoft 365 Admin Center unter Einstellungen &gt; Organisationseinstellungen &gt; Berichte die Option
              &quot;Anzeigenamen verbergen&quot; deaktivieren.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Websites" value={String(overview.data.totals.sites)} sub={`${overview.data.totals.teamSites} Teams`} />
            <Stat label="Speicher" value={formatBytes(overview.data.totals.storageUsedBytes)} />
            <Stat label="Mit anonymen Links" value={String(overview.data.totals.sitesWithAnonymousLinks)} tone={overview.data.totals.sitesWithAnonymousLinks > 0 ? 'destructive' : undefined} />
            <Stat label="Mit Gastlinks" value={String(overview.data.totals.sitesWithGuestLinks)} tone={overview.data.totals.sitesWithGuestLinks > 0 ? 'warning' : undefined} />
            <Stat label="Benutzer teilen extern" value={String(overview.data.totals.usersSharingExternally)} sub={`${overview.data.totals.filesSharedExternally} Dateien in ${overview.data.periodDays} Tagen`} tone={overview.data.totals.usersSharingExternally > 0 ? 'warning' : undefined} />
            <Stat label="Inaktiv seit 90 Tagen" value={String(overview.data.totals.inactiveSites90Days)} />
          </div>

          <section className="space-y-2">
            <h2 className="font-medium">Extern geteilt je Benutzer</h2>
            {overview.data.sharingUsers.length === 0 ? (
              <EmptyState title="Keine Freigaben im Zeitraum" description="Kein Benutzer hat laut Bericht Dateien intern oder extern geteilt." />
            ) : (
              <DataTable rows={overview.data.sharingUsers} columns={userColumns} getRowId={(u) => u.userPrincipalName} storageKey="sharepoint-users" initialSort={{ columnId: 'external', direction: 'desc' }} searchPlaceholder="Benutzer..." exportFileName="freigaben-benutzer" dense />
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-medium">Websites</h2>
            {overview.data.sites.length === 0 ? (
              <EmptyState title="Keine Websites im Bericht" />
            ) : (
              <DataTable rows={overview.data.sites} columns={siteColumns} getRowId={(s) => s.siteId} storageKey="sharepoint-sites" initialSort={{ columnId: 'anonymous', direction: 'desc' }} searchPlaceholder="Website, Besitzer..." exportFileName="sharepoint-websites" />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warning' | 'destructive' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
