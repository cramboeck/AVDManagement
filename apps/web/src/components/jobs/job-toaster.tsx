'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useJobTracker, isActiveStatus, type TrackedJob } from '@/hooks/use-job-tracker';
import { LoadingSpinner } from '@/components/ui/loading';
import type { JobStatus } from '@zerostress/types';

const AUTO_HIDE_MS = 20 * 1000;

const statusText: Record<JobStatus, string> = {
  pending_approval: 'Wartet auf Freigabe',
  pending_second_approval: 'Wartet auf zweite Freigabe',
  queued: 'In Warteschlange',
  running: 'Laeuft',
  completed: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

function elapsed(from: number, to: number): string {
  const s = Math.max(0, Math.round((to - from) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${s % 60} s`;
}

/**
 * Hintergrund-Jobs oben rechts: Laufzeit waehrend der Ausfuehrung, Ergebnis
 * mit Link auf den Job danach. Erfolge blenden sich nach kurzer Zeit aus,
 * Fehler bleiben, bis sie geschlossen werden.
 */
export function JobToaster() {
  const { jobs, dismiss } = useJobTracker();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (jobs.length === 0) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [jobs.length]);

  useEffect(() => {
    const due = jobs.filter((j) => j.status === 'completed' && j.finishedAt !== null && now - j.finishedAt > AUTO_HIDE_MS);
    for (const j of due) dismiss(j.id);
  }, [jobs, now, dismiss]);

  if (jobs.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-40 flex w-80 flex-col gap-2" aria-live="polite" aria-label="Hintergrund-Jobs">
      {jobs.map((job) => (
        <Toast key={job.id} job={job} now={now} onDismiss={() => dismiss(job.id)} />
      ))}
    </div>
  );
}

function Toast({ job, now, onDismiss }: { job: TrackedJob; now: number; onDismiss: () => void }) {
  const active = isActiveStatus(job.status);
  const tone = job.status === 'completed' ? 'border-success/40 bg-success/10' : job.status === 'failed' ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-background';
  return (
    <div className={clsx('pointer-events-auto rounded-md border p-3 shadow-md', tone)} role={job.status === 'failed' ? 'alert' : 'status'}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {active ? (
            <LoadingSpinner size="sm" />
          ) : job.status === 'completed' ? (
            <span className="text-success" aria-hidden>
              &#10003;
            </span>
          ) : (
            <span className="text-destructive" aria-hidden>
              &#10007;
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={job.title}>
            {job.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {statusText[job.status]}
            {' · '}
            {active ? `seit ${elapsed(job.trackedAt, now)}` : job.finishedAt ? `nach ${elapsed(job.trackedAt, job.finishedAt)}` : ''}
          </p>
          {job.status === 'failed' && job.error && <p className="mt-1 break-words text-xs text-destructive">{job.error}</p>}
          {!active && (
            <Link href={`/jobs?job=${encodeURIComponent(job.id)}`} className="mt-1 inline-block text-xs underline hover:no-underline" onClick={onDismiss}>
              Job anzeigen
            </Link>
          )}
        </div>
        <button onClick={onDismiss} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Hinweis schliessen">
          &times;
        </button>
      </div>
    </div>
  );
}
