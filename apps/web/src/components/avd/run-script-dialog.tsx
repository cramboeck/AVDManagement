'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { ScriptResultView } from '@/components/devices/scripts-tab';
import type { Job, ScriptLibraryEntry, ScriptRunResult, SyncedSessionHost } from '@zerostress/types';

interface RunScriptDialogProps {
  tenantId: string;
  host: SyncedSessionHost;
  hostPoolName: string;
  hostPoolResourceId: string;
  onClose: () => void;
}

/**
 * Skript aus der Bibliothek auswaehlen und ueber Azure Run Command auf dem
 * Session-Host ausfuehren; Preview und Ergebnis kommen vom Job.
 */
export function RunScriptDialog({ tenantId, host, hostPoolName, hostPoolResourceId, onClose }: RunScriptDialogProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ScriptLibraryEntry | null>(null);

  const library = useQuery({
    queryKey: ['script-library'],
    queryFn: () => api.get<{ items: ScriptLibraryEntry[] }>(`/tenants/${tenantId}/scripts/library`),
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selected) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, selected]);

  if (selected) {
    return (
      <JobActionDialog
        title={`${selected.displayName} auf ${host.name}`}
        description="Ausfuehrung ueber Azure Run Command, die VM muss laufen."
        confirmLabel="Skript starten"
        createJob={() =>
          api.post<Job>(`/tenants/${tenantId}/avd/actions/run-script`, {
            hostPoolId: hostPoolResourceId,
            hostPoolName,
            sessionHostId: host.id,
            sessionHostName: host.name,
            vmResourceId: host.vmResourceId,
            scriptId: selected.id,
          })
        }
        renderResult={(job) => <ScriptResultView result={job.result as unknown as ScriptRunResult | null} error={job.error} />}
        onClose={onClose}
        onCompleted={() => queryClient.invalidateQueries({ queryKey: ['jobs'] })}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="run-script-title">
        <div className="border-b px-4 py-3">
          <h2 id="run-script-title" className="font-medium">
            Skript auf {host.name} ausfuehren
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Bibliotheksskripte, als SYSTEM ueber Azure Run Command. Kein Freitext.</p>
        </div>
        <div className="max-h-[60vh] overflow-auto p-4">
          {library.isLoading && <LoadingTable rows={3} />}
          {library.error && <ErrorState error={library.error as Error} onRetry={library.refetch} />}
          {library.data && (
            <ul className="space-y-2">
              {library.data.items.map((script) => (
                <li key={script.id}>
                  <button
                    onClick={() => setSelected(script)}
                    className="w-full rounded-md border px-3 py-2 text-left hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{script.displayName}</span>
                      <span className={clsx('rounded-full px-2 py-0.5 text-xs', script.hasRemediation ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground')}>
                        {script.hasRemediation ? 'Veraendert den Host' : 'Nur lesend'}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{script.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end border-t px-4 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
