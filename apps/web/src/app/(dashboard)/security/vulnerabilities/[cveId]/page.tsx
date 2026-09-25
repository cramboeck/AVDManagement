'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingPage, LoadingSpinner } from '@/components/ui/loading';
import { ErrorState, ErrorBanner } from '@/components/ui/error-state';
import { NoTenantSelected } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { formatDateTime } from '@/components/identity/sign-in-table';
import type { CveDetail, CveExplanation, VulnerabilitySeverity } from '@zerostress/types';

type Priority = 'sofort' | 'hoch' | 'mittel' | 'niedrig';

const severityClasses: Record<VulnerabilitySeverity, string> = {
  Critical: 'bg-destructive/15 text-destructive',
  High: 'bg-destructive/10 text-destructive',
  Medium: 'bg-warning/10 text-warning',
  Low: 'bg-muted text-muted-foreground',
  Unknown: 'bg-muted text-muted-foreground',
};

const priorityMeta: Record<Priority, { label: string; className: string }> = {
  sofort: { label: 'Sofort handeln', className: 'bg-destructive text-white' },
  hoch: { label: 'Hohe Prioritaet', className: 'bg-destructive/15 text-destructive' },
  mittel: { label: 'Mittlere Prioritaet', className: 'bg-warning/10 text-warning' },
  niedrig: { label: 'Niedrige Prioritaet', className: 'bg-muted text-muted-foreground' },
};

const urgencyLabels: Record<CveExplanation['urgency'], string> = {
  sofort: 'Sofort',
  'diese-woche': 'Diese Woche',
  'naechster-patchzyklus': 'Naechster Patchzyklus',
  informativ: 'Informativ',
};

// Deterministische Einstufung aus KEV, Exploit, EPSS und Schwere; die KI-Einschaetzung ergaenzt sie nur
function derivePriority(detail: CveDetail): { priority: Priority; reasons: string[] } {
  const reasons: string[] = [];
  const d = detail.defender.available ? detail.defender.data : null;
  const kev = detail.enrichment.kev.status === 'ok';
  const epss = detail.enrichment.epss.data?.probability ?? 0;
  const severity = d?.severity ?? (detail.enrichment.nvd.data?.cvssSeverity as VulnerabilitySeverity | undefined) ?? 'Unknown';

  if (kev) reasons.push('Von CISA als aktiv ausgenutzt gelistet');
  if (d?.publicExploit) reasons.push(d.exploitVerified ? 'Oeffentlicher, verifizierter Exploit' : 'Oeffentlicher Exploit');
  if (d?.exploitInKit) reasons.push('In Exploit-Kits enthalten');
  if (epss >= 0.5) reasons.push(`EPSS ${(epss * 100).toFixed(0)} %: hohe Ausnutzungswahrscheinlichkeit`);
  if (d && d.exposedMachines > 0) reasons.push(`${d.exposedMachines} betroffene Geraete in diesem Tenant`);

  if (kev || (d?.publicExploit && (severity === 'Critical' || severity === 'High'))) return { priority: 'sofort', reasons };
  if (severity === 'Critical' || epss >= 0.5 || d?.publicExploit) return { priority: 'hoch', reasons };
  if (severity === 'High' || epss >= 0.1) return { priority: 'mittel', reasons };
  return { priority: 'niedrig', reasons };
}

