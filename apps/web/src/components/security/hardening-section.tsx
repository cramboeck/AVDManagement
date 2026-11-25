'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import type { HardeningArea, HardeningControl, HardeningStatus, Job } from '@zerostress/types';

export const hardeningAreaLabels: Record<HardeningArea, string> = {
  network: 'Netzwerk',
  credentials: 'Anmeldedaten',
  system: 'System',
  logging: 'Protokollierung',
  encryption: 'Verschluesselung',
  defender: 'Defender',
  accounts: 'Konten',
};

function scoreTone(score: number): string {
  return score >= 90 ? 'text-success' : score >= 70 ? 'text-warning' : 'text-destructive';
}

function titleFor(catalog: HardeningControl[], id: string): string {
  return catalog.find((c) => c.id === id)?.title ?? id;
}

/**
 * Geraete-Haertung: taegliche Pruefung per ZSC-hardening ein- und ausschalten,
 * Ergebnis je Kontrolle und die schwaechsten Geraete. Die Auswertung liefert das Backend.
 */
export function HardeningSection({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const [toggle, setToggle] = useState<'enable' | 'disable' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const query = useQuery({
    queryKey: ['security-hardening', tenantId],
    queryFn: () => api.get<HardeningStatus>(`/tenants/${tenantId}/security/hardening`),
    staleTime: 5 * 60 * 1000,
  });

  const s = query.data;
  const summary = s?.summary ?? null;
  const failingControls = summary ? summary.controls.filter((c) => c.failing > 0 || c.unreadable > 0) : [];
  const controls = summary ? (showAll ? summary.controls : failingControls) : [];

  return (
    <section className="space-y-3" aria-labelledby="hardening-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4">
        <div className="max-w-3xl">
          <h2 id="hardening-heading" className="font-medium">
            Geraete-Haertung
          </h2>
          <p className="text-xs text-muted-foreground">
            {query.isLoading
              ? 'Stand wird geladen...'
              : query.error
                ? 'Stand nicht lesbar, Details unten.'
                : s?.enabled
                  ? `Aktiv: ZSC-hardening laeuft taeglich um 12 Uhr auf allen Windows-Geraeten und prueft ${s.catalog.length} Einstellungen, die Intune nicht direkt meldet (lokale Richtlinien, Dienste, Protokollierung, Defender). Nur lesend.`
                  : s?.tenantScriptId
                    ? 'Skript im Tenant, aber ohne taegliche Zuweisung. Die letzten Ergebnisse werden nicht mehr aktualisiert.'
                    : `Aus. Schaltet eine taegliche, nur lesende Pruefung von ${s?.catalog.length ?? 26} Haertungseinstellungen auf allen Windows-Geraeten ein (Intune Remediations).`}
          </p>
        </div>
        <button
          onClick={() => setToggle(s?.enabled ? 'disable' : 'enable')}
          disabled={query.isLoading || Boolean(query.error)}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {s?.enabled ? 'Haertungspruefung ausschalten' : 'Haertungspruefung einschalten'}
        </button>
      </div>

      {toggle && (
        <JobActionDialog
          title={toggle === 'enable' ? 'Haertungspruefung einschalten' : 'Haertungspruefung ausschalten'}
          confirmLabel={toggle === 'enable' ? 'Einschalten' : 'Ausschalten'}
          createJob={() => api.post<Job>(`/tenants/${tenantId}/scripts/hardening/${toggle}`)}
          onClose={() => setToggle(null)}
          onCompleted={() => queryClient.invalidateQueries({ queryKey: ['security-hardening', tenantId] })}
        />
      )}

      {query.isLoading && <LoadingTable rows={4} />}
      {query.error && <ErrorState error={query.error as Error} onRetry={query.refetch} />}

      {s && s.tenantScriptId && summary && summary.devicesReporting === 0 && (
        <EmptyState title="Noch keine Meldungen" description="Geraete melden nach dem ersten taeglichen Lauf; offline Geraete beim naechsten Start. Das kann bis zu einem Tag dauern." />
      )}

      {summary && summary.devicesReporting > 0 && (
        <>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Erfuellt (Durchschnitt)</div>
              <div className={clsx('text-2xl font-semibold tabular-nums', summary.scorePercent !== null && scoreTone(summary.scorePercent))}>{summary.scorePercent ?? '-'} %</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Geraete mit Meldung</div>
              <div className="text-2xl font-semibold tabular-nums">{summary.devicesReporting}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Offene Kontrollen</div>
              <div className="text-2xl font-semibold tabular-nums">{failingControls.filter((c) => c.failing > 0).length}</div>
            </div>
            {summary.staleDevices > 0 && (
              <div className="self-end rounded-md border border-warning/40 bg-warning/10 px-3 py-1 text-xs" role="status">
                {summary.staleDevices} Geraete haben seit mehr als 3 Tagen nicht gemeldet; ihre Werte sind moeglicherweise veraltet.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Kontrollen</h3>
              <button onClick={() => setShowAll((v) => !v)} className="text-xs text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {showAll ? 'Nur offene zeigen' : `Alle ${summary.controls.length} zeigen`}
              </button>
            </div>
            {controls.length === 0 ? (
              <EmptyState title="Alle Kontrollen erfuellt" description="Auf keinem meldenden Geraet ist eine Kontrolle offen." />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Kontrolle</th>
                      <th className="px-3 py-2 font-medium">Bereich</th>
                      <th className="px-3 py-2 text-right font-medium">Offen</th>
                      <th className="px-3 py-2 text-right font-medium">Erfuellt</th>
                      <th className="px-3 py-2 text-right font-medium">n. z. / unlesbar</th>
                      <th className="px-3 py-2 font-medium">Empfehlung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {controls.map((c) => (
                      <tr key={c.id} className="border-t align-top">
                        <td className="px-3 py-2">
                          {c.title}
                          <span className="block font-mono text-[11px] text-muted-foreground">{c.id}</span>
                        </td>
                        <td className="px-3 py-2 text-xs">{hardeningAreaLabels[c.area]}</td>
                        <td className={clsx('px-3 py-2 text-right tabular-nums', c.failing > 0 && 'font-medium text-destructive')}>{c.failing}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-success">{c.passing}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                          {c.notApplicable} / {c.unreadable}
                        </td>
                        <td className="max-w-md px-3 py-2 text-xs text-muted-foreground">{c.recommendation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Geraete mit dem niedrigsten Stand</h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Geraet</th>
                    <th className="px-3 py-2 text-right font-medium">Erfuellt</th>
                    <th className="px-3 py-2 font-medium">Offen</th>
                    <th className="px-3 py-2 font-medium">Gemeldet</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.devices.slice(0, 15).map((d) => (
                    <tr key={d.managedDeviceId} className="border-t align-top">
                      <td className="px-3 py-2">
                        <Link href={`/devices/${encodeURIComponent(d.managedDeviceId)}`} className="font-medium text-primary hover:underline">
                          {d.deviceName}
                        </Link>
                      </td>
                      <td className={clsx('px-3 py-2 text-right tabular-nums', scoreTone(d.scorePercent))}>{d.scorePercent} %</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.failedIds.length === 0 ? '-' : d.failedIds.map((id) => titleFor(s?.catalog ?? [], id)).join(', ')}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{d.reportedAt ? new Date(d.reportedAt).toLocaleString('de-DE') : 'unbekannt'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.devices.length > 15 && <p className="text-xs text-muted-foreground">{summary.devices.length - 15} weitere Geraete mit hoeherem Stand.</p>}
          </div>
        </>
      )}
    </section>
  );
}
