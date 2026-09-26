'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { ConnectionsTable } from '@/components/devices/connections-table';
import type { ConnectionResult } from '@zerostress/types';

const dayOptions = [1, 3, 7, 14, 30];

/**
 * Kommunikationsuebersicht des Tenants: mit welchen Zielen sprechen die
 * Clients, wie viele Geraete je Ziel. Extern fuer die Firewall nach draussen,
 * intern fuer Regeln innerhalb des Netzes.
 */
export function TenantConnections({ tenantId }: { tenantId: string }) {
  const [started, setStarted] = useState(false);
  const [days, setDays] = useState(7);
  const [scope, setScope] = useState<'external' | 'internal'>('external');
  const query = useQuery({
    queryKey: ['tenant-connections', tenantId, days, scope],
    queryFn: () => api.get<ConnectionResult>(`/tenants/${tenantId}/network/connections?days=${days}&scope=${scope}`),
    enabled: started,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Kommunikation der Clients</h2>
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
            Ziele aller Geraete aus Defender Advanced Hunting, je Ziel mit Anzahl Geraete, Ports und Prozessen. Extern: oeffentliche Adressen, Grundlage fuer ausgehende Firewall-Regeln. Intern: private Adressen, also Server, Drucker und Clients untereinander. Braucht Defender for Endpoint Plan 2.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border text-xs">
            {(['external', 'internal'] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} aria-pressed={scope === s} className={clsx('px-3 py-1.5', scope === s ? 'bg-primary/10 text-primary' : 'hover:bg-accent')}>
                {s === 'external' ? 'Extern' : 'Intern'}
              </button>
            ))}
          </div>
          <select className="rounded-md border bg-background px-2 py-1 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {dayOptions.map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? 'Tag' : 'Tage'}
              </option>
            ))}
          </select>
          <button onClick={() => setStarted(true)} disabled={started && query.isFetching} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
            {started ? (query.isFetching ? 'Lade...' : 'Aktualisieren') : 'Laden'}
          </button>
        </div>
      </div>
      {!started ? (
        <p className="text-xs text-muted-foreground">Die Abfrage laeuft gegen Advanced Hunting und kann bei vielen Geraeten einige Sekunden dauern. Jeder Abruf steht im Audit.</p>
      ) : query.isLoading ? (
        <LoadingTable rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !query.data ? null : !query.data.available ? (
        <CapabilityNotice what="die Verbindungsdaten (Advanced Hunting)" reason={query.data.reason} missingPermission={query.data.missingPermission} detail={query.data.detail} />
      ) : query.data.data.items.length === 0 ? (
        <EmptyState title="Keine Verbindungen im Zeitraum" description="Advanced Hunting hat fuer diesen Zeitraum keine passenden Netzwerkereignisse." />
      ) : (
        <ConnectionsTable report={query.data.data} storageKey={`tenant-connections-${scope}`} exportFileName={`kommunikation-${scope}`} withDevices />
      )}
    </section>
  );
}
