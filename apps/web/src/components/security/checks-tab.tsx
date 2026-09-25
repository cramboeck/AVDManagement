'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { Meter } from '@/components/charts/meter';
import type { SecurityCheck, SecurityCheckCategory, SecurityCheckReport, SecurityCheckStatus } from '@zerostress/types';

const statusMeta: Record<SecurityCheckStatus, { label: string; className: string; dot: string }> = {
  fail: { label: 'Offen', className: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  warn: { label: 'Verbessern', className: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  pass: { label: 'Erfuellt', className: 'bg-success/10 text-success', dot: 'bg-success' },
  unknown: { label: 'Nicht pruefbar', className: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  'not-applicable': { label: 'Nicht zutreffend', className: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
};

const categoryLabels: Record<SecurityCheckCategory, string> = {
  identity: 'Identitaet und MFA',
  access: 'Zugriff',
  governance: 'Verwaltung',
  devices: 'Geraete',
  mail: 'E-Mail-Authentifizierung',
};

const categoryOrder: SecurityCheckCategory[] = ['identity', 'access', 'governance', 'devices', 'mail'];

export function ChecksTab({ tenantId }: { tenantId: string }) {
  const [filter, setFilter] = useState<SecurityCheckStatus | 'all'>('all');
  const query = useQuery({
    queryKey: ['security-checks', tenantId],
    queryFn: () => api.get<SecurityCheckReport>(`/tenants/${tenantId}/security/checks`),
    staleTime: 10 * 60 * 1000,
  });

  if (query.isLoading) return <LoadingTable rows={8} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const report = query.data;
  if (!report) return null;

  const visible = report.checks.filter((c) => filter === 'all' || c.status === filter);
  const grouped = categoryOrder.map((cat) => ({ cat, checks: visible.filter((c) => c.category === cat) })).filter((g) => g.checks.length > 0);

  return (
    <div className={clsx('space-y-6 transition-opacity', query.isFetching && 'opacity-70')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Eigener Katalog aus Microsoft-Empfehlungen, live geprueft um {new Date(report.generatedAt).toLocaleTimeString('de-DE')}. Keine Aenderung wird ausgeloest.
        </p>
        <button onClick={() => query.refetch()} disabled={query.isFetching} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
          {query.isFetching ? 'Pruefe...' : 'Neu pruefen'}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border p-4">
          {report.scorePercent === null ? (
            <p className="text-sm text-muted-foreground">Kein Ergebnis bewertbar.</p>
          ) : (
            <Meter
              label="Erfuellungsgrad"
              percent={report.scorePercent}
              tone={report.scorePercent >= 80 ? 'good' : report.scorePercent >= 50 ? 'warning' : 'critical'}
              detail="Gewichtet: wesentliche Checks zaehlen dreifach, Verbesserungen halb"
            />
          )}
        </section>
        <section className="rounded-lg border p-4 lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            {(['all', 'fail', 'warn', 'pass', 'unknown'] as const).map((s) => {
              const count = s === 'all' ? report.checks.length : report.counts[s];
              return (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  aria-pressed={filter === s}
                  className={clsx(
                    'rounded-full px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    s === 'all' ? 'bg-muted text-muted-foreground' : statusMeta[s].className,
                    filter === s && 'ring-2 ring-primary'
                  )}
                >
                  {s === 'all' ? 'Alle' : statusMeta[s].label}: {count}
                </button>
              );
            })}
          </div>
          {report.unavailableSources.length > 0 && (
            <div className="mt-3 space-y-2">
              {report.unavailableSources.map((s) => (
                <CapabilityNotice key={s.source} what={s.source} reason={s.reason} missingPermission={s.missingPermission} detail={s.detail} compact />
              ))}
            </div>
          )}
        </section>
      </div>

      {grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Checks in dieser Auswahl.</p>
      ) : (
        grouped.map((g) => (
          <section key={g.cat} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">{categoryLabels[g.cat]}</h2>
            <ul className="divide-y rounded-lg border">
              {g.checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function CheckRow({ check }: { check: SecurityCheck }) {
  const [open, setOpen] = useState(check.status === 'fail');
  const meta = statusMeta[check.status];
  const evidence = Object.entries(check.evidence).filter(([, v]) => v !== null && v !== undefined);
  return (
    <li>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span className={clsx('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', meta.dot)} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{check.title}</span>
            <span className={clsx('rounded-full px-2 py-0.5 text-xs', meta.className)}>{meta.label}</span>
            {check.weight === 3 && <span className="text-xs text-muted-foreground">wesentlich</span>}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{check.summary}</span>
        </span>
        <span className="text-xs text-muted-foreground">{open ? 'Weniger' : 'Mehr'}</span>
      </button>
      {open && (
        <div className="space-y-2 px-4 pb-3 pl-9 text-sm">
          <p>
            <span className="font-medium">Empfehlung:</span> {check.recommendation}
          </p>
          {evidence.length > 0 && (
            <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
              {evidence.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="font-mono">{k}</dt>
                  <dd className="truncate">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {check.docsUrl && (
            <a href={check.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
              Microsoft-Dokumentation
            </a>
          )}
        </div>
      )}
    </li>
  );
}
