'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { Collapsible } from '@/components/ui/collapsible';
import type { Device, Job, ScriptLibraryStatus, ScriptRunResult, TenantScriptStatus, TenantScriptState } from '@zerostress/types';

const stateLabels: Record<TenantScriptState, { label: string; className: string }> = {
  'in-sync': { label: 'Im Tenant aktuell', className: 'bg-success/10 text-success' },
  outdated: { label: 'Wird beim naechsten Lauf aktualisiert', className: 'bg-warning/10 text-warning' },
  missing: { label: 'Wird beim ersten Lauf angelegt', className: 'bg-muted text-muted-foreground' },
};

export function ScriptsTab({ tenantId, device }: { tenantId: string; device: Device }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<TenantScriptStatus | null>(null);
  const managedDeviceId = device.intune?.managedDeviceId ?? null;

  const scriptsQuery = useQuery({
    queryKey: ['scripts', tenantId],
    queryFn: () => api.get<ScriptLibraryStatus>(`/tenants/${tenantId}/scripts`),
    staleTime: 5 * 60 * 1000,
  });

  const jobsQuery = useQuery({
    queryKey: ['jobs', tenantId],
    queryFn: () => api.get<{ items: Job[] }>(`/tenants/${tenantId}/jobs?limit=100`),
    refetchInterval: 5000,
    enabled: !!managedDeviceId,
  });

  if (!managedDeviceId) {
    return (
      <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
        Skripte laufen ueber Intune Remediations. Dieses Geraet ist nicht in Intune verwaltet, daher gibt es hier keine Ausfuehrung.
      </p>
    );
  }
  if (scriptsQuery.isLoading) return <LoadingTable rows={3} />;
  if (scriptsQuery.error) return <ErrorState error={scriptsQuery.error as Error} onRetry={scriptsQuery.refetch} />;
  const status = scriptsQuery.data;
  if (!status) return null;
  if (!status.available) {
    return <CapabilityNotice what="die Skriptbibliothek (Intune Remediations)" reason={status.reason} missingPermission={status.missingPermission} detail={status.detail} />;
  }

  const runs = (jobsQuery.data?.items ?? []).filter((j) => j.type === 'device.run-script' && j.payload.managedDeviceId === managedDeviceId);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Skripte aus der Bibliothek der Konsole, ausgefuehrt als SYSTEM ueber Intune Remediations. Kein Freitext; Version und Pruefsumme jedes
        Laufs stehen im Audit. Das Ergebnis kommt, sobald sich das Geraet bei Intune meldet.
      </p>

      {status.data.map((script) => {
        const latest = runs.find((j) => j.payload.scriptId === script.id);
        const state = stateLabels[script.tenantState];
        return (
          <section key={script.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-medium">{script.displayName}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{script.description}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Version {script.version}</span>
                  <span className="font-mono" title={script.hash}>
                    {script.hash.slice(0, 12)}
                  </span>
                  <span className={clsx('rounded-full px-2 py-0.5', state.className)}>{state.label}</span>
                  {script.hasRemediation ? <span className="rounded-full bg-warning/10 px-2 py-0.5 text-warning">Veraendert das Geraet</span> : <span className="rounded-full bg-muted px-2 py-0.5">Nur lesend</span>}
                </p>
              </div>
              <div className="flex gap-2">
                {script.tenantScriptId && <IntuneStateButton tenantId={tenantId} scriptId={script.id} managedDeviceId={managedDeviceId} />}
                <button onClick={() => setRunning(script)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                  Ausfuehren
                </button>
              </div>
            </div>

            {latest && (
              <div className="mt-3 border-t pt-3">
                <LatestRun job={latest} />
              </div>
            )}
          </section>
        );
      })}

      {running && (
        <JobActionDialog
          title={`${running.displayName} ausfuehren`}
          description={`Auf ${device.name}. Version ${running.version}.`}
          confirmLabel="Skript starten"
          createJob={() =>
            api.post<Job>(`/tenants/${tenantId}/jobs/run-script`, {
              managedDeviceId,
              deviceName: device.name,
              scriptId: running.id,
            })
          }
          renderResult={(job) => <ScriptResultView result={job.result as unknown as ScriptRunResult | null} error={job.error} />}
          onClose={() => setRunning(null)}
          onCompleted={() => {
            queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] });
            queryClient.invalidateQueries({ queryKey: ['scripts', tenantId] });
          }}
        />
      )}
    </div>
  );
}

