'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingSpinner } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import type { CapabilityResult, ForwardingScan } from '@zerostress/types';

/**
 * Weiterleitungs-Scan: liest die Posteingangsregeln aller Postfaecher und
 * zeigt die mit Weiterleitung oder Umleitung; externe Ziele zuerst.
 */
export function ForwardingScanPanel({ tenantId }: { tenantId: string }) {
  const [started, setStarted] = useState(false);
  const query = useQuery({
    queryKey: ['forwarding-scan', tenantId],
    queryFn: () => api.get<CapabilityResult<ForwardingScan>>(`/tenants/${tenantId}/mail/forwarding-scan`),
    enabled: started,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Weiterleitungen</h2>
          <p className="text-xs text-muted-foreground">Posteingangsregeln aller Postfaecher, die Mails weiterleiten oder umleiten. Externe Ziele sind der typische Abflussweg nach einer Kontouebernahme.</p>
        </div>
        <button
          onClick={() => {
            setStarted(true);
            if (started) query.refetch();
          }}
          disabled={query.isFetching}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          {query.isFetching && <LoadingSpinner size="sm" />}
          {started ? 'Erneut pruefen' : 'Jetzt pruefen'}
        </button>
      </div>

      {!started ? null : query.isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Lese Regeln aller Postfaecher, das kann bei grossen Tenants eine Minute dauern...</p>
      ) : query.error ? (
        <div className="mt-3">
          <ErrorState error={query.error as Error} onRetry={query.refetch} />
        </div>
      ) : !query.data ? null : !query.data.available ? (
        <div className="mt-3">
          <CapabilityNotice what="die Posteingangsregeln" reason={query.data.reason} missingPermission={query.data.missingPermission} detail={query.data.detail} compact />
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className={clsx('text-sm', query.data.data.externalCount > 0 ? 'text-destructive' : 'text-muted-foreground')}>
            {query.data.data.scannedMailboxes} Postfaecher geprueft{query.data.data.failedMailboxes > 0 ? `, ${query.data.data.failedMailboxes} nicht lesbar` : ''}: {query.data.data.findings.length} Regel(n) mit Weiterleitung, davon {query.data.data.externalCount} aktiv an fremde Domaenen.
            <span className="block text-xs text-muted-foreground">Tenant-Domaenen: {query.data.data.tenantDomains.join(', ')} · Stand {new Date(query.data.data.scannedAt).toLocaleTimeString('de-DE')}</span>
          </p>
          {query.data.data.findings.length > 0 && (
            <ul className="divide-y rounded-md border">
              {query.data.data.findings.map((f) => (
                <li key={`${f.userPrincipalName}-${f.rule.id}`} className={clsx('flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm', f.rule.forwardsExternally && f.rule.isEnabled && 'bg-destructive/5')}>
                  <div className="min-w-0">
                    <Link href={`/mail/${encodeURIComponent(f.userPrincipalName)}`} className="font-medium hover:underline">
                      {f.displayName}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{f.rule.displayName}</span>
                    <p className="text-xs text-muted-foreground">
                      {f.rule.actions
                        .filter((a) => a.recipients.length > 0)
                        .map((a) => `${a.kind === 'redirect' ? 'umleiten' : 'weiterleiten'} an ${a.recipients.join(', ')}`)
                        .join('; ')}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {!f.rule.isEnabled && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">aus</span>}
                    <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', f.rule.forwardsExternally ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>{f.rule.forwardsExternally ? 'extern' : 'intern'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
