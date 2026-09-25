'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { ErrorBanner } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import type { RevealedScriptResult, ScriptRunResult } from '@zerostress/types';

// Klartext bleibt nur begrenzt sichtbar; danach braucht es eine neue Begruendung
const REVEAL_SECONDS = 600;

interface SealedResultProps {
  tenantId: string;
  jobId: string;
  result: ScriptRunResult;
  render: (revealed: ScriptRunResult) => React.ReactNode;
}

/**
 * Versiegeltes Ergebnis: Hinweis, Knopf, Dialog mit Begruendung, Anzeige mit Ablauf.
 */
export function SealedResult({ tenantId, jobId, result, render }: SealedResultProps) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<RevealedScriptResult | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(REVEAL_SECONDS);

  useEffect(() => {
    if (!revealed) return;
    setSecondsLeft(REVEAL_SECONDS);
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          setRevealed(null);
          return REVEAL_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [revealed]);

  if (result.purged) {
    return <p className="text-sm text-muted-foreground">Der Klartext dieses Ergebnisses wurde nach 30 Tagen geloescht; Metadaten sind erhalten.</p>;
  }

  if (revealed) {
    return (
      <div className="space-y-2">
        <p className={clsx('text-xs tabular-nums', secondsLeft <= 60 ? 'text-destructive' : 'text-muted-foreground')} aria-live="polite">
          Personenbezogenes Ergebnis, Anzeige erlischt in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} Minuten. Dieser Blick steht im Audit-Log.
        </p>
        {render({ ...result, ...revealed, sealed: false })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2">
      <p className="text-sm text-muted-foreground">Ergebnis enthaelt Kontonamen und liegt verschluesselt vor. Anzeige nur mit Begruendung, Rolle Engineer und Audit-Eintrag.</p>
      <button onClick={() => setOpen(true)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
        Anzeigen
      </button>
      {open && (
        <RevealDialog
          tenantId={tenantId}
          jobId={jobId}
          onClose={() => setOpen(false)}
          onRevealed={(r) => {
            setRevealed(r);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function RevealDialog({ tenantId, jobId, onClose, onRevealed }: { tenantId: string; jobId: string; onClose: () => void; onRevealed: (r: RevealedScriptResult) => void }) {
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

  const reveal = useMutation({
    mutationFn: () => api.post<RevealedScriptResult>(`/tenants/${tenantId}/jobs/${jobId}/reveal`, { reason }),
    onSuccess: onRevealed,
  });

  const valid = reason.trim().length >= 10;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="reveal-result-title">
        <div className="border-b px-4 py-3">
          <h2 id="reveal-result-title" className="font-medium">
            Personenbezogenes Ergebnis anzeigen
          </h2>
        </div>
        <div className="space-y-3 p-4">
          <ErrorBanner error={reveal.error as Error | null} onDismiss={() => reveal.reset()} />
          <label htmlFor="reveal-result-reason" className="block text-sm font-medium">
            Begruendung (wird im Audit-Log gespeichert)
          </label>
          <textarea
            ref={reasonRef}
            id="reveal-result-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="z. B. Ticket #4711: Pruefung lokaler Administratoren nach Sicherheitsvorfall"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <p className="text-xs text-muted-foreground">Mindestens 10 Zeichen. Wer, wann, welcher Job und diese Begruendung werden protokolliert.</p>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button
            onClick={() => reveal.mutate()}
            disabled={!valid || reveal.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reveal.isPending && <LoadingSpinner size="sm" className="text-primary-foreground" />}
            Anzeigen
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Entra-Objekt-Id aus einer Entra-SID (S-1-12-1-a-b-c-d): vier 32-Bit-Zahlen ergeben die GUID.
 */
export function entraObjectIdFromSid(sid: string): string | null {
  const match = /^S-1-12-1-(\d+)-(\d+)-(\d+)-(\d+)$/.exec(sid);
  if (!match) return null;
  const parts = match.slice(1, 5).map((n) => Number(n) >>> 0);
  const hex = parts.map((n) => n.toString(16).padStart(8, '0'));
  // GUID-Bytefolge: erste Zahl little-endian als Data1, zweite als Data2+Data3, Rest als Data4
  const le = (h: string) => h.match(/../g)!.reverse().join('');
  const d1 = le(hex[0]);
  const d23 = le(hex[1]);
  const d4a = le(hex[2]);
  const d4b = le(hex[3]);
  return `${d1}-${d23.slice(0, 4)}-${d23.slice(4)}-${d4a.slice(0, 4)}-${d4a.slice(4)}${d4b}`;
}
