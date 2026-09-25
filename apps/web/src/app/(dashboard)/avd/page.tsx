'use client';

import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, NoResults } from '@/components/ui/empty-state';
import Link from 'next/link';
import type { SyncedHostPool, HostPoolSummary } from '@zerostress/types';

interface HostPoolsResponse {
  items: SyncedHostPool[];
  warnings: string[];
}

const statusColors: Record<string, string> = {
  healthy: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  error: 'bg-destructive text-destructive-foreground',
};

function getPoolStatus(summary: HostPoolSummary): 'healthy' | 'warning' | 'error' {
  if (summary.unavailableHosts > 0) return 'error';
  if (summary.hostsInDrainMode > 0) return 'warning';
  if (summary.utilizationPercent > 90) return 'warning';
  return 'healthy';
}

function UtilizationBar({ percent }: { percent: number }) {
  const colorClass =
    percent > 90 ? 'bg-destructive' : percent > 70 ? 'bg-warning' : 'bg-success';

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${colorClass}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-sm text-muted-foreground">{percent}%</span>
    </div>
  );
}

function HostPoolCard({ pool }: { pool: SyncedHostPool }) {
  const { activeTenant } = useTenant();
  const encodedId = encodeURIComponent(pool.azureResourceId);

  const summaryQuery = useQuery<HostPoolSummary>({
    queryKey: ['hostPoolSummary', activeTenant?.id, pool.id],
    queryFn: () =>
      api.get<HostPoolSummary>(`/tenants/${activeTenant!.id}/avd/host-pools/${encodedId}/summary`),
    enabled: !!activeTenant,
    refetchInterval: 30000,
  });

  const summary = summaryQuery.data;
  const status = summary ? getPoolStatus(summary) : 'healthy';

  return (
    <Link
      href={`/avd/host-pools/${encodedId}`}
      className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium">{pool.friendlyName || pool.name}</h3>
          <p className="text-sm text-muted-foreground">{pool.name}</p>
        </div>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[status]}`}
        >
          {status === 'healthy' ? 'OK' : status === 'warning' ? 'Warnung' : 'Problem'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Hosts</p>
          <p className="font-medium">
            {summary ? `${summary.availableHosts}/${summary.totalHosts}` : '-'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Sessions</p>
          <p className="font-medium">
            {summary ? `${summary.totalSessions}/${summary.maxSessions}` : '-'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Typ</p>
          <p className="font-medium">{pool.hostPoolType}</p>
        </div>
      </div>

      {summary && (
        <div className="mt-4">
          <p className="mb-1 text-sm text-muted-foreground">Auslastung</p>
          <UtilizationBar percent={summary.utilizationPercent} />
        </div>
      )}

      {summary && (summary.unavailableHosts > 0 || summary.hostsInDrainMode > 0) && (
        <div className="mt-3 flex gap-2">
          {summary.unavailableHosts > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
              {summary.unavailableHosts} unavailable
            </span>
          )}
          {summary.hostsInDrainMode > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-2 py-1 text-xs text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" />
              {summary.hostsInDrainMode} drain
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

export default function AvdPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();

  const { data, isLoading, error, refetch } = useQuery<HostPoolsResponse>({
    queryKey: ['hostPools', activeTenant?.id],
    queryFn: () => api.get<HostPoolsResponse>(`/tenants/${activeTenant!.id}/avd/host-pools`),
    enabled: !!activeTenant,
    staleTime: 30 * 1000,
  });

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Azure Virtual Desktop</h1>
          <p className="text-muted-foreground">
            Host Pools und Session Hosts verwalten
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Aktualisieren
        </button>
      </div>

      {data && data.warnings.length > 0 && (
        <div
          className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
          role="status"
        >
          <p className="font-medium">Eingeschraenkter Zugriff</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg border bg-muted" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error as Error} onRetry={refetch} />
      ) : !data?.items.length ? (
        data?.warnings.length ? null : <NoResults query="" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((pool) => (
            <HostPoolCard key={pool.id} pool={pool} />
          ))}
        </div>
      )}
    </div>
  );
}
