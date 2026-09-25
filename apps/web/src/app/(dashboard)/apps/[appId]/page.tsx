'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingPage, LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { appTypeLabels, describeTarget, IntentBadge, InstallStateBadge, installStateLabels, intentLabels } from '@/components/apps/app-badges';
import { AssignAppDialog, DeploymentGroupsDialog } from '@/components/apps/assign-dialogs';
import type { AppAssignment, AppDeviceStatus, AppInstallState, CapabilityResult, IntuneApp, Job, SnapshotMeta } from '@zerostress/types';

type Tab = 'assignments' | 'devices' | 'jobs';

const deviceColumns: ColumnDef<AppDeviceStatus>[] = [
  {
    id: 'device',
    header: 'Geraet',
    accessor: (s) => s.deviceName,
    cell: (s) =>
      s.deviceId ? (
        <Link href={`/devices/${encodeURIComponent(s.deviceId.toLowerCase())}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {s.deviceName}
        </Link>
      ) : (
        <span className="font-medium">{s.deviceName}</span>
      ),
  },
  { id: 'user', header: 'Benutzer', accessor: (s) => s.userPrincipalName, className: 'text-muted-foreground' },
  {
    id: 'state',
    header: 'Status',
    accessor: (s) => s.installState,
    filterOptions: (Object.keys(installStateLabels) as AppInstallState[]).map((k) => ({ value: k, label: installStateLabels[k] })),
    cell: (s) => <InstallStateBadge state={s.installState} />,
    searchable: false,
  },
  {
    id: 'error',
    header: 'Fehler',
    accessor: (s) => s.errorHint ?? s.errorCode ?? s.installStateDetail,
    cell: (s) =>
      s.errorCode || s.installStateDetail ? (
        <span className="block max-w-md text-xs">
          {s.errorCode && <span className="font-mono">{s.errorCode}</span>}
          {s.errorHint && <span className="block text-muted-foreground">{s.errorHint}</span>}
          {!s.errorHint && s.installStateDetail && <span className="block text-muted-foreground">{s.installStateDetail}</span>}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  { id: 'version', header: 'Version', accessor: (s) => s.appVersion, className: 'font-mono text-xs', defaultHidden: true },
  { id: 'modified', header: 'Zuletzt gemeldet', accessor: (s) => (s.lastModifiedAt ? new Date(s.lastModifiedAt) : null), cell: (s) => <span className="text-muted-foreground">{s.lastModifiedAt ? formatDateTime(s.lastModifiedAt) : '—'}</span> },
];

export default function AppDetailPage({ params }: { params: { appId: string } }) {
  const appId = decodeURIComponent(params.appId);
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('assignments');
  const [dialog, setDialog] = useState<'assign' | 'groups' | null>(null);
  const [removing, setRemoving] = useState<AppAssignment | null>(null);

  const query = useQuery({
    queryKey: ['app', activeTenant?.id, appId],
    queryFn: () => api.get<CapabilityResult<IntuneApp> & { snapshot?: SnapshotMeta }>(`/tenants/${activeTenant!.id}/apps/${encodeURIComponent(appId)}`),
    enabled: !!activeTenant,
    staleTime: 60 * 1000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['apps', activeTenant?.id] });
    queryClient.invalidateQueries({ queryKey: ['app', activeTenant?.id, appId] });
    queryClient.invalidateQueries({ queryKey: ['jobs', activeTenant?.id] });
  };

  if (tenantLoading) return <LoadingPage message="Lade Tenant..." />;
  if (!activeTenant) return <NoTenantSelected />;
  if (query.isLoading) return <LoadingPage message="Lade App..." />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const result = query.data;
  if (!result) return <EmptyState title="App nicht gefunden" />;
  if (!result.available) return <CapabilityNotice what="die App" reason={result.reason} missingPermission={result.missingPermission} detail={result.detail} />;
  const app = result.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href="/apps" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Zurueck zur App-Liste">
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">{app.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              {app.publisher ?? '—'} · {appTypeLabels[app.type]}
              {app.version && <> · Version {app.version}</>}
            </p>
            {app.install && (
              <p className="mt-1 flex flex-wrap gap-3 text-xs">
                <span className="text-success">{app.install.installed} installiert</span>
                <span className={clsx(app.install.failed > 0 ? 'text-destructive' : 'text-muted-foreground')}>{app.install.failed} fehlgeschlagen</span>
                <span className="text-muted-foreground">{app.install.pending} ausstehend</span>
                <span className="text-muted-foreground">{app.install.notInstalled} nicht installiert</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setDialog('groups')} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Bereitstellungsgruppen anlegen
          </button>
          <button onClick={() => setDialog('assign')} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Zuweisen
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="App-Bereiche" className="flex gap-1 border-b">
        {(
          [
            { id: 'assignments', label: `Zuweisungen (${app.assignments.length})` },
            { id: 'devices', label: 'Geraete' },
            { id: 'jobs', label: 'Jobs' },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx('-mb-px border-b-2 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary', tab === t.id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'assignments' &&
          (app.assignments.length === 0 ? (
            <EmptyState title="Keine Zuweisungen" description="Die App ist niemandem zugewiesen. Mit 'Zuweisen' oder 'Bereitstellungsgruppen anlegen' starten." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Ziel</th>
                    <th className="px-3 py-2 font-medium">Absicht</th>
                    <th className="px-3 py-2 font-medium">Filter</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {app.assignments.map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {a.groupId ? (
                          <Link href={`/groups/${encodeURIComponent(a.groupId)}`} className="text-primary hover:underline">
                            {describeTarget(a)}
                          </Link>
                        ) : (
                          describeTarget(a)
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <IntentBadge intent={a.intent} />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{a.filterId ? `${a.filterType ?? ''} ${a.filterId.slice(0, 8)}…` : '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => setRemoving(a)} className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
                          Entfernen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {tab === 'devices' && <DevicesTab tenantId={activeTenant.id} appId={appId} />}
        {tab === 'jobs' && <JobsTab tenantId={activeTenant.id} appId={appId} />}
      </div>

      {dialog === 'assign' && <AssignAppDialog tenantId={activeTenant.id} app={app} onClose={() => setDialog(null)} onCompleted={refresh} />}
      {dialog === 'groups' && <DeploymentGroupsDialog tenantId={activeTenant.id} app={app} onClose={() => setDialog(null)} onCompleted={refresh} />}
      {removing && (
        <JobActionDialog
          title="Zuweisung entfernen"
          description={`${intentLabels[removing.intent]} fuer ${describeTarget(removing)} entfernen.`}
          confirmLabel="Entfernen"
          tone="destructive"
          createJob={() =>
            api.post<Job>(`/tenants/${activeTenant.id}/apps/${encodeURIComponent(appId)}/unassign`, {
              appName: app.displayName,
              assignmentId: removing.id,
              groupName: removing.groupName,
              intent: removing.intent,
            })
          }
          onClose={() => setRemoving(null)}
          onCompleted={refresh}
        />
      )}
    </div>
  );
}

function DevicesTab({ tenantId, appId }: { tenantId: string; appId: string }) {
  const query = useQuery({
    queryKey: ['app-devices', tenantId, appId],
    queryFn: () => api.get<CapabilityResult<AppDeviceStatus[]>>(`/tenants/${tenantId}/apps/${encodeURIComponent(appId)}/devices`),
    staleTime: 2 * 60 * 1000,
  });
  if (query.isLoading) return <LoadingTable rows={6} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const result = query.data;
  if (!result) return null;
  if (!result.available) return <CapabilityNotice what="den Installationsstatus" reason={result.reason} missingPermission={result.missingPermission} detail={result.detail} />;
  if (result.data.length === 0) return <EmptyState title="Keine Geraete im Bericht" description="Intune hat fuer diese App noch keinen Installationsstatus gemeldet." />;
  return (
    <DataTable
      rows={result.data}
      columns={deviceColumns}
      getRowId={(s) => `${s.deviceId ?? s.deviceName}-${s.userPrincipalName ?? ''}`}
      storageKey="app-devices"
      initialSort={{ columnId: 'state', direction: 'asc' }}
      searchPlaceholder="Geraet, Benutzer, Fehler..."
      exportFileName="app-geraete"
      dense
    />
  );
}

function JobsTab({ tenantId, appId }: { tenantId: string; appId: string }) {
  const query = useQuery({
    queryKey: ['jobs', tenantId],
    queryFn: () => api.get<{ items: Job[] }>(`/tenants/${tenantId}/jobs?limit=100`),
    refetchInterval: 5000,
  });
  if (query.isLoading) return <LoadingTable rows={3} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const jobs = (query.data?.items ?? []).filter((j) => j.type.startsWith('apps.') && j.payload.appId === appId);
  if (jobs.length === 0) return <EmptyState title="Keine Jobs fuer diese App" />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Zeit</th>
            <th className="px-3 py-2 font-medium">Aktion</th>
            <th className="px-3 py-2 font-medium">Ziel</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Von</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-b last:border-0">
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(j.createdAt)}</td>
              <td className="px-3 py-2 font-mono text-xs">{j.type}</td>
              <td className="px-3 py-2">{String(j.payload.targetDisplayName ?? '')}</td>
              <td className={clsx('px-3 py-2', j.status === 'failed' && 'text-destructive')}>
                {j.status}
                {j.error && <span className="block text-xs text-muted-foreground">{j.error}</span>}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{j.createdByEmail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
