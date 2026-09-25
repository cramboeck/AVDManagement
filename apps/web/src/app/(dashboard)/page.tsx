'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingPage } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import type { DashboardTile, TenantDashboard, TenantConnectionStatus } from '@zerostress/types';

const reasonLabels: Record<string, string> = {
  'tenant-not-connected': 'Tenant nicht verbunden',
  'premium-required': 'Entra ID P1 erforderlich',
  'permission-missing': 'Berechtigung fehlt',
  timeout: 'Zeitueberschreitung',
};

const statusLabels: Record<TenantConnectionStatus, string> = {
  connected: 'Verbunden',
  'consent-required': 'Consent erforderlich',
  'permissions-insufficient': 'Berechtigungen fehlen',
  error: 'Fehler',
};

function reasonLabel(reason: string | null): string {
  if (!reason) return 'Nicht verfuegbar';
  return reasonLabels[reason] ?? reason;
}

export default function DashboardPage() {
  const { activeTenant, isLoading, error, refetch, tenants, setActiveTenantId } = useTenant();

  const tenantQuery = useQuery({
    queryKey: ['dashboard', activeTenant?.id],
    queryFn: () => api.get<TenantDashboard>(`/tenants/${activeTenant!.id}/dashboard`),
    enabled: !!activeTenant,
    staleTime: 60 * 1000,
    refetchInterval: 120 * 1000,
  });

  const allQuery = useQuery({
    queryKey: ['dashboard-all'],
    queryFn: () => api.get<{ items: TenantDashboard[]; generatedAt: string }>('/dashboard'),
    enabled: tenants.length > 1,
    staleTime: 120 * 1000,
  });

  if (isLoading) return <LoadingPage message="Lade Tenants..." />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  if (!activeTenant) {
    return (
      <EmptyState
        title="Noch kein Tenant angebunden"
        description="Binde den ersten Kundentenant an, danach erscheinen hier Kennzahlen zu AVD, Benutzern, Sicherheit und Jobs."
        action={
          <Link href="/tenants" className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
            Tenants verwalten
          </Link>
        }
      />
    );
  }

  const dashboard = tenantQuery.data;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{activeTenant.displayName}</h1>
          <p className="text-sm text-muted-foreground">{activeTenant.primaryDomain}</p>
        </div>
        <div className="flex items-center gap-3">
          {dashboard && (
            <span className="text-xs text-muted-foreground">
              Stand {new Date(dashboard.generatedAt).toLocaleTimeString('de-DE')}
            </span>
          )}
          <button
            onClick={() => tenantQuery.refetch()}
            disabled={tenantQuery.isFetching}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {tenantQuery.isFetching ? 'Aktualisiere...' : 'Aktualisieren'}
          </button>
        </div>
      </div>

      {tenantQuery.error ? (
        <ErrorState error={tenantQuery.error as Error} onRetry={tenantQuery.refetch} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <TileCard title="Virtual Desktop" href="/avd" tile={dashboard?.avd} loading={tenantQuery.isLoading}>
            {(avd) => (
              <>
                <Big value={`${avd.availableHosts} / ${avd.totalHosts}`} label="Hosts verfuegbar" />
                <Rows
                  rows={[
                    ['Sessions', `${avd.activeSessions}${avd.maxSessions ? ` / ${avd.maxSessions}` : ''}`],
                    ['Host Pools', String(avd.hostPools)],
                    ['Nicht verfuegbar', String(avd.unavailableHosts), avd.unavailableHosts > 0 ? 'destructive' : undefined],
                    ['Drain-Modus', String(avd.drainingHosts), avd.drainingHosts > 0 ? 'warning' : undefined],
                    ['Heruntergefahren', String(avd.shutdownHosts)],
                  ]}
                />
                {avd.warnings.length > 0 && (
                  <p className="mt-2 text-xs text-warning" title={avd.warnings.join('\n')}>
                    {avd.warnings.length} Hinweis{avd.warnings.length === 1 ? '' : 'e'} zum Zugriff
                  </p>
                )}
              </>
            )}
          </TileCard>

          <TileCard title="Benutzer" href="/users" tile={dashboard?.users} loading={tenantQuery.isLoading}>
            {(users) => (
              <>
                <Big value={String(users.total)} label="Konten gesamt" />
                <Rows
                  rows={[
                    ['Aktiv', String(users.total - users.disabled)],
                    ['Deaktiviert', String(users.disabled)],
                    ['Gaeste', String(users.guests)],
                  ]}
                />
              </>
            )}
          </TileCard>

          <TileCard title="Sicherheit (24 h)" href="/security" tile={dashboard?.security} loading={tenantQuery.isLoading}>
            {(security) => (
              <>
                <Big
                  value={String(security.failures)}
                  label="fehlgeschlagene Anmeldungen"
                  tone={security.failures >= 5 ? 'destructive' : security.failures > 0 ? 'warning' : undefined}
                />
                <Rows
                  rows={[
                    ['Anmeldungen', String(security.signIns)],
                    ['Benutzer mit Fehlern', String(security.usersWithFailures)],
                    ['Legacy-Auth erfolgreich', String(security.legacyAuthSuccesses), security.legacyAuthSuccesses > 0 ? 'destructive' : undefined],
                    ['Riskant erfolgreich', String(security.riskySuccesses), security.riskySuccesses > 0 ? 'destructive' : undefined],
                  ]}
                />
              </>
            )}
          </TileCard>

          <TileCard title="Alerts" href="/alerts" tile={dashboard?.alerts} loading={tenantQuery.isLoading}>
            {(a) => (
              <>
                <Big value={String(a.open)} label="offene Alerts" tone={a.high > 0 ? 'destructive' : a.open > 0 ? 'warning' : undefined} />
                <Rows
                  rows={[
                    ['Hoch', String(a.high), a.high > 0 ? 'destructive' : undefined],
                    ['Mittel', String(a.medium), a.medium > 0 ? 'warning' : undefined],
                    ['Niedrig', String(a.low)],
                  ]}
                />
              </>
            )}
          </TileCard>

          <TileCard title="Jobs" href="/jobs" tile={dashboard?.jobs} loading={tenantQuery.isLoading}>
            {(jobs) => (
              <>
                <Big
                  value={String(jobs.pendingApproval)}
                  label="warten auf Freigabe"
                  tone={jobs.pendingApproval > 0 ? 'warning' : undefined}
                />
                <Rows
                  rows={[
                    ['Laufend', String(jobs.running)],
                    ['Fehlgeschlagen (24 h)', String(jobs.failedLast24h), jobs.failedLast24h > 0 ? 'destructive' : undefined],
                    ['Abgeschlossen (24 h)', String(jobs.completedLast24h)],
                  ]}
                />
              </>
            )}
          </TileCard>
        </div>
      )}

      {tenants.length > 1 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Alle Tenants</h2>
            <button
              onClick={() => allQuery.refetch()}
              disabled={allQuery.isFetching}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
            >
              {allQuery.isFetching ? 'Lade...' : 'Aktualisieren'}
            </button>
          </div>
          {allQuery.isLoading ? (
            <div className="rounded-lg border p-6 text-sm text-muted-foreground">
              Kennzahlen aller Tenants werden geladen — das kann einige Sekunden dauern.
            </div>
          ) : allQuery.error ? (
            <ErrorState error={allQuery.error as Error} onRetry={allQuery.refetch} />
          ) : (
            <AllTenantsTable
              items={allQuery.data?.items ?? []}
              activeId={activeTenant.id}
              onSelect={(id) => setActiveTenantId(id as typeof activeTenant.id)}
            />
          )}
        </section>
      )}
    </div>
  );
}

