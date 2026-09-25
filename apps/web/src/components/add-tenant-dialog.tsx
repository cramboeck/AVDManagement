'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { ErrorBanner } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import type { ManagedTenant } from '@zerostress/types';

interface AddTenantDialogProps {
  onClose: () => void;
  onCreated: (tenant: ManagedTenant) => void;
}

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AddTenantDialog({ onClose, onCreated }: AddTenantDialogProps) {
  const queryClient = useQueryClient();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState('');
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [microsoftTenantId, setMicrosoftTenantId] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const tenantIdValid = GUID_PATTERN.test(microsoftTenantId.trim());
  const formValid = displayName.trim().length > 0 && primaryDomain.trim().length > 0 && tenantIdValid;

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<ManagedTenant>('/tenants', {
        displayName: displayName.trim(),
        primaryDomain: primaryDomain.trim().toLowerCase(),
        microsoftTenantId: microsoftTenantId.trim().toLowerCase(),
        authMethod: 'app-consent',
      }),
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      onCreated(tenant);
    },
    onError: (err: Error) => setError(err),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!formValid || createMutation.isPending) return;
    createMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-tenant-title"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="add-tenant-title" className="font-medium">
            Tenant hinzufuegen
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-accent"
            aria-label="Schliessen"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          <Field
            id="tenant-display-name"
            label="Anzeigename"
            hint="Kundenname, wie er in der Konsole erscheinen soll"
          >
            <input
              ref={firstFieldRef}
              id="tenant-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={inputClass}
              autoComplete="off"
              required
            />
          </Field>

          <Field id="tenant-domain" label="Primaere Domain" hint="z. B. kunde.onmicrosoft.com">
            <input
              id="tenant-domain"
              value={primaryDomain}
              onChange={(e) => setPrimaryDomain(e.target.value)}
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>

          <Field
            id="tenant-ms-id"
            label="Microsoft-Tenant-ID"
            hint="GUID aus Entra ID > Uebersicht"
            error={touched && !tenantIdValid ? 'Keine gueltige GUID' : undefined}
          >
            <input
              id="tenant-ms-id"
              value={microsoftTenantId}
              onChange={(e) => setMicrosoftTenantId(e.target.value)}
              onBlur={() => setTouched(true)}
              className={clsx(inputClass, 'font-mono', touched && !tenantIdValid && 'border-destructive')}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>

          <p className="text-xs text-muted-foreground">
            Nach dem Anlegen startest du den Admin-Consent. Dabei meldest du dich als
            Global Administrator des Kundentenants an.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending || (touched && !formValid)}
            className={clsx(
              'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {createMutation.isPending ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner size="sm" className="text-primary-foreground" />
                Wird angelegt...
              </span>
            ) : (
              'Anlegen'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
