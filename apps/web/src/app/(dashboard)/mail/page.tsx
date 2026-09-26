'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ForwardingScanPanel } from '@/components/mail/forwarding-scan';
import { ExchangeStatusPanel } from '@/components/mail/exchange-status';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { SnapshotStatus } from '@/components/inventory/snapshot-status';
import { ChartCard } from '@/components/charts/chart-card';
import { ColumnChart } from '@/components/charts/column-chart';
import { BarList } from '@/components/charts/bar-list';
import { formatCount } from '@/components/charts/tones';
import type { MailOverview, MailboxRecipientType, MailboxUsage } from '@zerostress/types';

const typeLabels: Record<MailboxRecipientType, string> = {
  UserMailbox: 'Benutzer',
  SharedMailbox: 'Freigegeben',
  RoomMailbox: 'Raum',
  EquipmentMailbox: 'Geraet',
  unknown: '—',
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function daysSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / 86400000);
}

function usageState(m: MailboxUsage): 'critical' | 'warning' | 'ok' | 'unknown' {
  if (m.usagePercent === null) return 'unknown';
  if (m.usagePercent >= 95) return 'critical';
  if (m.usagePercent >= 80) return 'warning';
  return 'ok';
}

const columns: ColumnDef<MailboxUsage>[] = [
  {
    id: 'name',
    header: 'Postfach',
    accessor: (m) => m.displayName,
    cell: (m) => (
      <>
        <Link href={`/mail/${encodeURIComponent(m.userPrincipalName)}`} className="block font-medium hover:underline">
          {m.displayName}
        </Link>
        <span className="block truncate text-xs text-muted-foreground">{m.userPrincipalName}</span>
      </>
    ),
  },
  { id: 'upn', header: 'UPN', accessor: (m) => m.userPrincipalName, defaultHidden: true },
  {
    id: 'type',
    header: 'Typ',
    accessor: (m) => m.recipientType,
    filterOptions: (['UserMailbox', 'SharedMailbox', 'RoomMailbox', 'EquipmentMailbox'] as MailboxRecipientType[]).map((t) => ({ value: t, label: typeLabels[t] })),
    cell: (m) => <span className="text-muted-foreground">{typeLabels[m.recipientType]}</span>,
    searchable: false,
  },
  {
    id: 'size',
    header: 'Groesse',
    accessor: (m) => m.storageUsedBytes,
    align: 'right',
    cell: (m) => <span className="tabular-nums">{formatBytes(m.storageUsedBytes)}</span>,
  },
  {
    id: 'usage',
    header: 'Kontingent',
    accessor: (m) => usageState(m),
    sortValue: (m) => -(m.usagePercent ?? -1),
    filterOptions: [
      { value: 'critical', label: 'Ueber 95 %' },
      { value: 'warning', label: 'Ueber 80 %' },
      { value: 'ok', label: 'Unter 80 %' },
    ],
    filterLabel: 'Kontingent',
    searchable: false,
    cell: (m) => {
      const state = usageState(m);
      if (state === 'unknown') return <span className="text-xs text-muted-foreground">—</span>;
      const percent = Math.min(100, m.usagePercent ?? 0);
      return (
        <div className="min-w-[140px]">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">von {formatBytes(m.prohibitSendQuotaBytes)}</span>
            <span className={clsx('tabular-nums', state === 'critical' && 'text-destructive', state === 'warning' && 'text-warning')}>{percent.toFixed(0)} %</span>
          </div>
          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Kontingent ${m.displayName}`}>
            <div className={clsx('h-full rounded-full', state === 'critical' ? 'bg-destructive' : state === 'warning' ? 'bg-warning' : 'bg-primary')} style={{ width: `${percent}%` }} />
          </div>
        </div>
      );
    },
  },
  { id: 'items', header: 'Elemente', accessor: (m) => m.itemCount, align: 'right', cell: (m) => <span className="tabular-nums text-muted-foreground">{m.itemCount === null ? '—' : formatCount(m.itemCount)}</span>, defaultHidden: true },
  { id: 'sent', header: 'Gesendet', accessor: (m) => m.sentCount, align: 'right', cell: (m) => <span className="tabular-nums">{m.sentCount === null ? '—' : formatCount(m.sentCount)}</span> },
  { id: 'received', header: 'Empfangen', accessor: (m) => m.receivedCount, align: 'right', cell: (m) => <span className="tabular-nums">{m.receivedCount === null ? '—' : formatCount(m.receivedCount)}</span> },
  {
    id: 'activity',
    header: 'Letzte Aktivitaet',
    accessor: (m) => (m.lastActivityAt ? new Date(m.lastActivityAt) : null),
    cell: (m) => {
      const days = daysSince(m.lastActivityAt);
      if (days === null) return <span className="text-xs text-muted-foreground">nie</span>;
      return <span className={clsx('text-muted-foreground', days > 30 && m.recipientType === 'UserMailbox' && 'text-warning')}>{days === 0 ? 'heute' : `vor ${days} Tagen`}</span>;
    },
  },
  {
    id: 'archive',
    header: 'Archiv',
    accessor: (m) => (m.hasArchive === null ? null : m.hasArchive ? 'Ja' : 'Nein'),
    filterOptions: [
      { value: 'Ja', label: 'Mit Archiv' },
      { value: 'Nein', label: 'Ohne Archiv' },
    ],
    searchable: false,
    defaultHidden: true,
  },
];

export default function MailPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();

  const query = useQuery({
    queryKey: ['mail', activeTenant?.id],
    queryFn: () => api.get<MailOverview>(`/tenants/${activeTenant!.id}/mail`),
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
          <h1 className="text-2xl font-semibold">Exchange Online</h1>
          <p className="text-sm text-muted-foreground">
            Postfaecher mit Groesse und Kontingent, Aktivitaet und Mailvolumen aus den Microsoft-Nutzungsberichten (etwa zwei Tage Verzug). Ein Klick auf ein Postfach zeigt Abwesenheit, Aliasse und Posteingangsregeln live.
          </p>
        </div>
        <SnapshotStatus tenantId={activeTenant.id} kinds={['mail']} invalidate={[['mail', activeTenant.id]]} />
      </div>

      {query.isLoading ? (
        <LoadingTable rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !overview ? null : !overview.available ? (
        <CapabilityNotice what="die Exchange-Berichte" reason={overview.reason} missingPermission={overview.missingPermission} detail={overview.detail} />
      ) : (
        <>
          {overview.data.anonymised && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
              Dieser Tenant verbirgt Namen in Berichten. Zum Anzeigen im Microsoft 365 Admin Center unter Einstellungen &gt; Organisationseinstellungen &gt;
              Berichte die Option &quot;Anzeigenamen verbergen&quot; deaktivieren.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Postfaecher" value={String(overview.data.totals.mailboxes)} sub={`${overview.data.totals.sharedMailboxes} freigegeben`} />
            <Stat label="Belegt gesamt" value={formatBytes(overview.data.totals.storageUsedBytes)} />
            <Stat label="Ueber 80 % Kontingent" value={String(overview.data.totals.over80Percent)} tone={overview.data.totals.over80Percent > 0 ? 'warning' : undefined} />
            <Stat label="Ueber 95 % Kontingent" value={String(overview.data.totals.over95Percent)} tone={overview.data.totals.over95Percent > 0 ? 'destructive' : undefined} />
            <Stat label="Inaktiv seit 30 Tagen" value={String(overview.data.totals.inactive30Days)} sub="Benutzerpostfaecher" />
            <Stat label={`Gesendet in ${overview.data.periodDays} Tagen`} value={formatCount(overview.data.totals.sentInPeriod)} sub={`${formatCount(overview.data.totals.receivedInPeriod)} empfangen`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Mailvolumen je Tag"
              subtitle={`Gesendet, empfangen und gelesen, ${overview.data.periodDays} Tage, Stand ${overview.data.refreshedAt ?? '—'}`}
              tableHeaders={['Gesendet', 'Empfangen', 'Gelesen']}
              tableRows={overview.data.activityByDay.map((d) => ({ label: formatDay(d.date), values: [d.sent, d.received, d.read] }))}
            >
              {overview.data.activityByDay.length > 0 ? (
                <ColumnChart
                  series={[
                    { key: 'sent', label: 'Gesendet', tone: 'series' },
                    { key: 'received', label: 'Empfangen', tone: 'neutral' },
                  ]}
                  data={overview.data.activityByDay.map((d) => ({ label: formatDay(d.date), values: { sent: d.sent, received: d.received } }))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Noch keine Tageswerte im Bericht.</p>
              )}
            </ChartCard>

            <ChartCard
              title="Groesste Postfaecher"
              subtitle="Belegter Speicher"
              tableHeaders={['Groesse']}
              tableRows={overview.data.mailboxes.slice(0, 20).map((m) => ({ label: m.displayName, values: [formatBytes(m.storageUsedBytes)] }))}
            >
              {overview.data.mailboxes.length > 0 ? (
                <BarList items={overview.data.mailboxes.slice(0, 40).map((m) => ({ key: m.userPrincipalName, label: m.displayName, value: Math.round((m.storageUsedBytes ?? 0) / 1024 / 1024) }))} maxItems={8} />
              ) : (
                <p className="text-sm text-muted-foreground">Keine Postfaecher im Bericht.</p>
              )}
            </ChartCard>
          </div>

          <ForwardingScanPanel tenantId={activeTenant.id} />

          <ExchangeStatusPanel tenantId={activeTenant.id} />

          {overview.data.mailboxes.length === 0 ? (
            <EmptyState title="Keine Postfaecher" description="Der Bericht enthaelt keine Postfaecher. Ohne Exchange Online im Tenant bleibt diese Seite leer." />
          ) : (
            <DataTable
              rows={overview.data.mailboxes}
              columns={columns}
              getRowId={(m) => m.userPrincipalName}
              storageKey="mailboxes"
              initialSort={{ columnId: 'size', direction: 'desc' }}
              searchPlaceholder="Name, UPN..."
              exportFileName="postfaecher"
            />
          )}
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