export default function CveDetailPage({ params }: { params: { cveId: string } }) {
  const cveId = decodeURIComponent(params.cveId).toUpperCase();
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [explainError, setExplainError] = useState<Error | null>(null);

  const base = activeTenant ? `/tenants/${activeTenant.id}/vulnerabilities/${encodeURIComponent(cveId)}` : '';

  const detailQuery = useQuery({
    queryKey: ['cve', activeTenant?.id, cveId],
    queryFn: () => api.get<CveDetail>(base),
    enabled: !!activeTenant,
    staleTime: 10 * 60 * 1000,
  });

  const explainMutation = useMutation({
    mutationFn: () => api.post<CveExplanation>(`${base}/explain`),
    onSuccess: (explanation) => {
      queryClient.setQueryData<CveDetail>(['cve', activeTenant?.id, cveId], (old) => (old ? { ...old, explanation } : old));
      setExplainError(null);
    },
    onError: (err: Error) => setExplainError(err),
  });

  if (tenantLoading) return <LoadingPage message="Lade Tenant..." />;
  if (!activeTenant) return <NoTenantSelected />;
  if (detailQuery.isLoading) return <LoadingPage message={`Lade ${cveId}...`} />;
  if (detailQuery.error) return <ErrorState error={detailQuery.error as Error} onRetry={detailQuery.refetch} />;
  const detail = detailQuery.data;
  if (!detail) return null;

  const defender = detail.defender.available ? detail.defender.data : null;
  const nvd = detail.enrichment.nvd.data;
  const kev = detail.enrichment.kev;
  const epss = detail.enrichment.epss.data;
  const { priority, reasons } = derivePriority(detail);
  const title = defender?.name ?? nvd?.description?.slice(0, 120) ?? cveId;
  const severity = defender?.severity ?? 'Unknown';
  const description = nvd?.description ?? defender?.description ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href="/security" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Zurueck zur Sicherheitsseite">
            ←
          </Link>
          <div>
            <p className="font-mono text-sm text-muted-foreground">{cveId}</p>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', priorityMeta[priority].className)}>{priorityMeta[priority].label}</span>
              <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', severityClasses[severity])}>
                {severity}
                {(defender?.cvssScore ?? nvd?.cvssScore) !== null && (defender?.cvssScore ?? nvd?.cvssScore) !== undefined && (
                  <> · CVSS {defender?.cvssScore ?? nvd?.cvssScore}</>
                )}
              </span>
              {kev.status === 'ok' && (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive" title={`Seit ${kev.data?.dateAdded}`}>
                  CISA KEV{kev.data?.knownRansomwareUse ? ' · Ransomware' : ''}
                </span>
              )}
              {epss && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs" title={`Perzentil ${(epss.percentile * 100).toFixed(0)}, Stand ${epss.date}`}>
                  EPSS {(epss.probability * 100).toFixed(1)} %
                </span>
              )}
              {defender?.publicExploit && (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                  Exploit oeffentlich{defender.exploitVerified ? ', verifiziert' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <a href={detail.enrichment.msrcUrl} target="_blank" rel="noreferrer" className="rounded-md border px-3 py-1.5 hover:bg-accent">
            MSRC
          </a>
          <a href={detail.enrichment.nvdUrl} target="_blank" rel="noreferrer" className="rounded-md border px-3 py-1.5 hover:bg-accent">
            NVD
          </a>
        </div>
      </div>

      {reasons.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-lg border p-4">
            <h2 className="mb-2 font-medium">Beschreibung</h2>
            {description ? (
              <p className="text-sm leading-relaxed">{description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Keine Beschreibung verfuegbar.</p>
            )}
            {nvd?.cweIds.length ? <p className="mt-2 text-xs text-muted-foreground">Schwachstellentyp: {nvd.cweIds.join(', ')}</p> : null}
            {!detail.defender.available && (
              <div className="mt-3">
                <CapabilityNotice what="die Defender-Sicht auf diese CVE" {...detail.defender} compact />
              </div>
            )}
          </section>

          <ExplanationSection
            detail={detail}
            isGenerating={explainMutation.isPending}
            error={explainError}
            onGenerate={() => explainMutation.mutate()}
            onDismissError={() => setExplainError(null)}
          />

          <section className="rounded-lg border p-4">
            <h2 className="mb-2 font-medium">Betroffene Geraete in diesem Tenant</h2>
            {!detail.machines.available ? (
              <CapabilityNotice what="die betroffenen Geraete" {...detail.machines} compact />
            ) : detail.machines.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">Kein Geraet in diesem Tenant ist aktuell betroffen.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Geraet</th>
                    <th className="py-1 pr-3 font-medium">Plattform</th>
                    <th className="py-1 pr-3 font-medium">Gruppe</th>
                    <th className="py-1 font-medium">Erkannt</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.machines.data.map((m) => (
                    <tr key={m.machineId} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">
                        <Link href={`/devices?search=${encodeURIComponent(m.name.split('.')[0])}`} className="hover:underline">
                          {m.name}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{m.osPlatform ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{m.rbacGroupName ?? '—'}</td>
                      <td className="py-1.5 text-xs text-muted-foreground">{m.detectedAt ? formatDateTime(m.detectedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border p-4">
            <h2 className="mb-2 font-medium">Fakten</h2>
            <dl className="space-y-2 text-sm">
              <Fact label="Veroeffentlicht" value={defender?.publishedAt ?? nvd?.publishedAt ? formatDateTime((defender?.publishedAt ?? nvd?.publishedAt) as string) : '—'} />
              <Fact label="Zuletzt geaendert" value={nvd?.lastModifiedAt ? formatDateTime(nvd.lastModifiedAt) : defender?.updatedAt ? formatDateTime(defender.updatedAt) : '—'} />
              <Fact label="Erstmals im Tenant" value={defender?.firstDetectedAt ? formatDateTime(defender.firstDetectedAt) : '—'} />
              <Fact label="CVSS-Vektor" value={defender?.cvssVector ?? nvd?.cvssVector ?? '—'} mono />
              {kev.status === 'ok' && kev.data && (
                <>
                  <Fact label="KEV seit" value={kev.data.dateAdded} />
                  {kev.data.dueDate && <Fact label="KEV-Frist (US-Behoerden)" value={kev.data.dueDate} />}
                  {kev.data.requiredAction && <Fact label="KEV-Massnahme" value={kev.data.requiredAction} />}
                </>
              )}
              {defender && defender.exploitTypes.length > 0 && <Fact label="Exploit-Typen" value={defender.exploitTypes.join(', ')} />}
            </dl>
            <SourceStatus label="CISA KEV" status={kev.status} reason={kev.reason} />
            <SourceStatus label="EPSS" status={detail.enrichment.epss.status} reason={detail.enrichment.epss.reason} />
            <SourceStatus label="NVD" status={detail.enrichment.nvd.status} reason={detail.enrichment.nvd.reason} />
          </section>

          {nvd && nvd.references.length > 0 && (
            <section className="rounded-lg border p-4">
              <h2 className="mb-2 font-medium">Referenzen</h2>
              <ul className="space-y-1 text-xs">
                {nvd.references.slice(0, 12).map((r) => (
                  <li key={r.url} className="truncate">
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-primary hover:underline" title={r.url}>
                      {r.url.replace(/^https?:\/\//, '')}
                    </a>
                    {r.tags.length > 0 && <span className="ml-1 text-muted-foreground">({r.tags.join(', ')})</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ExplanationSection({
  detail,
  isGenerating,
  error,
  onGenerate,
  onDismissError,
}: {
  detail: CveDetail;
  isGenerating: boolean;
  error: Error | null;
  onGenerate: () => void;
  onDismissError: () => void;
}) {
  const explanation = detail.explanation;

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Erklaerung</h2>
        {detail.explanationAvailable ? (
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            {isGenerating && <LoadingSpinner size="sm" />}
            {explanation ? 'Neu erzeugen' : 'Erklaerung erzeugen'}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">KI-Erklaerung nicht eingerichtet (ANTHROPIC_API_KEY)</span>
        )}
      </div>

      <ErrorBanner error={error} onDismiss={onDismissError} className="mb-3" />

      {isGenerating && !explanation && (
        <p className="text-sm text-muted-foreground">Fakten werden zusammengefasst — nur oeffentliche CVE-Daten verlassen das System.</p>
      )}

      {!explanation && !isGenerating && (
        <p className="text-sm text-muted-foreground">
          Erzeugt aus NVD-, KEV-, EPSS- und Defender-Metadaten eine verstaendliche Einordnung mit Handlungsschritten und einem Text fuer den Kunden. Wird pro CVE einmal erzeugt und fuer alle Tenants wiederverwendet.
        </p>
      )}

      {explanation && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', explanation.urgency === 'sofort' ? 'bg-destructive/15 text-destructive' : explanation.urgency === 'diese-woche' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground')}>
              {urgencyLabels[explanation.urgency]}
            </span>
            <span className="text-xs text-muted-foreground">{explanation.urgencyReason}</span>
          </div>
          <p className="leading-relaxed">{explanation.summary}</p>
          {explanation.attackPath && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Angriffsweg</h3>
              <p className="mt-1">{explanation.attackPath}</p>
            </div>
          )}
          {explanation.remediation.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Was zu tun ist</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {explanation.remediation.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )}
          {explanation.customerNote && (
            <div className="rounded-md bg-muted/50 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Text fuer den Kunden</h3>
                <CopyButton text={explanation.customerNote} />
              </div>
              <p className="mt-1">{explanation.customerNote}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Erzeugt {formatDateTime(explanation.generatedAt)} mit {explanation.model}.
            {explanation.sources.length > 0 && (
              <>
                {' '}Quellen:{' '}
                {explanation.sources.map((s, i) => (
                  <a key={s} href={s} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    [{i + 1}]
                  </a>
                ))}
              </>
            )}{' '}
            KI-Text — vor Weitergabe an Kunden gegenlesen.
          </p>
        </div>
      )}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-xs text-primary hover:underline"
    >
      {copied ? 'Kopiert' : 'Kopieren'}
    </button>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={clsx('break-words', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  );
}

function SourceStatus({ label, status, reason }: { label: string; status: 'ok' | 'not-listed' | 'error'; reason: string | null }) {
  const text = status === 'ok' ? 'geladen' : status === 'not-listed' ? 'nicht gelistet' : `nicht erreichbar${reason ? ` (${reason})` : ''}`;
  return (
    <p className={clsx('mt-2 text-xs', status === 'error' ? 'text-warning' : 'text-muted-foreground')}>
      {label}: {text}
    </p>
  );
}
