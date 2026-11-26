'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ErrorBanner } from '@/components/ui/error-state';
import type { ManagedTenant, TenantAccessMode } from '@zerostress/types';

/**
 * Nur-Lese-Betrieb je Tenant umschalten. Lokale Einstellung der Konsole mit
 * Begruendung und Audit-Eintrag; im Kundentenant aendert sich nichts.
 */
export function AccessModeDialog({ tenant, onClose, onChanged }: { tenant: ManagedTenant; onClose: () => void; onChanged: (tenant: ManagedTenant) => void }) {
  const target: TenantAccessMode = tenant.accessMode === 'read-only' ? 'full' : 'read-only';
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const change = useMutation({
    mutationFn: () => api.patch<ManagedTenant>(`/tenants/${tenant.id}/access-mode`, { mode: target, reason: reason.trim() }),
    onSuccess: onChanged,
  });
  const valid = reason.trim().length >= 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="access-mode-title">
        <div className="border-b px-4 py-3">
          <h2 id="access-mode-title" className="font-medium">
            {target === 'read-only' ? 'Auf Nur-Lesen stellen' : 'Aenderungen wieder erlauben'}
          </h2>
        </div>
        <div className="space-y-3 p-4">
          <ErrorBanner error={change.error as Error | null} onDismiss={() => change.reset()} />
          {target === 'read-only' ? (
            <p className="text-sm">
              Fuer <strong>{tenant.displayName}</strong> legt die Konsole keine schreibenden Jobs mehr an; bereits wartende Jobs werden beim
              Ausfuehren abgelehnt. Zuruecknehmen (Admin auf Zeit entziehen, Monitor ausschalten) bleibt moeglich.
            </p>
          ) : (
            <p className="text-sm">
              Fuer <strong>{tenant.displayName}</strong> sind danach wieder alle Aktionen moeglich, jeweils mit Vorschau und Freigabe.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Die Sperre wirkt in der Konsole. Die App-Registrierung behaelt ihre Berechtigungen im Kundentenant; fuer eine Sperre auch bei Microsoft
            siehe Setup-Doku, Abschnitt Nur-Lese-Betrieb.
          </p>
          <label htmlFor="access-mode-reason" className="block text-sm font-medium">
            Begruendung (mindestens 10 Zeichen, steht im Audit)
          </label>
          <textarea
            ref={inputRef}
            id="access-mode-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Abbrechen
          </button>
          <button
            onClick={() => change.mutate()}
            disabled={!valid || change.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {change.isPending ? 'Speichere...' : target === 'read-only' ? 'Nur-Lesen einschalten' : 'Aenderungen erlauben'}
          </button>
        </div>
      </div>
    </div>
  );
}
