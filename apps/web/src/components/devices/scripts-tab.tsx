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
              <button onClick={() => setRunning(script)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                Ausfuehren
              </button>
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

function LatestRun({ job }: { job: Job }) {
  const label =
    job.status === 'completed'
      ? 'Letztes Ergebnis'
      : job.status === 'failed'
        ? 'Letzter Lauf fehlgeschlagen'
        : job.status === 'pending_approval'
          ? 'Wartet auf Freigabe'
          : 'Lauf aktiv';
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        {label} · {formatDateTime(job.completedAt ?? job.createdAt)} · {job.createdByEmail}
      </p>
      {(job.status === 'completed' || job.status === 'failed') && (
        <div className="mt-2">
          <ScriptResultView result={job.result as unknown as ScriptRunResult | null} error={job.error} />
        </div>
      )}
    </div>
  );
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
      {(result.detectionError || result.remediationError) && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{result.remediationError || result.detectionError}</p>
      )}
      {!json && result.output && <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{result.output}</pre>}
      {json && (schema === 'zsc.update-status/1' || schema === 'zsc.update-scan/1') && <UpdateResult data={json} />}
      {json && schema === 'zsc.system-info/1' && <SystemInfoResult data={json} />}
      {json && schema !== 'zsc.update-status/1' && schema !== 'zsc.update-scan/1' && schema !== 'zsc.system-info/1' && (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(json, null, 2)}</pre>
      )}
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
