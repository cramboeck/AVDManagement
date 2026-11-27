'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState, ErrorBanner } from '@/components/ui/error-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import clsx from 'clsx';
import type { Job, JobStatus } from '@zerostress/types';

interface JobsResponse {
  items: Job[];
  nextPageToken: string | null;
}

const statusLabels: Record<JobStatus, string> = {
  pending_approval: 'Warte auf Freigabe',
  pending_second_approval: 'Zweite Freigabe noetig',
  queued: 'In Warteschlange',
  running: 'Laeuft',
  completed: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

const statusColors: Record<JobStatus, string> = {
  pending_approval: 'bg-warning/10 text-warning',
  pending_second_approval: 'bg-warning/10 text-warning',
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-primary/10 text-primary',
  completed: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

interface HealthResponse {
  status: 'ok' | 'degraded';
  jobs: { redis: string; worker: boolean };
}

export default function JobsPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [approveError, setApproveError] = useState<Error | null>(null);

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthResponse>('/health'),
    refetchInterval: 15000,
  });

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['jobs', activeTenant?.id],
    queryFn: () =>
      api.get<JobsResponse>(`/tenants/${activeTenant!.id}/jobs`),
    enabled: !!activeTenant,
    // Nur nachfragen, solange etwas laeuft oder auf Freigabe wartet
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      if (items.some((j) => j.status === 'queued' || j.status === 'running')) return 3000;
      if (items.some((j) => j.status === 'pending_approval' || j.status === 'pending_second_approval')) return 15000;
      return 60000;
    },
    refetchIntervalInBackground: false,
  });

  // Link aus einem Toast (/jobs?job=<id>): den Job nach dem Laden auswaehlen
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current || !data?.items.length) return;
    const wanted = new URLSearchParams(window.location.search).get('job');
    if (!wanted) return;
    openedFromLink.current = true;
    const job = data.items.find((j) => j.id === wanted);
    if (job) setSelectedJob(job);
  }, [data]);

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => api.post<Job>(`/tenants/${activeTenant!.id}/jobs/${jobId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs', activeTenant?.id] });
      setSelectedJob(null);
      setApproveError(null);
    },
    onError: (err: Error) => setApproveError(err),
  });

  const approveMutation = useMutation({
    mutationFn: (jobId: string) =>
      api.post<Job>(`/tenants/${activeTenant!.id}/jobs/${jobId}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs', activeTenant?.id] });
      setSelectedJob(null);
      setApproveError(null);
    },
    onError: (err: Error) => {
      setApproveError(err);
      // Abgelaufene Vorschau wurde von der API neu erzeugt: Liste und Auswahl aktualisieren
      queryClient.invalidateQueries({ queryKey: ['jobs', activeTenant?.id] });
    },
  });

  // Ausgewaehlten Job mit der aktuellen Liste synchron halten (Status, Vorschau)
  useEffect(() => {
    if (!selectedJob || !data?.items) return;
    const fresh = data.items.find((j) => j.id === selectedJob.id);
    if (fresh && fresh !== selectedJob) setSelectedJob(fresh);
  }, [data, selectedJob]);

  if (tenantLoading) {
    return <LoadingTable />;
  }

  if (!activeTenant) {
    return <NoTenantSelected />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Jobs</h1>
      </div>

      {healthQuery.data && healthQuery.data.status !== 'ok' && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm" role="alert">
          <p className="font-medium">Job-Worker nicht betriebsbereit</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Redis: {healthQuery.data.jobs.redis}, Worker: {healthQuery.data.jobs.worker ? 'laeuft' : 'gestoppt'}.
            Freigegebene Jobs bleiben in der Warteschlange, bis Redis erreichbar ist (lokal: <span className="font-mono">docker-compose up -d</span>).
          </p>
        </div>
      )}

      <ErrorBanner error={approveError} onDismiss={() => setApproveError(null)} />

      {isLoading ? (
        <LoadingTable rows={5} />
      ) : error ? (
        <ErrorState error={error as Error} onRetry={refetch} />
      ) : !data?.items.length ? (
        <EmptyState
          icon={<JobsEmptyIcon className="h-6 w-6" />}
          title="Keine Jobs"
          description="Es sind aktuell keine Jobs fuer diesen Tenant vorhanden."
        />
      ) : (
        <DataTable
          rows={data.items}
          columns={jobColumns}
          getRowId={(job) => job.id}
          storageKey="jobs"
          initialSort={{ columnId: 'createdAt', direction: 'desc' }}
          searchPlaceholder="Typ, Ziel, Ersteller..."
          onRowClick={setSelectedJob}
          rowClassName={(job) => (selectedJob?.id === job.id ? 'bg-accent' : undefined)}
          exportFileName="jobs"
        />
      )}

      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onApprove={() => approveMutation.mutate(selectedJob.id)}
          isApproving={approveMutation.isPending}
          onCancelJob={() => cancelMutation.mutate(selectedJob.id)}
          isCancelling={cancelMutation.isPending}
        />
      )}
    </div>
  );
}

