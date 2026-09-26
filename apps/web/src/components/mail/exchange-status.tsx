'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingSpinner } from '@/components/ui/loading';
import { ErrorBanner } from '@/components/ui/error-state';
import { formatDateTime } from '@/components/identity/sign-in-table';
import type { ExchangeJobRecord, Job } from '@zerostress/types';

interface ExchangeStatus {
  workerConfigured: boolean;
  collectedAt: string | null;
  workerId: string | null;
  mailboxes: number;
  autoForwardingMode: string | null;
  mailboxForwarders: Array<{ userPrincipalName: string; displayName: string; target: string | null; keepCopy: boolean }>;
  recentJobs: ExchangeJobRecord[];
}

const statusLabels: Record<ExchangeJobRecord['status'], string> = { queued: 'wartet', claimed: 'angenommen', running: 'laeuft', succeeded: 'erfolgreich', failed: 'fehlgeschlagen' };

/**
 * Stand der Worker-Daten je Tenant, Sammeln anstossen, Weiterleitungen auf
 * Postfachebene (die der Graph-Scan nicht sieht) und die letzten Auftraege.
 */
export function ExchangeStatusPanel({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['exchange-status', tenantId],
    queryFn: () => api.get<ExchangeStatus>(`/tenants/${tenantId}/mail/exchange`),
    refetchInterval: (q) => (q.state.data?.recentJobs.some((j) => ['queued', 'claimed', 'running'].includes(j.status)) ? 5000 : false),
    staleTime: 60 * 1000,
  });
  const collect = useMutation({
    mutationFn: () => api.post<Job>(`/tenants/${tenantId}/mail/exchange/collect`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-status', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] });
    },
  });
  const status = query.data;
  const active = status?.recentJobs.some((j) => ['queued', 'claimed', 'running'].includes(j.status)) ?? false;

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Exchange-Worker</h2>
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
            Kontingente, Weiterleitung auf Postfachebene, Vollzugriff, Senden als, Archiv und Beweissicherung liefert Exchange nur per PowerShell. Der Worker sammelt diese Daten je Tenant und fuehrt Aenderungen aus dem Postfachdetail aus.
          </p>
          {status && (
            <p className="mt-1 text-xs text-muted-foreground">
              {status.collectedAt ? `Stand ${formatDateTime(status.collectedAt)} · ${status.mailboxes} Postfaecher · Worker ${status.workerId}` : 'Noch keine Daten gesammelt.'}
              {status.autoForwardingMode ? ` · Automatische Weiterleitung (Outbound-Spam-Richtlinie): ${status.autoForwardingMode}` : ''}
            </p>
          )}
        </div>
        <button onClick={() => collect.mutate()} disabled={collect.isPending || active || status?.workerConfigured === false} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
          {(collect.isPending || active) && <LoadingSpinner size="sm" />}
          {active ? 'Sammeln laeuft' : 'Postfachdaten sammeln'}
        </button>
      </div>
      <ErrorBanner error={collect.error as Error | null} onDismiss={() => collect.reset()} />
      {status && !status.workerConfigured && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">Kein Worker eingerichtet: in der API fehlt WORKER_TOKEN. Einrichtung in apps/worker-exchange/README.md.</p>}

      {status && status.mailboxForwarders.length > 0 && (
        <div>
          <p className="text-sm font-medium text-destructive">Weiterleitung auf Postfachebene ({status.mailboxForwarders.length})</p>
          <ul className="mt-1 divide-y rounded-md border text-sm">
            {status.mailboxForwarders.map((f) => (
              <li key={f.userPrincipalName} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <Link href={`/mail/${encodeURIComponent(f.userPrincipalName)}`} className="font-medium hover:underline">
                  {f.displayName}
                </Link>
                <span className="text-xs text-muted-foreground">
                  an {f.target} {f.keepCopy ? '(Kopie bleibt)' : '(ohne Kopie)'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status && status.recentJobs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Letzte Worker-Auftraege ({status.recentJobs.length})</summary>
          <ul className="mt-2 divide-y rounded-md border text-xs">
            {status.recentJobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span>
                  <span className={clsx('font-medium', j.status === 'failed' && 'text-destructive', j.status === 'succeeded' && 'text-success')}>{statusLabels[j.status]}</span> · {j.operation}
                  {typeof j.parameters.identity === 'string' ? ` · ${j.parameters.identity}` : ''}
                </span>
                <span className="text-muted-foreground">
                  {formatDateTime(j.createdAt)}
                  {j.workerId ? ` · ${j.workerId}` : ''}
                </span>
                {j.error && <span className="basis-full text-destructive">{j.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
