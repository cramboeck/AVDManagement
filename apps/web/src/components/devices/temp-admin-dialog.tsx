'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import type { Device, Job } from '@zerostress/types';

const durations = [15, 30, 60, 120, 240];

interface TempAdminDialogProps {
  tenantId: string;
  device: Device;
  mode: 'grant' | 'revoke';
  onClose: () => void;
  onCompleted: () => void;
}

/**
 * Admin auf Zeit: Konto, Dauer und Begruendung erfassen; Preview und
 * Ausfuehrung uebernimmt der Job. Der Rueckbau laeuft auf dem Geraet.
 */
export function TempAdminDialog({ tenantId, device, mode, onClose, onCompleted }: TempAdminDialogProps) {
  const [account, setAccount] = useState(device.primaryUser ? `AzureAD\\${device.primaryUser}` : '');
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const accountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    accountRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitted) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitted]);

  const managedDeviceId = device.intune?.managedDeviceId;
  const valid = !!managedDeviceId && account.trim().length > 0 && reason.trim().length >= 10;

  if (submitted && managedDeviceId) {
    return (
      <JobActionDialog
        title={mode === 'grant' ? `Admin auf Zeit fuer ${account}` : `Adminrechte entziehen: ${account}`}
        description={mode === 'grant' ? `${minutes} Minuten auf ${device.name}. Der Rueckbau laeuft als geplante Aufgabe auf dem Geraet.` : `Sofort auf ${device.name}.`}
        confirmLabel={mode === 'grant' ? 'Rechte gewaehren' : 'Rechte entziehen'}
        tone="destructive"
        createJob={() =>
          api.post<Job>(`/tenants/${tenantId}/jobs/${mode === 'grant' ? 'temp-admin' : 'temp-admin-revoke'}`, {
            managedDeviceId,
            deviceName: device.name,
            account: account.trim(),
            ...(mode === 'grant' ? { minutes } : {}),
            reason: reason.trim(),
          })
        }
        renderResult={(job) => {
          const r = job.result as { expiresAt?: string | null; account?: string } | null;
          return (
            <p className="text-sm">
              {mode === 'grant' && r?.expiresAt ? (
                <>
                  <strong>{r.account}</strong> ist Administrator bis {new Date(r.expiresAt).toLocaleString('de-DE')}. Danach entfernt das Geraet die Rechte selbst.
                </>
              ) : mode === 'grant' ? (
                'Rechte gewaehrt.'
              ) : (
                <>
                  <strong>{r?.account ?? account}</strong> hat keine Administratorrechte mehr.
                </>
              )}
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
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="temp-admin-title">
        <div className="border-b px-4 py-3">
          <h2 id="temp-admin-title" className="font-medium">
            {mode === 'grant' ? 'Admin auf Zeit gewaehren' : 'Adminrechte entziehen'}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mode === 'grant'
              ? 'Das Konto kommt befristet in die lokale Gruppe Administratoren. Eine geplante Aufgabe auf dem Geraet entfernt es nach Ablauf, auch nach Neustart.'
              : 'Entfernt das Konto sofort aus der Gruppe Administratoren und loescht die geplante Rueckbau-Aufgabe.'}
          </p>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label htmlFor="temp-admin-account" className="mb-1 block text-sm font-medium">
              Konto
            </label>
            <input
              ref={accountRef}
              id="temp-admin-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="AzureAD\\name@domain oder lokaler Kontoname"
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">Entra-Konten als AzureAD\Benutzer@domain, lokale Konten mit Namen, notfalls die SID.</p>
          </div>
          {mode === 'grant' && (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Dauer</legend>
              <div className="flex flex-wrap gap-2">
                {durations.map((d) => (
                  <button key={d} onClick={() => setMinutes(d)} aria-pressed={minutes === d} className={minutes === d ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary' : 'rounded-full border px-3 py-1 text-xs hover:bg-accent'}>
                    {d < 60 ? `${d} Min` : `${d / 60} Std`}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div>
            <label htmlFor="temp-admin-reason" className="mb-1 block text-sm font-medium">
              Begruendung (wird im Audit-Log gespeichert)
            </label>
            <textarea id="temp-admin-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="z. B. Ticket #4711: Druckertreiber-Installation durch Benutzer" className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
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
