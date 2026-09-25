'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingSpinner } from '@/components/ui/loading';
import type { InventoryKind, SnapshotMeta, TenantInventoryStatus } from '@zerostress/types';

const kindLabels: Record<InventoryKind, string> = {
  devices: 'Geraete',
  vulnerabilities: 'Schwachstellen',
};

export function formatAge(iso: string | null, now = Date.now()): string {
  if (!iso) return 'noch nie geladen';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'gerade eben';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours} h`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

interface SnapshotStatusProps {
  tenantId: string;
  // Welche Bestandsarten diese Seite braucht
  kinds: InventoryKind[];
  // Abfragen, die nach einem neuen Stand neu geladen werden
  invalidate: QueryKey[];
  className?: string;
}

/**
 * Zeigt das Alter des Bestands-Snapshots und stoesst den Abgleich mit
 * Microsoft an. Waehrend ein Sync laeuft, wird der Stand alle drei
 * Sekunden geprueft; sobald er sich aendert, laden die Seitenabfragen neu.
 */
export function SnapshotStatus({ tenantId, kinds, invalidate, className }: SnapshotStatusProps) {
  const queryClient = useQueryClient();
  const lastSynced = useRef<string | null>(null);

  const status = useQuery({
    queryKey: ['inventory-status', tenantId],
    queryFn: () => api.get<TenantInventoryStatus>(`/tenants/${tenantId}/inventory`),
    refetchInterval: (query) => (query.state.data?.snapshots.some((s) => kinds.includes(s.kind) && s.status === 'running') ? 3000 : false),
    staleTime: 10 * 1000,
  });

  const relevant = (status.data?.snapshots ?? []).filter((s) => kinds.includes(s.kind));
  const running = relevant.some((s) => s.status === 'running');
  const oldest = relevant.reduce<SnapshotMeta | null>((acc, s) => {
    if (!acc) return s;
    if (!s.syncedAt) return s;
    if (!acc.syncedAt) return acc;
    return new Date(s.syncedAt) < new Date(acc.syncedAt) ? s : acc;
  }, null);
  const errors = relevant.filter((s) => s.status === 'error');
  const fingerprint = relevant.map((s) => `${s.kind}:${s.syncedAt ?? ''}`).join('|');

  // Neuer Stand angekommen: Seitenabfragen neu laden
  useEffect(() => {
    if (!fingerprint) return;
    if (lastSynced.current !== null && lastSynced.current !== fingerprint) {
      for (const key of invalidate) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    }
    lastSynced.current = fingerprint;
    // invalidate ist ein Literal der Seite und aendert sich nicht
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, queryClient]);

  const refresh = useMutation({
    mutationFn: () => api.post<TenantInventoryStatus>(`/tenants/${tenantId}/inventory/refresh`, { kinds }),
    onSuccess: (data) => {
      queryClient.setQueryData(['inventory-status', tenantId], data);
    },
  });

  const busy = running || refresh.isPending;

  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', className)} role="status" aria-live="polite">
      <span title={oldest?.syncedAt ? new Date(oldest.syncedAt).toLocaleString('de-DE') : undefined}>
        {busy ? 'Abgleich mit Microsoft laeuft…' : `Stand ${formatAge(oldest?.syncedAt ?? null)}`}
        {!busy && oldest?.live && ' (gerade geladen)'}
      </span>
      {errors.length > 0 && !busy && (
        <span className="text-destructive" title={errors.map((e) => `${kindLabels[e.kind]}: ${e.error ?? 'unbekannter Fehler'}`).join('\n')}>
          Letzter Abgleich fehlgeschlagen ({errors.map((e) => kindLabels[e.kind]).join(', ')}), alter Stand wird gezeigt
        </span>
      )}
      {refresh.error && <span className="text-destructive">{(refresh.error as Error).message}</span>}
      <button
        onClick={() => refresh.mutate()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <LoadingSpinner size="sm" />}
        Jetzt aktualisieren
      </button>
    </div>
  );
}
