'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { ErrorBanner } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import clsx from 'clsx';
import type { SyncedUser, LicenseSku, Job } from '@zerostress/types';

interface AssignLicenseDialogProps {
  user: SyncedUser;
  onClose: () => void;
  onSuccess: (job: Job) => void;
}

export function AssignLicenseDialog({
  user,
  onClose,
  onSuccess,
}: AssignLicenseDialogProps) {
  const { activeTenant } = useTenant();
  const queryClient = useQueryClient();
  const [selectedSku, setSelectedSku] = useState<LicenseSku | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const { data: skus, isLoading: loadingSkus } = useQuery({
    queryKey: ['skus', activeTenant?.id],
    queryFn: () =>
      api.get<{ items: LicenseSku[] }>(
        `/tenants/${activeTenant!.id}/licenses/skus`
      ),
    enabled: !!activeTenant,
  });

  const assignMutation = useMutation({
    mutationFn: (payload: {
      userId: string;
      userDisplayName: string;
      skuId: string;
      skuDisplayName: string;
    }) =>
      api.post<Job>(
        `/tenants/${activeTenant!.id}/jobs/assign-license`,
        payload
      ),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['jobs', activeTenant?.id] });
      onSuccess(job);
    },
    onError: (err: Error) => {
      setError(err);
    },
  });

  const handleSubmit = () => {
    if (!selectedSku) return;

    assignMutation.mutate({
      userId: user.microsoftId as string,
      userDisplayName: user.displayName,
      skuId: selectedSku.skuId,
      skuDisplayName: selectedSku.displayName,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="w-full max-w-md rounded-lg border bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="dialog-title" className="font-medium">
            Lizenz zuweisen
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-accent"
            aria-label="Schliessen"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          <div className="mb-4">
            <p className="text-sm text-muted-foreground">Benutzer</p>
            <p className="font-medium">{user.displayName}</p>
            <p className="text-xs text-muted-foreground">
              {user.userPrincipalName}
            </p>
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium">
              Lizenz auswaehlen
            </label>
            {loadingSkus ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoadingSpinner size="sm" />
                Lade verfuegbare Lizenzen...
              </div>
            ) : (
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {skus?.items.map((sku) => (
                  <label
                    key={sku.skuId}
                    className={clsx(
                      'flex cursor-pointer items-center gap-3 rounded-md border p-3',
                      'hover:bg-accent/50',
                      selectedSku?.skuId === sku.skuId && 'border-primary bg-accent'
                    )}
                  >
                    <input
                      type="radio"
                      name="sku"
                      checked={selectedSku?.skuId === sku.skuId}
                      onChange={() => setSelectedSku(sku)}
                      className="sr-only"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{sku.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {sku.skuPartNumber}
                      </p>
                    </div>
                    {selectedSku?.skuId === sku.skuId && (
                      <CheckIcon className="h-4 w-4 text-primary" />
                    )}
                  </label>
                ))}
                {skus?.items.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Keine Lizenzen verfuegbar.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button
            onClick={onClose}
            className={clsx(
              'rounded-md border px-4 py-2 text-sm',
              'hover:bg-accent'
            )}
          >
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedSku || assignMutation.isPending}
            className={clsx(
              'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
              'hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {assignMutation.isPending ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner size="sm" className="text-primary-foreground" />
                Wird erstellt...
              </span>
            ) : (
              'Job erstellen'
            )}
          </button>
        </div>
      </div>
    </div>
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

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
