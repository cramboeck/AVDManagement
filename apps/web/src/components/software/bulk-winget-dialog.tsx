'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { LoadingSpinner } from '@/components/ui/loading';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import type { BulkWingetDevice, BulkWingetOutcome, CapabilityResult, Job, SoftwareOverviewRow } from '@zerostress/types';

export type BulkMode = 'upgrade' | 'uninstall';
const BULK_MAX = 25;

interface Props {
  tenantId: string;
  row: SoftwareOverviewRow;
  mode: BulkMode;
  // Nur eine bestimmte Version (Intune-App-Id), sonst alle Versionen der Software
  versionId?: string | null;
  onClose: () => void;
  onCompleted: () => void;
}

/**
 * Sammelaktion: Geraete der Software laden, auswaehlen (max. 25 je Job),
 * dann Job device.winget-bulk mit einer Vorschau je Geraet.
 */
export function BulkWingetDialog({ tenantId, row, mode, versionId, onClose, onCompleted }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const targetVersions = versionId ? row.versions.filter((v) => v.id === versionId) : row.versions;

  const deviceQueries = useQuery({
    queryKey: ['software-devices', tenantId, targetVersions.map((v) => v.id).join(',')],
    queryFn: async () => {
      const lists = await Promise.all(targetVersions.map((v) => api.get<CapabilityResult<BulkWingetDevice[]>>(`/tenants/${tenantId}/software/${encodeURIComponent(v.id)}/devices`).then((r) => ({ version: v.version, result: r }))));
      const unavailable = lists.find((l) => !l.result.available)?.result;
      const devices = new Map<string, BulkWingetDevice & { version: string | null }>();
      for (const l of lists) if (l.result.available) for (const d of l.result.data) if (!devices.has(d.managedDeviceId)) devices.set(d.managedDeviceId, { ...d, version: l.version });
      return { devices: Array.from(devices.values()).sort((a, b) => a.deviceName.localeCompare(b.deviceName)), unavailable: unavailable && !unavailable.available ? unavailable : null };
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (deviceQueries.data && selected.size === 0) setSelected(new Set(deviceQueries.data.devices.slice(0, BULK_MAX).map((d) => d.managedDeviceId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceQueries.data]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitted) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitted]);

  const devices = useMemo(() => deviceQueries.data?.devices ?? [], [deviceQueries.data]);
  const picked = devices.filter((d) => selected.has(d.managedDeviceId));
  const wingetId = row.wingetId;

  if (submitted && wingetId) {
    return (
      <JobActionDialog
        title={`${mode === 'upgrade' ? 'Aktualisieren' : 'Deinstallieren'} auf ${picked.length} Geraeten: ${row.displayName}`}
        description="Ein Job, eine Vorschau je Geraet. Jedes Geraet meldet einzeln; das Ergebnis steht je Geraet im Job."
        confirmLabel={mode === 'upgrade' ? 'Aktualisierung starten' : 'Deinstallation starten'}
        tone={mode === 'uninstall' ? 'destructive' : 'default'}
        createJob={() => api.post<Job>(`/tenants/${tenantId}/jobs/winget-bulk`, { packageId: wingetId, mode, version: null, displayName: row.displayName, devices: picked.map((d) => ({ managedDeviceId: d.managedDeviceId, deviceName: d.deviceName })) })}
        renderResult={(job) => <BulkResult job={job} />}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_MAX) next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="bulk-winget-title">
        <div className="border-b px-4 py-3">
          <h2 id="bulk-winget-title" className="font-medium">
            {mode === 'upgrade' ? 'Auf allen Geraeten aktualisieren' : 'Auf allen Geraeten deinstallieren'}: {row.displayName}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            winget-Id <span className="font-mono">{wingetId ?? 'unbekannt'}</span>
            {row.latestVersion ? ` · Katalog ${row.latestVersion}` : ''} · hoechstens {BULK_MAX} Geraete je Job
          </p>
        </div>
        <div className="space-y-3 p-4">
          {!wingetId && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">Diese Software ist keiner winget-Id zugeordnet; eine Sammelaktion braucht die Id. Im Basis-Set fehlt sie, oder der Name passt nicht.</p>}
          {deviceQueries.isLoading ? (
            <LoadingSpinner size="sm" />
          ) : deviceQueries.error ? (
            <p className="text-sm text-destructive">{(deviceQueries.error as Error).message}</p>
          ) : deviceQueries.data?.unavailable ? (
            <CapabilityNotice what="die Geraeteliste" reason={deviceQueries.data.unavailable.reason} missingPermission={deviceQueries.data.unavailable.missingPermission} detail={deviceQueries.data.unavailable.detail} compact />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {devices.length} Geraete laut Intune-Inventar, {picked.length} ausgewaehlt
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelected(new Set(devices.slice(0, BULK_MAX).map((d) => d.managedDeviceId)))} className="rounded border px-2 py-0.5 hover:bg-accent">
                    Erste {Math.min(BULK_MAX, devices.length)}
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())} className="rounded border px-2 py-0.5 hover:bg-accent">
                    Keine
                  </button>
                </div>
              </div>
              <ul className="max-h-80 divide-y overflow-auto rounded-md border">
                {devices.map((d) => (
                  <li key={d.managedDeviceId}>
                    <label className={clsx('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent', selected.has(d.managedDeviceId) && 'bg-primary/5')}>
                      <input type="checkbox" checked={selected.has(d.managedDeviceId)} onChange={() => toggle(d.managedDeviceId)} disabled={!selected.has(d.managedDeviceId) && selected.size >= BULK_MAX} />
                      <span className="flex-1 font-medium">{d.deviceName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{d.version ?? '—'}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {devices.length > BULK_MAX && <p className="text-xs text-muted-foreground">Mehr als {BULK_MAX} Geraete: nach dem ersten Job die Auswahl fuer die restlichen wiederholen.</p>}
            </>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Abbrechen
            </button>
            <button type="button" onClick={() => setSubmitted(true)} disabled={!wingetId || picked.length === 0} className={clsx('rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50', mode === 'uninstall' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary text-primary-foreground hover:bg-primary/90')}>
              Weiter zur Vorschau ({picked.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BulkResult({ job }: { job: Job }) {
  const r = job.result as { total?: number; succeeded?: number; failed?: number; outcomes?: BulkWingetOutcome[] } | null;
  if (!r?.outcomes) return <p className="text-sm text-muted-foreground">{job.error ?? 'Kein Ergebnis.'}</p>;
  return (
    <div className="space-y-2 text-sm">
      <p>
        {r.succeeded} von {r.total} Geraeten erfolgreich{r.failed ? `, ${r.failed} fehlgeschlagen` : ''}.
      </p>
      <ul className="max-h-64 divide-y overflow-auto rounded-md border text-xs">
        {r.outcomes.map((o) => (
          <li key={o.managedDeviceId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
            <span className="font-medium">{o.deviceName}</span>
            <span className={o.success ? 'text-success' : 'text-destructive'}>
              {o.success ? 'ok' : 'fehlgeschlagen'}
              {o.installedVersion ? ` · ${o.installedVersion}` : ''}
              {o.message ? ` · ${o.message}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
