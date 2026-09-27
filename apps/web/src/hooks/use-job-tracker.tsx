'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Job, JobStatus } from '@zerostress/types';

/**
 * Verfolgt Jobs, die der Nutzer in den Hintergrund geschickt hat: fragt den
 * Status ab, meldet den Abschluss als Toast und, wenn der Tab nicht sichtbar
 * ist, als Browser-Benachrichtigung. Der Stand ueberlebt einen Seitenwechsel
 * (sessionStorage), nicht aber das Schliessen des Tabs.
 */

export interface TrackedJob {
  id: string;
  tenantId: string;
  title: string;
  status: JobStatus;
  error: string | null;
  // Zeitpunkt, ab dem die Konsole den Job beobachtet (fuer die Laufzeitanzeige)
  trackedAt: number;
  finishedAt: number | null;
}

interface JobTrackerValue {
  jobs: TrackedJob[];
  track: (input: { id: string; tenantId: string; title: string; status: JobStatus }) => void;
  dismiss: (id: string) => void;
}

const STORAGE_KEY = 'zsc.tracked-jobs';
const POLL_MS = 3000;
const ACTIVE: JobStatus[] = ['queued', 'running', 'pending_second_approval', 'pending_approval'];

const JobTrackerContext = createContext<JobTrackerValue | null>(null);

function load(): TrackedJob[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrackedJob[]).filter((j) => typeof j.id === 'string' && typeof j.tenantId === 'string') : [];
  } catch {
    return [];
  }
}

function save(jobs: TrackedJob[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // Speicher blockiert: die Anzeige lebt dann nur im aktuellen Seitenzustand
  }
}

export function isActiveStatus(status: JobStatus): boolean {
  return ACTIVE.includes(status);
}

function notifyBrowser(job: TrackedJob): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const body = job.status === 'completed' ? 'Erfolgreich abgeschlossen.' : job.status === 'failed' ? `Fehlgeschlagen: ${job.error ?? 'ohne Meldung'}` : 'Abgebrochen.';
    new Notification(`ZeroStress: ${job.title}`, { body, tag: `zsc-job-${job.id}` });
  } catch {
    // Benachrichtigung ist nur Komfort
  }
}

export function JobTrackerProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    setJobs(load());
  }, []);

  useEffect(() => {
    if (loaded.current) save(jobs);
  }, [jobs]);

  const track = useCallback<JobTrackerValue['track']>((input) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined);
    }
    setJobs((prev) => {
      if (prev.some((j) => j.id === input.id)) return prev;
      return [...prev, { id: input.id, tenantId: input.tenantId, title: input.title, status: input.status, error: null, trackedAt: Date.now(), finishedAt: null }];
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  // Ein Takt fuer alle aktiven Jobs; beendete bleiben bis zum Ausblenden stehen
  const active = useMemo(() => jobs.filter((j) => isActiveStatus(j.status)), [jobs]);
  useEffect(() => {
    if (active.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      const updates = await Promise.all(
        active.map(async (j) => {
          try {
            const fresh = await api.get<Job>(`/tenants/${j.tenantId}/jobs/${j.id}`);
            return { id: j.id, status: fresh.status, error: fresh.error ?? null };
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      // Nur echte Aenderungen uebernehmen, sonst startet der Takt bei jedem Durchlauf neu
      const changed = updates.filter((u): u is NonNullable<typeof u> => !!u && active.some((j) => j.id === u.id && j.status !== u.status));
      if (changed.length === 0) return;
      const now = Date.now();
      const finished: TrackedJob[] = [];
      setJobs((prev) =>
        prev.map((j) => {
          const u = changed.find((x) => x.id === j.id);
          if (!u) return j;
          return { ...j, status: u.status, error: u.error, finishedAt: isActiveStatus(u.status) ? null : now };
        })
      );
      for (const u of changed) {
        const j = active.find((x) => x.id === u.id);
        if (j && !isActiveStatus(u.status)) finished.push({ ...j, status: u.status, error: u.error, finishedAt: now });
      }
      if (finished.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['jobs'] });
        for (const f of finished) {
          queryClient.invalidateQueries({ queryKey: ['job', f.tenantId, f.id] });
          notifyBrowser(f);
        }
      }
    };
    void tick();
    const handle = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [active, queryClient]);

  const value = useMemo(() => ({ jobs, track, dismiss }), [jobs, track, dismiss]);
  return <JobTrackerContext.Provider value={value}>{children}</JobTrackerContext.Provider>;
}

export function useJobTracker(): JobTrackerValue {
  const ctx = useContext(JobTrackerContext);
  if (!ctx) throw new Error('useJobTracker must be used within JobTrackerProvider');
  return ctx;
}
