'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ErrorBanner } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import type { CapabilityResult, RemoteSupportMatch } from '@zerostress/types';

/**
 * Knopf "Remote-Sitzung": findet das Geraet bei TeamViewer, fragt eine
 * Begruendung ab, protokolliert den Start und oeffnet die TeamViewer-URI.
 */
export function RemoteSessionButton({ base, tenantId, deviceId }: { base: string; tenantId: string; deviceId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['device-remote-support', tenantId, deviceId],
    queryFn: () => api.get<CapabilityResult<RemoteSupportMatch>>(`${base}/remote-support`),
    staleTime: 5 * 60 * 1000,
  });

  const result = query.data;
  if (!result) return null;
  if (!result.available) {
    if (result.reason === 'not-onboarded') return null;
    return (
      <span className="text-xs text-muted-foreground" title={result.detail ?? undefined}>
        TeamViewer: {result.missingPermission ?? result.reason}
      </span>
    );
  }
  if (!result.data.found) {
    return (
      <span className="text-xs text-muted-foreground" title="Der Alias des Geraets in TeamViewer muss dem Hostnamen entsprechen">
        Nicht in TeamViewer gefunden
      </span>
    );
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        Remote-Sitzung{result.data.online === false && <span className="ml-1 text-xs text-muted-foreground">(offline)</span>}
      </button>
      {open && <SessionDialog base={base} match={result.data} onClose={() => setOpen(false)} />}
    </>
  );
}

function SessionDialog({ base, match, onClose }: { base: string; match: RemoteSupportMatch; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const start = useMutation({
    mutationFn: () => api.post<{ uri: string }>(`${base}/remote-support/session`, { reason }),
    onSuccess: ({ uri }) => {
      window.location.assign(uri);
      onClose();
    },
  });

  const valid = reason.trim().length >= 10;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="remote-session-title">
        <div className="border-b px-4 py-3">
          <h2 id="remote-session-title" className="font-medium">
            Remote-Sitzung starten
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            TeamViewer-Geraet {match.alias ?? match.deviceId}
            {match.online === false && ', derzeit offline'}. Der TeamViewer-Client auf deinem Rechner baut die Verbindung auf.
          </p>
        </div>
        <div className="space-y-3 p-4">
          <ErrorBanner error={start.error as Error | null} onDismiss={() => start.reset()} />
          <label htmlFor="remote-session-reason" className="block text-sm font-medium">
            Begruendung (wird im Audit-Log gespeichert)
          </label>
          <textarea
            ref={reasonRef}
            id="remote-session-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="z. B. Ticket #4711: Benutzer meldet Druckerproblem"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button
            onClick={() => start.mutate()}
            disabled={!valid || start.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {start.isPending && <LoadingSpinner size="sm" className="text-primary-foreground" />}
            Verbinden
          </button>
        </div>
      </div>
    </div>
  );
}
