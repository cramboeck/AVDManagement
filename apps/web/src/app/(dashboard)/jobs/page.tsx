'use client';

import { useState } from 'react';
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
  queued: 'In Warteschlange',
  running: 'Laeuft',
  completed: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

const statusColors: Record<JobStatus, string> = {
  pending_approval: 'bg-warning/10 text-warning',
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
    refetchInterval: 5000,
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
    },
  });

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
}: {
  job: Job;
  onClose: () => void;
  onApprove: () => void;
  isApproving: boolean;
}) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-96 border-l bg-background shadow-lg">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <h2 className="font-medium">Job Details</h2>
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
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Vorschau</p>
            <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(job.preview, null, 2)}
            </pre>
          </div>
        )}

        {job.status === 'pending_approval' && (
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
              {isApproving ? 'Wird freigegeben...' : 'Freigeben'}
            </button>
            <button
              onClick={onClose}
              className={clsx(
                'rounded-md border px-4 py-2 text-sm',
                'hover:bg-accent'
              )}
            >
              Abbrechen
            </button>
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