function TileCard<T>({
  title,
  href,
  tile,
  loading,
  children,
}: {
  title: string;
  href: string;
  tile: DashboardTile<T> | undefined;
  loading: boolean;
  children: (data: T) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">
          Oeffnen →
        </Link>
      </div>
      {loading || !tile ? (
        <div className="space-y-2">
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        </div>
      ) : tile.status === 'ok' && tile.data !== null ? (
        children(tile.data)
      ) : (
        <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground" role="status">
          <p className="font-medium text-foreground">{tile.status === 'error' ? 'Abruf fehlgeschlagen' : reasonLabel(tile.reason)}</p>
          {tile.status === 'error' && <p className="mt-1 break-words text-xs">{reasonLabel(tile.reason)}</p>}
          {tile.reason === 'permission-missing' && (
            <Link href="/tenants" className="mt-2 inline-block text-xs text-primary hover:underline">
              Consent erneuern
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Big({ value, label, tone }: { value: string; label: string; tone?: 'warning' | 'destructive' }) {
  return (
    <div className="mb-3">
      <p className={clsx('text-3xl font-semibold tabular-nums', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Rows({ rows }: { rows: [string, string, ('warning' | 'destructive')?][] }) {
  return (
    <dl className="space-y-1 text-sm">
      {rows.map(([label, value, tone]) => (
        <div key={label} className="flex items-center justify-between">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={clsx('tabular-nums', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AllTenantsTable({
  items,
  activeId,
  onSelect,
}: {
  items: TenantDashboard[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const cell = <T,>(tile: DashboardTile<T>, render: (d: T) => React.ReactNode) =>
    tile.status === 'ok' && tile.data !== null ? render(tile.data) : <span className="text-xs text-muted-foreground">{reasonLabel(tile.reason)}</span>;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Tenant</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">AVD-Hosts</th>
            <th className="px-3 py-2 font-medium">Sessions</th>
            <th className="px-3 py-2 font-medium">Benutzer</th>
            <th className="px-3 py-2 font-medium">Anmeldefehler 24 h</th>
            <th className="px-3 py-2 font-medium">Offene Jobs</th>
            <th className="px-3 py-2 font-medium">Alerts</th>
            <th className="px-3 py-2 font-medium">Aufmerksamkeit</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr
              key={d.tenant.id}
              tabIndex={0}
              onClick={() => onSelect(d.tenant.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect(d.tenant.id);
              }}
              className={clsx(
                'cursor-pointer border-b last:border-0 hover:bg-accent/50 focus:outline-none focus-visible:bg-accent',
                d.tenant.id === activeId && 'bg-accent/30'
              )}
            >
              <td className="px-3 py-2">
                <span className="block font-medium">{d.tenant.displayName}</span>
                <span className="block text-xs text-muted-foreground">{d.tenant.primaryDomain}</span>
              </td>
              <td className="px-3 py-2 text-xs">{statusLabels[d.tenant.connectionStatus]}</td>
              <td className="px-3 py-2 tabular-nums">
                {cell(d.avd, (a) => (
                  <span className={a.unavailableHosts > 0 ? 'text-destructive' : undefined}>
                    {a.availableHosts} / {a.totalHosts}
                  </span>
                ))}
              </td>
              <td className="px-3 py-2 tabular-nums">{cell(d.avd, (a) => a.activeSessions)}</td>
              <td className="px-3 py-2 tabular-nums">{cell(d.users, (u) => u.total)}</td>
              <td className="px-3 py-2 tabular-nums">
                {cell(d.security, (s) => (
                  <span className={s.failures >= 5 ? 'text-destructive' : undefined}>{s.failures}</span>
                ))}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {cell(d.jobs, (j) => (
                  <span className={j.pendingApproval > 0 ? 'text-warning' : undefined}>{j.pendingApproval + j.running}</span>
                ))}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {cell(d.alerts, (a) => (
                  <span className={a.high > 0 ? 'text-destructive' : a.open > 0 ? 'text-warning' : undefined}>
                    {a.open}
                    {a.high > 0 && <span className="ml-1 text-xs">({a.high} hoch)</span>}
                  </span>
                ))}
              </td>
              <td className="px-3 py-2">
                {d.attention === 0 ? (
                  <span className="text-xs text-success">OK</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-warning">
                    <span className="h-2 w-2 rounded-full bg-warning" />
                    {d.attention} Punkt{d.attention === 1 ? '' : 'e'}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
