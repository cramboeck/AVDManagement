'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable, LoadingSpinner } from '@/components/ui/loading';
import { ErrorState, ErrorBanner } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { Collapsible } from '@/components/ui/collapsible';
import type { Alert, AlertSeverity_, AlertStats, AlertStatus, AnomalyRuleId } from '@zerostress/types';

const severityMeta: Record<AlertSeverity_, { label: string; className: string }> = {
  high: { label: 'Hoch', className: 'bg-destructive/10 text-destructive' },
  medium: { label: 'Mittel', className: 'bg-warning/10 text-warning' },
  low: { label: 'Niedrig', className: 'bg-muted text-muted-foreground' },
};

const ruleLabels: Record<AnomalyRuleId, string> = {
  'failed-burst': 'Fehlversuche gehaeuft',
  'password-spray': 'Password Spray',
  'success-after-failures': 'Erfolg nach Fehlversuchen',
  'country-hop': 'Laenderwechsel',
  'legacy-auth-success': 'Legacy-Authentifizierung',
  'risky-success': 'Riskante Anmeldung',
  'blocked-software': 'Gesperrte Software',
};

const statusLabels: Record<AlertStatus, string> = { open: 'Offen', acknowledged: 'In Bearbeitung', resolved: 'Geschlossen' };

export default function AlertsPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AlertStatus | 'all'>('open');
  const [error, setError] = useState<Error | null>(null);

  const query = useQuery({
    queryKey: ['alerts', activeTenant?.id, status],
    queryFn: () => api.get<{ items: Alert[]; stats: AlertStats }>(`/tenants/${activeTenant!.id}/alerts${status === 'all' ? '' : `?status=${status}`}`),
    enabled: !!activeTenant,
    refetchInterval: 60 * 1000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['alerts', activeTenant?.id] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', activeTenant?.id] });
  };

  const evaluate = useMutation({
    mutationFn: () => api.post<{ created: number }>(`/tenants/${activeTenant!.id}/alerts/evaluate`),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e),
  });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'acknowledge' | 'resolve' | 'reopen' }) => api.post<Alert>(`/tenants/${activeTenant!.id}/alerts/${id}/${action}`),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e),
  });

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;
  const data = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            Auffaelligkeiten bei Anmeldungen aus einem festen Regelwerk, alle zehn Minuten ueber die letzten zwei Stunden ausgewertet. Braucht Entra ID P1 fuer das Anmeldeprotokoll.
          </p>
        </div>
        <button onClick={() => evaluate.mutate()} disabled={evaluate.isPending} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
          {evaluate.isPending && <LoadingSpinner size="sm" />}
          Jetzt auswerten
        </button>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {data && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Offen" value={data.stats.open} tone={data.stats.open > 0 ? 'warning' : undefined} />
          <Stat label="Hoch" value={data.stats.high} tone={data.stats.high > 0 ? 'destructive' : undefined} />
          <Stat label="Mittel" value={data.stats.medium} />
          <Stat label="Niedrig" value={data.stats.low} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['open', 'acknowledged', 'resolved', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
            className={clsx('rounded-full border px-3 py-1 text-xs', status === s ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}
          >
            {s === 'all' ? 'Alle' : statusLabels[s]}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <LoadingTable rows={5} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={status === 'open' ? 'Keine offenen Alerts' : 'Keine Alerts in dieser Auswahl'} description="Das Regelwerk hat in den ausgewerteten Anmeldungen nichts Auffaelliges gefunden." />
      ) : (
        <ul className="space-y-2">
          {data.items.map((a) => (
            <li key={a.id}>
              <Collapsible
                summary={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', severityMeta[a.severity].className)}>{severityMeta[a.severity].label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{ruleLabels[a.ruleId] ?? a.ruleId}</span>
                    <span className="font-medium">{a.title}</span>
                  </span>
                }
                aside={`${formatDateTime(a.lastSeenAt)} · ${statusLabels[a.status]}`}
                defaultOpen={a.severity === 'high' && a.status === 'open'}
              >
                <div className="space-y-3 text-sm">
                  <p>{a.summary}</p>
                  <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="flex gap-2">
                      <dt>Zeitraum</dt>
                      <dd>
                        {formatDateTime(a.firstSeenAt)} bis {formatDateTime(a.lastSeenAt)} · {a.occurrences} Ereignisse
                      </dd>
                    </div>
                    {a.userId && (
                      <div className="flex gap-2">
                        <dt>Benutzer</dt>
                        <dd>
                          <Link href={`/users/${encodeURIComponent(a.userId)}`} className="text-primary hover:underline">
                            {a.userPrincipalName ?? a.userId}
                          </Link>
                        </dd>
                      </div>
                    )}
                    {Object.entries(a.evidence).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="font-mono">{k}</dt>
                        <dd className="truncate">{Array.isArray(v) ? v.join(', ') : String(v ?? '—')}</dd>
                      </div>
                    ))}
                    {a.notifiedAt && (
                      <div className="flex gap-2">
                        <dt>Mail</dt>
                        <dd>gesendet {formatDateTime(a.notifiedAt)}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    {a.status === 'open' && (
                      <button onClick={() => transition.mutate({ id: a.id, action: 'acknowledge' })} className="rounded-md border px-3 py-1 text-xs hover:bg-accent">
                        In Bearbeitung nehmen
                      </button>
                    )}
                    {a.status !== 'resolved' && (
                      <button onClick={() => transition.mutate({ id: a.id, action: 'resolve' })} className="rounded-md border px-3 py-1 text-xs hover:bg-accent">
                        Schliessen
                      </button>
                    )}
                    {a.status === 'resolved' && (
                      <button onClick={() => transition.mutate({ id: a.id, action: 'reopen' })} className="rounded-md border px-3 py-1 text-xs hover:bg-accent">
                        Wieder oeffnen
                      </button>
                    )}
                    {a.userId && (
                      <Link href={`/users/${encodeURIComponent(a.userId)}`} className="rounded-md border px-3 py-1 text-xs hover:bg-accent">
                        Benutzer oeffnen
                      </Link>
                    )}
                  </div>
                </div>
              </Collapsible>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'destructive' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>{value}</p>
    </div>
  );
}