const jobColumns: ColumnDef<Job>[] = [
  { id: 'type', header: 'Typ', accessor: (job) => job.type, className: 'font-mono text-xs' },
  {
    id: 'target',
    header: 'Ziel',
    accessor: (job) => (typeof job.payload.targetDisplayName === 'string' ? job.payload.targetDisplayName : null),
    cell: (job) => (
      <span className="text-muted-foreground">
        {typeof job.payload.targetDisplayName === 'string' ? job.payload.targetDisplayName : `${job.targetCount} Objekte`}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    accessor: (job) => statusLabels[job.status],
    filterOptions: (Object.keys(statusLabels) as JobStatus[]).map((s) => ({ value: statusLabels[s], label: statusLabels[s] })),
    cell: (job) => (
      <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', statusColors[job.status])}>{statusLabels[job.status]}</span>
    ),
  },
  {
    id: 'createdAt',
    header: 'Erstellt',
    accessor: (job) => new Date(job.createdAt),
    cell: (job) => <span className="text-muted-foreground">{formatDate(job.createdAt)}</span>,
  },
  {
    id: 'completedAt',
    header: 'Abgeschlossen',
    accessor: (job) => (job.completedAt ? new Date(job.completedAt) : null),
    cell: (job) => <span className="text-muted-foreground">{job.completedAt ? formatDate(job.completedAt) : '—'}</span>,
    defaultHidden: true,
  },
  { id: 'createdBy', header: 'Erstellt von', accessor: (job) => job.createdByEmail || null, className: 'text-muted-foreground' },
  { id: 'error', header: 'Fehler', accessor: (job) => job.error, defaultHidden: true, className: 'max-w-xs truncate text-xs text-destructive' },
];

function JobDetailPanel({
  job,
  onClose,
  onApprove,
  isApproving,
  onCancelJob,
  isCancelling,
}: {
  job: Job;
  onClose: () => void;
  onApprove: () => void;
  isApproving: boolean;
  onCancelJob: () => void;
  isCancelling: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Fokus in den Bereich, Escape schliesst
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const cancellable = job.status === 'pending_approval' || job.status === 'pending_second_approval' || job.status === 'queued';

  return (
    <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="job-detail-title" className="fixed inset-y-0 right-0 z-40 w-96 overflow-y-auto border-l bg-background shadow-lg focus:outline-none">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <h2 id="job-detail-title" className="font-medium">Job Details</h2>
        <button
          onClick={onClose}
          className="rounded p-1 hover:bg-accent"
          aria-label="Schliessen"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p className="text-xs text-muted-foreground">Typ</p>
          <p className="font-medium">{job.type}</p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <span
            className={clsx(
              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
              statusColors[job.status]
            )}
          >
            {statusLabels[job.status]}
          </span>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Zielobjekte</p>
          <p>{job.targetCount}</p>
        </div>

        {job.preview && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Vorschau</p>
            {job.preview.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                {job.preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <ul className="max-h-64 space-y-2 overflow-auto text-xs">
              {job.preview.changes.map((change, i) => (
                <li key={`${change.objectId}-${i}`} className="rounded-md border p-2">
                  <p className="font-medium">{change.objectDisplayName}</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                    {Array.from(new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])).map((key) => (
                      <PreviewDiffRow key={key} name={key} before={(change.before ?? {})[key]} after={(change.after ?? {})[key]} />
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(job.secondApproval?.required || (job.approvals?.length ?? 0) > 0) && (
          <div className="rounded-md border px-3 py-2 text-xs">
            <p className="font-medium">{job.secondApproval?.required ? 'Vier-Augen-Prinzip' : 'Freigabe'}</p>
            {job.secondApproval?.reason && <p className="text-muted-foreground">{job.secondApproval.reason}</p>}
            {(job.approvals ?? []).map((a, i) => (
              <p key={`${a.userId}-${i}`} className="text-muted-foreground">
                {i + 1}. Freigabe: {a.email || a.userId} am {new Date(a.at).toLocaleString('de-DE')}
              </p>
            ))}
            {job.status === 'pending_second_approval' && <p className="mt-1 text-warning">Die zweite Freigabe muss von einer anderen Person kommen als der ersten.</p>}
          </div>
        )}

        {(job.status === 'pending_approval' || job.status === 'pending_second_approval') && (
          <div className="flex gap-2 pt-4">
            <button
              onClick={onApprove}
              disabled={isApproving}
              className={clsx(
                'flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                isApproving && 'cursor-not-allowed opacity-50'
              )}
            >
              {isApproving ? 'Wird freigegeben...' : job.status === 'pending_second_approval' ? 'Zweite Freigabe erteilen' : 'Freigeben'}
            </button>
            <button
              onClick={onClose}
              className={clsx(
                'rounded-md border px-4 py-2 text-sm',
                'hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
              )}
            >
              Schliessen
            </button>
          </div>
        )}

        {cancellable && (
          <div className="border-t pt-3">
            {confirmCancel ? (
              <div className="flex items-center gap-2 text-sm">
                <span>Job wirklich abbrechen?</span>
                <button
                  onClick={onCancelJob}
                  disabled={isCancelling}
                  className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-white hover:bg-destructive/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:opacity-50"
                >
                  {isCancelling ? 'Breche ab...' : 'Ja, abbrechen'}
                </button>
                <button onClick={() => setConfirmCancel(false)} className="rounded-md border px-3 py-1 text-xs hover:bg-accent">
                  Nein
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmCancel(true)}
                className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              >
                Job abbrechen
              </button>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Abbrechen geht, solange der Job wartet; ein laufender Job laeuft zu Ende.</p>
          </div>
        )}

        {job.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
            <p className="text-xs font-medium text-destructive">Fehler</p>
            <p className="mt-1 text-sm">{job.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';
  if (Array.isArray(value)) return value.length ? value.map((v) => formatValue(v)).join(', ') : '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function PreviewDiffRow({ name, before, after }: { name: string; before: unknown; after: unknown }) {
  const changed = formatValue(before) !== formatValue(after);
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd>
        {changed ? (
          <>
            <span className="text-muted-foreground line-through">{formatValue(before)}</span> <span aria-hidden="true">{'->'}</span> <span className="font-medium">{formatValue(after)}</span>
          </>
        ) : (
          formatValue(after)
        )}
      </dd>
    </>
  );
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

function JobsEmptyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