interface IntuneStateResponse {
  available: boolean;
  data?: { tenantScriptId: string | null; state: Record<string, unknown> | null };
}

// Diagnose ohne Wartezeit: was Intune fuer dieses Skript auf diesem Geraet gerade meldet
function IntuneStateButton({ tenantId, scriptId, managedDeviceId }: { tenantId: string; scriptId: string; managedDeviceId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['script-state', tenantId, scriptId, managedDeviceId],
    queryFn: () => api.get<IntuneStateResponse>(`/tenants/${tenantId}/scripts/${scriptId}/state?managedDeviceId=${encodeURIComponent(managedDeviceId)}`),
    enabled: open,
    staleTime: 0,
  });
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          if (open) void query.refetch();
        }}
        className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
        title="Zeigt den aktuellen Zustand laut Intune, ohne einen Lauf zu starten"
      >
        Intune-Zustand
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg border bg-background p-4 shadow-lg" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium">Zustand laut Intune</h3>
              <button onClick={() => setOpen(false)} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
                Schliessen
              </button>
            </div>
            {query.isFetching && <LoadingTable rows={2} />}
            {query.error && <p className="text-sm text-destructive">{(query.error as Error).message}</p>}
            {query.data && !query.isFetching && (
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(query.data, null, 2)}</pre>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function resultHeadline(job: Job): string {
  const result = job.result as unknown as ScriptRunResult | null;
  const json = result?.outputJson;
  if (!json) return job.status === 'failed' ? (job.error ?? 'fehlgeschlagen') : 'Ergebnis vorhanden';
  switch (json.schema) {
    case 'zsc.update-status/1':
    case 'zsc.update-scan/1':
      return `${text(json.pendingCount)} ausstehende Updates${json.rebootRequired === true ? ', Neustart erforderlich' : ''}`;
    case 'zsc.winget-updates/1':
      return `${text(json.updateCount)} Software-Updates verfuegbar`;
    case 'zsc.system-info/1':
      return `${text(json.os)}, ${text(json.uptimeHours)} h Laufzeit${json.rebootRequired === true ? ', Neustart erforderlich' : ''}`;
    case 'zsc.network-info/1':
      return `${Array.isArray(json.adapters) ? json.adapters.length : 0} aktive Adapter, Domaene ${text(json.domain)}`;
    case 'zsc.storage-info/1':
      return `${Array.isArray(json.volumes) ? json.volumes.length : 0} Laufwerke, ${Array.isArray(json.disks) ? json.disks.length : 0} Datentraeger`;
    default:
      return 'Ergebnis vorhanden';
  }
}

function LatestRun({ job }: { job: Job }) {
  const label =
    job.status === 'completed'
      ? 'Letztes Ergebnis'
      : job.status === 'failed'
        ? 'Letzter Lauf fehlgeschlagen'
        : job.status === 'pending_approval'
          ? 'Wartet auf Freigabe'
          : 'Lauf aktiv';
  const finished = job.status === 'completed' || job.status === 'failed';
  if (!finished) {
    return (
      <p className="text-xs text-muted-foreground">
        {label} · {formatDateTime(job.createdAt)} · {job.createdByEmail}
      </p>
    );
  }
  return (
    <Collapsible
      summary={
        <span className={clsx(job.status === 'failed' && 'text-destructive')}>
          {label}: {resultHeadline(job)}
        </span>
      }
      aside={`${formatDateTime(job.completedAt ?? job.createdAt)} · ${job.createdByEmail}`}
      defaultOpen={job.status === 'failed'}
    >
      <ScriptResultView result={job.result as unknown as ScriptRunResult | null} error={job.error} />
    </Collapsible>
  );
}

const KNOWN_SCHEMAS = new Set(['zsc.update-status/1', 'zsc.update-scan/1', 'zsc.system-info/1', 'zsc.winget-updates/1', 'zsc.network-info/1', 'zsc.storage-info/1']);

export interface WingetUpdate {
  name: string;
  id: string;
  installed: string;
  available: string;
}

// Updates aus einem winget-Lauf, fuer die Software-Tabelle
export function wingetUpdatesFrom(result: ScriptRunResult | null): WingetUpdate[] {
  const json = result?.outputJson;
  if (!json || json.schema !== 'zsc.winget-updates/1' || !Array.isArray(json.updates)) return [];
  return json.updates
    .map(asRecord)
    .filter((u): u is Record<string, unknown> => u !== null)
    .map((u) => ({ name: text(u.name), id: text(u.id), installed: text(u.installed), available: text(u.available) }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function yesNo(value: unknown): string {
  if (value === true) return 'Ja';
  if (value === false) return 'Nein';
  return '—';
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function dateText(value: unknown): string {
  return typeof value === 'string' && value ? formatDateTime(value) : '—';
}

export function ScriptResultView({ result, error }: { result: ScriptRunResult | null; error: string | null }) {
  if (!result) {
    return error ? <p className="text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">Kein Ergebnis.</p>;
  }
  const json = result.outputJson;
  const schema = typeof json?.schema === 'string' ? json.schema : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Vom Geraet gemeldet {dateText(result.deviceReportedAt)} · Erkennung {result.detectionState}
        {result.remediationState !== 'skipped' && result.remediationState !== 'unknown' && <> · Behebung {result.remediationState}</>}
      </p>
      {result.possiblyStale && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          Das Geraet hat innerhalb der Wartezeit nichts Neues gemeldet. Gezeigt wird der letzte Zustand, den Intune fuer dieses Skript kennt; er kann von
          einem frueheren Lauf stammen.
        </p>
      )}
      {(result.detectionError || result.remediationError) && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{result.remediationError || result.detectionError}</p>
      )}
      {!json && result.output && <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{result.output}</pre>}
      {json && (schema === 'zsc.update-status/1' || schema === 'zsc.update-scan/1') && <UpdateResult data={json} />}
      {json && schema === 'zsc.system-info/1' && <SystemInfoResult data={json} />}
      {json && schema === 'zsc.winget-updates/1' && <WingetResult data={json} />}
      {json && schema === 'zsc.network-info/1' && <NetworkInfoResult data={json} />}
      {json && schema === 'zsc.storage-info/1' && <StorageInfoResult data={json} />}
      {json && !KNOWN_SCHEMAS.has(schema ?? '') && <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(json, null, 2)}</pre>}
    </div>
  );
}

function UpdateResult({ data }: { data: Record<string, unknown> }) {
  const pending = Array.isArray(data.pending) ? data.pending.map(asRecord).filter((p): p is Record<string, unknown> => p !== null) : [];
  const count = typeof data.pendingCount === 'number' ? data.pendingCount : pending.length;
  const scanFailed = data.state === 'failed';
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Ausstehende Updates" value={String(count)} tone={count > 0 ? 'warning' : 'good'} />
        <Stat label="Neustart erforderlich" value={yesNo(data.rebootRequired)} tone={data.rebootRequired === true ? 'warning' : undefined} />
        <Stat label={data.scannedAt ? 'Gescannt' : 'Letzte Suche'} value={dateText(data.scannedAt ?? data.lastSearchAt)} />
        <Stat label={data.durationSeconds !== undefined ? 'Scandauer' : 'Letzte Installation'} value={data.durationSeconds !== undefined ? `${text(data.durationSeconds)} s` : dateText(data.lastInstallAt)} />
      </div>
      {Boolean(scanFailed || data.error) && (
        <p className="text-sm text-destructive">
          {scanFailed ? 'Scan fehlgeschlagen: ' : ''}
          {text(data.error)}
        </p>
      )}
      {pending.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">KB</th>
                <th className="px-3 py-1.5 font-medium">Update</th>
                <th className="px-3 py-1.5 font-medium">Schwere</th>
                <th className="px-3 py-1.5 font-medium">Heruntergeladen</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((p, i) => (
                <tr key={`${text(p.kb)}-${i}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5 font-mono text-xs">{text(p.kb)}</td>
                  <td className="px-3 py-1.5">{text(p.title)}</td>
                  <td className="px-3 py-1.5">{text(p.severity)}</td>
                  <td className="px-3 py-1.5">{yesNo(p.downloaded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.truncated === true && <p className="text-xs text-muted-foreground">Es werden nur die ersten Eintraege gezeigt; Intune begrenzt die Ausgabe.</p>}
    </div>
  );
}

function WingetResult({ data }: { data: Record<string, unknown> }) {
  const updates = Array.isArray(data.updates) ? data.updates.map(asRecord).filter((u): u is Record<string, unknown> => u !== null) : [];
  const count = typeof data.updateCount === 'number' ? data.updateCount : updates.length;
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Updates verfuegbar" value={String(count)} tone={count > 0 ? 'warning' : 'good'} />
        <Stat label="winget-Version" value={text(data.wingetVersion)} />
        <Stat label="Geprueft" value={dateText(data.collectedAt)} />
      </div>
      {typeof data.error === 'string' && data.error && <p className="text-sm text-destructive">{data.error}</p>}
      {updates.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Software</th>
                <th className="px-3 py-1.5 font-medium">winget-Id</th>
                <th className="px-3 py-1.5 font-medium">Installiert</th>
                <th className="px-3 py-1.5 font-medium">Verfuegbar</th>
              </tr>
            </thead>
            <tbody>
              {updates.map((u, i) => (
                <tr key={`${text(u.id)}-${i}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{text(u.name)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{text(u.id)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{text(u.installed)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-warning">{text(u.available)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.truncated === true && <p className="text-xs text-muted-foreground">Es werden nur die ersten Eintraege gezeigt; Intune begrenzt die Ausgabe.</p>}
    </div>
  );
}

function list(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.map(String).join(', ') : '—';
}

const adapterKinds: Record<string, string> = { wifi: 'WLAN', ethernet: 'Ethernet', vpn: 'VPN', other: 'Sonstige' };

function NetworkInfoResult({ data }: { data: Record<string, unknown> }) {
  const adapters = Array.isArray(data.adapters) ? data.adapters.map(asRecord).filter((a): a is Record<string, unknown> => a !== null) : [];
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Domaene / Arbeitsgruppe" value={`${text(data.domain)}${data.domainJoined === true ? ' (Domaene)' : ''}`} />
        <Stat label="Aktive Adapter" value={String(adapters.length)} />
        <Stat label="WinHTTP-Proxy" value={text(data.proxy)} />
      </div>
      {typeof data.error === 'string' && data.error && <p className="text-sm text-destructive">{data.error}</p>}
      {adapters.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Adapter</th>
                <th className="px-3 py-1.5 font-medium">IPv4</th>
                <th className="px-3 py-1.5 font-medium">Gateway</th>
                <th className="px-3 py-1.5 font-medium">DNS</th>
                <th className="px-3 py-1.5 font-medium">DHCP</th>
                <th className="px-3 py-1.5 font-medium">MAC</th>
                <th className="px-3 py-1.5 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {adapters.map((a, i) => (
                <tr key={`${text(a.mac)}-${i}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="block">{text(a.name)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {adapterKinds[String(a.kind)] ?? text(a.kind)}
                      {typeof a.ssid === 'string' && a.ssid && <> · SSID {a.ssid}</>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    {list(a.ipv4)}
                    {a.prefix !== null && a.prefix !== undefined && <span className="text-muted-foreground">/{text(a.prefix)}</span>}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{text(a.gateway)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{list(a.dns)}</td>
                  <td className="px-3 py-1.5">{yesNo(a.dhcp)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{text(a.mac)}</td>
                  <td className="px-3 py-1.5 text-xs">{text(a.speed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.truncated === true && <p className="text-xs text-muted-foreground">Es werden nur die ersten Adapter gezeigt; Intune begrenzt die Ausgabe.</p>}
    </div>
  );
}

function StorageInfoResult({ data }: { data: Record<string, unknown> }) {
  const volumes = Array.isArray(data.volumes) ? data.volumes.map(asRecord).filter((v): v is Record<string, unknown> => v !== null) : [];
  const disks = Array.isArray(data.disks) ? data.disks.map(asRecord).filter((d): d is Record<string, unknown> => d !== null) : [];
  return (
    <div className="space-y-3">
      {typeof data.error === 'string' && data.error && <p className="text-sm text-destructive">{data.error}</p>}
      {volumes.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Laufwerke</p>
          <div className="space-y-2">
            {volumes.map((v, i) => {
              const total = Number(v.totalGb) || 0;
              const free = Number(v.freeGb) || 0;
              const percent = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
              const tone = percent >= 90 ? 'bg-destructive' : percent >= 75 ? 'bg-warning' : 'bg-primary';
              return (
                <div key={`${text(v.letter)}-${i}`} className="rounded-md border p-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      <span className="font-mono font-medium">{text(v.letter)}</span> {typeof v.label === 'string' && v.label && <>{v.label} · </>}
                      <span className="text-muted-foreground">
                        {text(v.fs)} · {text(v.health)}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {free.toFixed(1)} GB frei von {total.toFixed(1)} GB ({percent} %)
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Belegung ${text(v.letter)}`}>
                    <div className={clsx('h-full rounded-full', tone)} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {disks.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Datentraeger</th>
                <th className="px-3 py-1.5 font-medium">Typ</th>
                <th className="px-3 py-1.5 font-medium">Bus</th>
                <th className="px-3 py-1.5 font-medium">Groesse</th>
                <th className="px-3 py-1.5 font-medium">Zustand</th>
                <th className="px-3 py-1.5 font-medium">Firmware</th>
              </tr>
            </thead>
            <tbody>
              {disks.map((d, i) => (
                <tr key={`${text(d.id)}-${i}`} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{text(d.model)}</td>
                  <td className="px-3 py-1.5">{text(d.media)}</td>
                  <td className="px-3 py-1.5">{text(d.bus)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{text(d.sizeGb)} GB</td>
                  <td className={clsx('px-3 py-1.5', d.health !== 'Healthy' && d.health ? 'text-destructive' : '')}>{text(d.health)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{text(d.firmware)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.truncated === true && <p className="text-xs text-muted-foreground">Es werden nur die ersten Eintraege gezeigt; Intune begrenzt die Ausgabe.</p>}
    </div>
  );
}

function SystemInfoResult({ data }: { data: Record<string, unknown> }) {
  const drive = asRecord(data.systemDrive);
  const tpm = asRecord(data.tpm);
  const bitlocker = asRecord(data.bitlocker);
  const defender = asRecord(data.defender);
  const errors = Array.isArray(data.errors) ? data.errors.map(String) : [];
  const fields: [string, string][] = [
    ['Betriebssystem', `${text(data.os)} (${text(data.osVersion)})`],
    ['Laufzeit', data.uptimeHours !== undefined ? `${text(data.uptimeHours)} h seit ${dateText(data.lastBootAt)}` : '—'],
    ['Neustart erforderlich', yesNo(data.rebootRequired)],
    ['Systemlaufwerk', drive ? `${text(drive.freeGb)} GB frei von ${text(drive.totalGb)} GB (${text(drive.freePercent)} %)` : '—'],
    ['Arbeitsspeicher', data.memoryGb !== undefined ? `${text(data.memoryGb)} GB` : '—'],
    ['Prozessor', text(data.cpu)],
    ['Hersteller / Modell', [data.manufacturer, data.model].filter(Boolean).map(String).join(' ') || '—'],
    ['Firmware', text(data.biosVersion)],
    ['TPM', tpm ? `vorhanden: ${yesNo(tpm.present)}, bereit: ${yesNo(tpm.ready)}` : '—'],
    ['Secure Boot', yesNo(data.secureBoot)],
    ['BitLocker Systemlaufwerk', bitlocker ? `${text(bitlocker.status)}, Schutz ${text(bitlocker.protection)}, ${text(bitlocker.encryptedPercent)} %` : '—'],
    ['Defender', defender ? `${text(defender.mode)}, Echtzeitschutz ${yesNo(defender.realTime)}, Signaturen ${text(defender.signatureAgeDays)} Tage alt` : '—'],
    ['Letzter Schnellscan', dateText(defender?.lastQuickScanAt)],
    ['Installiert am', dateText(data.installedAt)],
  ];
  return (
    <div className="space-y-2">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      {errors.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Nicht ermittelbar ({errors.length})</summary>
          <ul className="mt-1 list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warning' }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('text-sm font-medium', tone === 'warning' && 'text-warning', tone === 'good' && 'text-success')}>{value}</p>
    </div>
  );
}
