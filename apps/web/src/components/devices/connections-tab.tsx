'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { ConnectionsTable } from '@/components/devices/connections-table';
import type { ConnectionResult, Device } from '@zerostress/types';

const dayOptions = [1, 3, 7, 14, 30];

/**
 * Wohin spricht dieses Geraet: Ziele aus Defender Advanced Hunting
 * (DeviceNetworkEvents), zusammengefasst je Zieladresse.
 */
export function ConnectionsTab({ base, tenantId, device }: { base: string; tenantId: string; device: Device }) {
  const [days, setDays] = useState(7);
  const query = useQuery({
    queryKey: ['device-connections', tenantId, device.id, days],
    queryFn: () => api.get<ConnectionResult>(`${base}/connections?days=${days}`),
    staleTime: 10 * 60 * 1000,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Netzwerkverbindungen laut Defender-Sensor, je Ziel zusammengefasst: Host, Ports, ausloesende Prozesse, Richtung und Haeufigkeit. Grundlage fuer die Frage, mit wem der Client spricht, und fuer Firewall-Regeln. Braucht Defender for Endpoint Plan 2 (Advanced Hunting).
        </p>
        <label className="text-sm">
          <span className="mr-2 text-xs text-muted-foreground">Zeitraum</span>
          <select className="rounded-md border bg-background px-2 py-1 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {dayOptions.map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? 'Tag' : 'Tage'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {query.isLoading ? (
        <LoadingTable rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !query.data ? null : !query.data.available ? (
        <CapabilityNotice what="die Verbindungsdaten (Advanced Hunting)" reason={query.data.reason} missingPermission={query.data.missingPermission} detail={query.data.detail} />
      ) : query.data.data.items.length === 0 ? (
        <EmptyState title="Keine Verbindungen im Zeitraum" description="Der Sensor hat in diesem Zeitraum keine Netzwerkereignisse fuer dieses Geraet gemeldet." />
      ) : (
        <ConnectionsTable report={query.data.data} storageKey="device-connections" exportFileName={`verbindungen-${device.name}`} withDevices={false} />
      )}
    </div>
  );
}
