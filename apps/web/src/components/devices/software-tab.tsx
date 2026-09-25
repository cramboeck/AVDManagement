'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { ScriptResultView, wingetUpdatesFrom, type WingetUpdate } from '@/components/devices/scripts-tab';
import type { DetectedApp, Device, DeviceSoftwareInventory, Job, ScriptRunResult } from '@zerostress/types';

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// winget kennt Ids, Intune kennt Anzeigenamen; ein Treffer ueber den Namen reicht fuer die Markierung
export function matchWingetUpdate(app: DetectedApp, updates: WingetUpdate[]): WingetUpdate | null {
  const appName = normalise(app.displayName);
  if (appName.length < 3) return null;
  for (const update of updates) {
    const name = normalise(update.name.replace(/\.\.\.$/, ''));
    const idTail = normalise(update.id.split('.').slice(1).join(' '));
    if (name.length >= 4 && (appName.includes(name) || name.includes(appName))) return update;
    if (idTail.length >= 4 && appName.includes(idTail)) return update;
  }
  return null;
}

interface SoftwareRow extends DetectedApp {
  update: WingetUpdate | null;
  wingetState: 'update' | 'current';
}

const softwareColumns: ColumnDef<SoftwareRow>[] = [
  { id: 'name', header: 'Software', accessor: (a) => a.displayName, cell: (a) => <span className="font-medium">{a.displayName}</span> },
  { id: 'version', header: 'Version', accessor: (a) => a.version, className: 'font-mono text-xs' },
  {
    id: 'winget',
    header: 'winget',
    accessor: (a) => a.wingetState,
    sortValue: (a) => (a.update ? 0 : 1),
    filterOptions: [
      { value: 'update', label: 'Update verfuegbar' },
      { value: 'current', label: 'Kein Update bekannt' },
    ],
    filterLabel: 'winget',
    searchable: false,
    cell: (a) =>
      a.update ? (
        <span className="inline-flex rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning" title={a.update.id}>
          {a.update.installed || a.version || '?'} → {a.update.available}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
  { id: 'publisher', header: 'Hersteller', accessor: (a) => a.publisher },
  { id: 'size', header: 'Groesse', accessor: (a) => a.sizeBytes, cell: (a) => <span className="text-muted-foreground">{formatSize(a.sizeBytes)}</span>, align: 'right' },
  { id: 'platform', header: 'Plattform', accessor: (a) => a.platform, defaultHidden: true },
];

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function SoftwareTab({ base, tenantId, device }: { base: string; tenantId: string; device: Device }) {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const managedDeviceId = device.intune?.managedDeviceId ?? null;

  const softwareQuery = useQuery({
    queryKey: ['device-software', tenantId, device.id],
    queryFn: () => api.get<DeviceSoftwareInventory>(`${base}/software`),
    staleTime: 10 * 60 * 1000,
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs', tenantId],
    queryFn: () => api.get<{ items: Job[] }>(`/tenants/${tenantId}/jobs?limit=100`),
    refetchInterval: 5000,
    enabled: !!managedDeviceId,
  });

  const latestCheck = useMemo(
    () =>
      (jobsQuery.data?.items ?? []).find(
        (j) => j.type === 'device.run-script' && j.payload.managedDeviceId === managedDeviceId && j.payload.scriptId === 'winget-updates'
      ) ?? null,
    [jobsQuery.data, managedDeviceId]
  );
  const latestResult = latestCheck?.status === 'completed' ? (latestCheck.result as unknown as ScriptRunResult | null) : null;
  const updates = useMemo(() => wingetUpdatesFrom(latestResult), [latestResult]);

  const rows: SoftwareRow[] = useMemo(
    () =>
      (softwareQuery.data?.available ? softwareQuery.data.data : []).map((app) => {
        const update = matchWingetUpdate(app, updates);
        return { ...app, update, wingetState: update ? 'update' : 'current' };
      }),
    [softwareQuery.data, updates]
  );

  if (!managedDeviceId) {
    return (
      <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
        Das Softwareinventar kommt aus Intune. Dieses Geraet ist nicht in Intune verwaltet.
      </p>
    );
  }
  if (softwareQuery.isLoading) return <LoadingTable rows={8} />;
  if (softwareQuery.error) return <ErrorState error={softwareQuery.error as Error} onRetry={softwareQuery.refetch} />;
  const inventory = softwareQuery.data;
  if (!inventory) return null;
  if (!inventory.available) {
    return <CapabilityNotice what="das Softwareinventar" reason={inventory.reason} missingPermission={inventory.missingPermission} detail={inventory.detail} />;
  }

  const apps = inventory.data;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Update-Pruefung mit winget</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Laeuft als Skript auf dem Geraet im Maschinenkontext und fragt die Quelle winget nach neueren Versionen. Es wird nichts installiert.
              Software, die nur im Benutzerprofil installiert ist, sieht der Maschinenkontext nicht.
            </p>
            {latestCheck && (
              <p className="mt-1 text-xs text-muted-foreground">
                Letzte Pruefung {formatDateTime(latestCheck.completedAt ?? latestCheck.createdAt)}
                {latestCheck.status === 'completed' && <> · {updates.length} Update{updates.length === 1 ? '' : 's'} gefunden</>}
                {latestCheck.status === 'failed' && <> · fehlgeschlagen: {latestCheck.error}</>}
                {(latestCheck.status === 'queued' || latestCheck.status === 'running') && <> · laeuft</>}
                {latestCheck.status === 'pending_approval' && <> · wartet auf Freigabe</>}
              </p>
            )}
          </div>
          <button onClick={() => setChecking(true)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Jetzt pruefen
          </button>
        </div>
        {latestResult && (
          <div className="mt-3 border-t pt-3">
            <ScriptResultView result={latestResult} error={null} />
          </div>
        )}
      </section>

      {apps.length === 0 ? (
        <EmptyState title="Noch kein Inventar" description="Intune hat fuer dieses Geraet noch keine erkannten Apps gemeldet. Der Client meldet das Inventar etwa woechentlich." />
      ) : (
        <DataTable
          rows={rows}
          columns={softwareColumns}
          getRowId={(a) => a.id}
          storageKey="device-software"
          initialSort={{ columnId: 'name', direction: 'asc' }}
          searchPlaceholder="Software, Version, Hersteller..."
          exportFileName={`software-${device.name}`}
          dense
        />
      )}

      {checking && (
        <JobActionDialog
          title="Software-Updates mit winget pruefen"
          description={`Auf ${device.name}.`}
          confirmLabel="Pruefung starten"
          createJob={() => api.post<Job>(`/tenants/${tenantId}/jobs/run-script`, { managedDeviceId, deviceName: device.name, scriptId: 'winget-updates' })}
          renderResult={(job) => <ScriptResultView result={job.result as unknown as ScriptRunResult | null} error={job.error} />}
          onClose={() => setChecking(false)}
          onCompleted={() => queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] })}
        />
      )}
    </div>
  );
}
