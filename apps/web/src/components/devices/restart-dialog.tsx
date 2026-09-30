'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import type { Device, Job } from '@zerostress/types';

const DEADLINES = [
  { minutes: 60, label: '1 Std' },
  { minutes: 240, label: '4 Std' },
  { minutes: 480, label: '8 Std' },
  { minutes: 1440, label: '24 Std' },
];
const DEFERRALS = [0, 1, 2, 3, 5];
const DEFER_MINUTES = [30, 60, 120, 240];
const DEFAULT_MESSAGE = 'Ihr Geraet muss neu gestartet werden, damit Updates wirksam werden. Bitte speichern Sie Ihre Arbeit.';

const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

interface RestartDialogProps {
  tenantId: string;
  device: Device;
  mode: 'schedule' | 'cancel';
  onClose: () => void;
  onCompleted: () => void;
}

/**
 * Neustart mit Vorwarnung: Frist, Verschiebungen und Text festlegen. Der Job
 * legt die Aufgaben auf dem Geraet an; der Benutzer entscheidet bis zur Frist.
 */
export function RestartDialog({ tenantId, device, mode, onClose, onCompleted }: RestartDialogProps) {
  const [deadlineMinutes, setDeadlineMinutes] = useState(240);
  const [maxDeferrals, setMaxDeferrals] = useState(2);
  const [deferMinutes, setDeferMinutes] = useState(60);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitted) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitted]);

  const managedDeviceId = device.intune?.managedDeviceId;
  const valid = !!managedDeviceId && reason.trim().length >= 10 && (mode === 'cancel' || message.trim().length >= 5);

  if (submitted && managedDeviceId) {
    return (
      <JobActionDialog
        title={mode === 'schedule' ? `Neustart planen: ${device.name}` : `Geplanten Neustart abbrechen: ${device.name}`}
        description={mode === 'schedule' ? `Spaetestens in ${deadlineMinutes / 60} Stunden, ${maxDeferrals} Verschiebungen zu je ${deferMinutes} Minuten.` : 'Entfernt die geplanten Aufgaben auf dem Geraet.'}
        confirmLabel={mode === 'schedule' ? 'Neustart planen' : 'Abbrechen bestaetigen'}
        tone={mode === 'schedule' ? 'destructive' : 'default'}
        createJob={() =>
          api.post<Job>(`/tenants/${tenantId}/jobs/${mode === 'schedule' ? 'restart-prompt' : 'restart-cancel'}`, {
            managedDeviceId,
            deviceName: device.name,
            ...(mode === 'schedule' ? { deadlineMinutes, maxDeferrals, deferMinutes, message: message.trim() } : {}),
            reason: reason.trim(),
          })
        }
        renderResult={(job) => {
          const r = job.result as { deadlineAt?: string | null; userSessionPresent?: boolean; hadRequest?: boolean; tasksRemoved?: number } | null;
          if (mode === 'cancel') return <p className="text-sm">{r?.hadRequest ? `Geplanter Neustart entfernt (${r.tasksRemoved ?? 0} Aufgaben).` : 'Es war kein Neustart geplant; eventuelle Reste wurden aufgeraeumt.'}</p>;
          return (
            <p className="text-sm">
              Neustart spaetestens {r?.deadlineAt ? new Date(r.deadlineAt).toLocaleString('de-DE') : 'zur Frist'}.{' '}
              {r?.userSessionPresent ? 'Der angemeldete Benutzer sieht den Dialog jetzt.' : 'Niemand ist angemeldet; der Dialog erscheint bei der naechsten Anmeldung, die Frist laeuft.'}
            </p>
          );
        }}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="restart-title">
        <div className="border-b px-4 py-3">
          <h2 id="restart-title" className="font-medium">
            {mode === 'schedule' ? 'Neustart mit Vorwarnung planen' : 'Geplanten Neustart abbrechen'}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mode === 'schedule'
              ? 'Der Benutzer bekommt einen Dialog mit "Jetzt neu starten" und "Spaeter". Zur Frist startet das Geraet auf jeden Fall neu, ausser es wurde vorher neu gestartet.'
              : 'Entfernt Dialog, Frist und Countdown auf dem Geraet.'}
          </p>
        </div>
        <div className="space-y-3 p-4">
          {mode === 'schedule' && (
            <>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">Spaetestens in</legend>
                <div className="flex flex-wrap gap-2">
                  {DEADLINES.map((d) => (
                    <button key={d.minutes} onClick={() => setDeadlineMinutes(d.minutes)} aria-pressed={deadlineMinutes === d.minutes} className={deadlineMinutes === d.minutes ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary' : 'rounded-full border px-3 py-1 text-xs hover:bg-accent'}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-3 sm:grid-cols-2">
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">Verschiebungen</legend>
                  <div className="flex flex-wrap gap-2">
                    {DEFERRALS.map((n) => (
                      <button key={n} onClick={() => setMaxDeferrals(n)} aria-pressed={maxDeferrals === n} className={maxDeferrals === n ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary' : 'rounded-full border px-3 py-1 text-xs hover:bg-accent'}>
                        {n === 0 ? 'keine' : `${n} x`}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">Je Verschiebung</legend>
                  <div className="flex flex-wrap gap-2">
                    {DEFER_MINUTES.map((m) => (
                      <button key={m} onClick={() => setDeferMinutes(m)} aria-pressed={deferMinutes === m} className={deferMinutes === m ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary' : 'rounded-full border px-3 py-1 text-xs hover:bg-accent'}>
                        {m < 60 ? `${m} Min` : `${m / 60} Std`}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div>
                <label htmlFor="restart-message" className="mb-1 block text-sm font-medium">
                  Text fuer den Benutzer
                </label>
                <textarea id="restart-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={300} className={inputClass} />
              </div>
            </>
          )}
          <div>
            <label htmlFor="restart-reason" className="mb-1 block text-sm font-medium">
              Begruendung (wird im Audit-Log gespeichert)
            </label>
            <textarea id="restart-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="z. B. Ticket #4711: Neustart nach Treiberupdate" className={inputClass} autoFocus />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button onClick={() => setSubmitted(true)} disabled={!valid} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
            Weiter zur Vorschau
          </button>
        </div>
      </div>
    </div>
  );
}
