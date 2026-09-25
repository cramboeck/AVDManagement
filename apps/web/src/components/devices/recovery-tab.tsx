'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingTable, LoadingSpinner } from '@/components/ui/loading';
import { ErrorState, ErrorBanner } from '@/components/ui/error-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { formatDateTime } from '@/components/identity/sign-in-table';
import type {
  BitLockerKeyMetadata,
  CapabilityResult,
  DeviceRecoveryMetadata,
  RevealedBitLockerKey,
  RevealedLaps,
} from '@zerostress/types';

const REVEAL_SECONDS = 60;

const volumeLabels: Record<BitLockerKeyMetadata['volumeType'], string> = {
  operatingSystemVolume: 'Systemlaufwerk',
  fixedDataVolume: 'Datenlaufwerk',
  removableDataVolume: 'Wechseldatentraeger',
  unknown: 'Unbekannt',
};

type RevealTarget = { kind: 'bitlocker'; key: BitLockerKeyMetadata } | { kind: 'laps' };

export function RecoveryTab({ base, tenantId, deviceId }: { base: string; tenantId: string; deviceId: string }) {
  const [target, setTarget] = useState<RevealTarget | null>(null);

  const query = useQuery({
    queryKey: ['device-recovery', tenantId, deviceId],
    queryFn: () => api.get<DeviceRecoveryMetadata>(`${base}/recovery`),
    staleTime: 5 * 60 * 1000,
  });

  if (query.isLoading) return <LoadingTable rows={3} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const metadata = query.data;
  if (!metadata) return null;

  return (
    <div className="space-y-6">
      <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
        Schluessel werden nur nach Begruendung angezeigt, jeder Abruf wird mit Begruendung im Audit-Log festgehalten, die Anzeige
        erlischt nach {REVEAL_SECONDS} Sekunden. Es gibt keinen Export.
      </p>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">BitLocker-Wiederherstellungsschluessel</h2>
        <Unavailable what="BitLocker-Schluessel" result={metadata.bitlocker} />
        {metadata.bitlocker.available &&
          (metadata.bitlocker.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Fuer dieses Geraet ist kein Schluessel in Entra hinterlegt.</p>
          ) : (
            <ul className="divide-y">
              {metadata.bitlocker.data.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-sm font-medium">{volumeLabels[key.volumeType]}</p>
                    <p className="text-xs text-muted-foreground">
                      Hinterlegt {formatDateTime(key.createdAt)} · Schluessel-ID <span className="font-mono">{key.id.slice(0, 8)}…</span>
                    </p>
                  </div>
                  <button onClick={() => setTarget({ kind: 'bitlocker', key })} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                    Schluessel anzeigen
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Windows LAPS (lokales Administratorpasswort)</h2>
        <Unavailable what="LAPS-Passwoerter" result={metadata.laps} />
        {metadata.laps.available && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm">{metadata.laps.data.deviceName ?? 'Geraet'}</p>
              <p className="text-xs text-muted-foreground">
                Letzte Sicherung {metadata.laps.data.lastBackupAt ? formatDateTime(metadata.laps.data.lastBackupAt) : '—'}
                {metadata.laps.data.refreshAt && <> · Naechste Rotation {formatDateTime(metadata.laps.data.refreshAt)}</>}
              </p>
            </div>
            <button onClick={() => setTarget({ kind: 'laps' })} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Passwort anzeigen
            </button>
          </div>
        )}
      </section>

      {target && <RevealDialog base={base} target={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function Unavailable<T>({ what, result }: { what: string; result: CapabilityResult<T> }) {
  if (result.available) return null;
  if (result.reason === 'not-onboarded' && result.detail === 'Device has no Entra device id') {
    return <p className="text-sm text-muted-foreground">Dieses Geraet hat keine Entra-Geraete-ID; Schluessel werden pro Entra-Geraeteobjekt gespeichert.</p>;
  }
  return <CapabilityNotice what={what} reason={result.reason} missingPermission={result.missingPermission} detail={result.detail} compact />;
}

interface Secret {
  label: string;
  value: string;
  hint?: string;
}

function RevealDialog({ base, target, onClose }: { base: string; target: RevealTarget; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_SECONDS);
  const [error, setError] = useState<Error | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Anzeige erlischt automatisch; danach braucht es eine neue Begruendung
  useEffect(() => {
    if (!secrets) return;
    setSecondsLeft(REVEAL_SECONDS);
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          setSecrets(null);
          setReason('');
          return REVEAL_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [secrets]);

  const reveal = useMutation({
    mutationFn: async () => {
      if (target.kind === 'bitlocker') {
        const r = await api.post<RevealedBitLockerKey>(`${base}/recovery/bitlocker/${encodeURIComponent(target.key.id)}/reveal`, { reason });
        return [{ label: `BitLocker · ${volumeLabels[r.volumeType]}`, value: r.key }];
      }
      const r = await api.post<RevealedLaps>(`${base}/recovery/laps/reveal`, { reason });
      return r.credentials.map((c) => ({
        label: `Konto ${c.accountName}`,
        value: c.password,
        hint: c.backupAt ? `gesichert ${formatDateTime(c.backupAt)}` : undefined,
      }));
    },
    onSuccess: (list) => {
      setError(null);
      setSecrets(list);
    },
    onError: (err: Error) => setError(err),
  });

  const title = target.kind === 'bitlocker' ? 'BitLocker-Schluessel anzeigen' : 'LAPS-Passwort anzeigen';
  const reasonValid = reason.trim().length >= 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="reveal-title">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="reveal-title" className="font-medium">
            {title}
          </h2>
          {secrets && (
            <span className={clsx('text-xs tabular-nums', secondsLeft <= 10 ? 'text-destructive' : 'text-muted-foreground')} aria-live="polite">
              erlischt in {secondsLeft} s
            </span>
          )}
        </div>

        <div className="space-y-4 p-4">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          {!secrets ? (
            <>
              <label htmlFor="reveal-reason" className="block text-sm font-medium">
                Begruendung (wird im Audit-Log gespeichert)
              </label>
              <textarea
                ref={reasonRef}
                id="reveal-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="z. B. Ticket #4711: Geraet startet nach Firmware-Update in die Wiederherstellung"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <p className="text-xs text-muted-foreground">Mindestens 10 Zeichen. Wer, wann, welches Geraet und diese Begruendung werden protokolliert — der Schluessel selbst nie.</p>
            </>
          ) : (
            <ul className="space-y-3">
              {secrets.map((s) => (
                <li key={s.label}>
                  <p className="text-xs text-muted-foreground">
                    {s.label}
                    {s.hint && <> · {s.hint}</>}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">{s.value}</code>
                    <CopyButton value={s.value} />
                  </div>
                </li>
              ))}
              {secrets.length === 0 && <li className="text-sm text-muted-foreground">Kein Geheimnis hinterlegt.</li>}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Schliessen
          </button>
          {!secrets && (
            <button
              onClick={() => reveal.mutate()}
              disabled={!reasonValid || reveal.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reveal.isPending && <LoadingSpinner size="sm" className="text-primary-foreground" />}
              Anzeigen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
    >
      {copied ? 'Kopiert' : 'Kopieren'}
    </button>
  );
}
