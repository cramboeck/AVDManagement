'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useTenant } from '@/hooks/use-tenant';
import { ErrorBanner } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import type { Job, PlannedChange } from '@zerostress/types';

interface JobActionDialogProps {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: 'default' | 'destructive';
  // Legt den Job an (oder liefert einen bereits angelegten); die Preview kommt vom Server
  createJob: () => Promise<Job>;
  renderResult?: (job: Job) => React.ReactNode;
  onClose: () => void;
  onCompleted?: (job: Job) => void;
}

type Phase = 'creating' | 'preview' | 'running' | 'done' | 'failed';

const actionLabels: Record<PlannedChange['action'], string> = {
  create: 'Anlegen',
  update: 'Aendern',
  delete: 'Entfernen',
};

export function JobActionDialog({
  title,
  description,
  confirmLabel = 'Bestaetigen',
  tone = 'default',
  createJob,
  renderResult,
  onClose,
  onCompleted,
}: JobActionDialogProps) {
  const { activeTenant } = useTenant();
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('creating');
  const [error, setError] = useState<Error | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // StrictMode fuehrt Effekte doppelt aus; es darf nur ein Job entstehen
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    createJob()
      .then((job) => {
        setJobId(job.id);
        setPhase(job.status === 'pending_approval' ? 'preview' : 'running');
      })
      .catch((err: Error) => {
        setError(err);
        setPhase('failed');
      });
  }, [createJob]);

  const jobQuery = useQuery({
    queryKey: ['job', activeTenant?.id, jobId],
    queryFn: () => api.get<Job>(`/tenants/${activeTenant!.id}/jobs/${jobId}`),
    enabled: !!activeTenant && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 1500 : false;
    },
  });

  const job = jobQuery.data;

  useEffect(() => {
    if (!job || completedRef.current) return;
    if (job.status === 'completed') {
      completedRef.current = true;
      setPhase('done');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      onCompleted?.(job);
    } else if (job.status === 'failed') {
      completedRef.current = true;
      setPhase('failed');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    } else if (job.status === 'cancelled') {
      completedRef.current = true;
      onClose();
    }
  }, [job, onCompleted, onClose, queryClient]);

  useEffect(() => {
    if (phase === 'preview') confirmRef.current?.focus();
  }, [phase]);

  const cancel = async () => {
    if (jobId && job?.status === 'pending_approval') {
      await api.post(`/tenants/${activeTenant!.id}/jobs/${jobId}/cancel`).catch(() => undefined);
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    }
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (phase === 'preview' || phase === 'failed' || phase === 'done') void cancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const approve = async () => {
    if (!jobId) return;
    setIsApproving(true);
    setError(null);
    try {
      await api.post(`/tenants/${activeTenant!.id}/jobs/${jobId}/approve`);
      setPhase('running');
      queryClient.invalidateQueries({ queryKey: ['job', activeTenant?.id, jobId] });
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsApproving(false);
    }
  };

  const preview = job?.preview;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-action-title"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="job-action-title" className="font-medium">
            {title}
          </h2>
          <PhaseBadge phase={phase} />
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          {phase === 'creating' && (
            <Centered>
              <LoadingSpinner size="md" />
              <p className="text-sm text-muted-foreground">Vorschau wird erstellt...</p>
            </Centered>
          )}

          {phase === 'preview' && (
            <>
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
              {preview ? (
                <PreviewChanges changes={preview.changes} warnings={preview.warnings} />
              ) : (
                <Centered>
                  <LoadingSpinner size="sm" />
                </Centered>
              )}
            </>
          )}

          {phase === 'running' && (
            <Centered>
              <LoadingSpinner size="md" />
              <p className="text-sm text-muted-foreground">
                {job?.status === 'queued' ? 'In Warteschlange...' : 'Wird ausgefuehrt...'}
              </p>
            </Centered>
          )}

          {phase === 'done' && job && (
            <div className="space-y-3">
              <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm" role="status">
                Erfolgreich ausgefuehrt.
              </div>
              {renderResult ? renderResult(job) : <ResultSummary job={job} />}
            </div>
          )}

          {phase === 'failed' && job?.error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm" role="alert">
              <p className="font-medium">Fehlgeschlagen</p>
              <p className="mt-1 break-words text-xs">{job.error}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          {phase === 'preview' && (
            <>
              <button onClick={cancel} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
                Abbrechen
              </button>
              <button
                ref={confirmRef}
                onClick={approve}
                disabled={isApproving || !preview}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  tone === 'destructive'
                    ? 'bg-destructive hover:bg-destructive/90'
                    : 'bg-primary hover:bg-primary/90'
                )}
              >
                {isApproving && <LoadingSpinner size="sm" className="text-white" />}
                {confirmLabel}
              </button>
            </>
          )}
          {(phase === 'done' || phase === 'failed') && (
            <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
              Schliessen
            </button>
          )}
          {(phase === 'creating' || phase === 'running') && (
            <span className="text-xs text-muted-foreground">
              {jobId ? `Job ${jobId.slice(0, 8)}` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function PreviewChanges({ changes, warnings }: { changes: PlannedChange[]; warnings: string[] }) {
  return (
    <div className="space-y-3">
      {changes.map((change) => {
        const keys = Array.from(
          new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])
        );
        return (
          <div key={`${change.objectType}:${change.objectId}`} className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{change.objectDisplayName}</p>
                <p className="text-xs text-muted-foreground">{change.objectType}</p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{actionLabels[change.action]}</span>
            </div>
            {keys.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-1 font-medium">Eigenschaft</th>
                    <th className="px-3 py-1 font-medium">Vorher</th>
                    <th className="px-3 py-1 font-medium">Nachher</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key} className="border-t">
                      <td className="px-3 py-1 font-mono">{key}</td>
                      <td className="px-3 py-1 text-muted-foreground">{formatValue(change.before?.[key])}</td>
                      <td className="px-3 py-1 font-medium">{formatValue(change.after?.[key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultSummary({ job }: { job: Job }) {
  if (!job.result) return null;
  const entries = Object.entries(job.result).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-muted-foreground">{key}</dt>
          <dd className="break-all">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const labels: Record<Phase, string> = {
    creating: 'Vorschau',
    preview: 'Vorschau',
    running: 'Laeuft',
    done: 'Abgeschlossen',
    failed: 'Fehlgeschlagen',
  };
  const colors: Record<Phase, string> = {
    creating: 'bg-muted text-muted-foreground',
    preview: 'bg-warning/10 text-warning',
    running: 'bg-primary/10 text-primary',
    done: 'bg-success/10 text-success',
    failed: 'bg-destructive/10 text-destructive',
  };
  return (
    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', colors[phase])}>{labels[phase]}</span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-3 py-6">{children}</div>;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map(formatValue).join(', ');
  return JSON.stringify(value);
}
