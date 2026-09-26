'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useTenant } from '@/hooks/use-tenant';
import { ErrorBanner } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { DeploymentStatusBadge } from '@/components/apps/package-badges';
import type { AppPackage, Job } from '@zerostress/types';

/**
 * Rollout auf N Tenants: je Tenant ein Job apps.publish mit Vorschau und
 * Freigabe in der Job-Liste. Bereits veroeffentlichte Tenants sind vorausgewaehlt abgewaehlt.
 */
export function RolloutDialog({ pkg, onClose, onStarted }: { pkg: AppPackage; onClose: () => void; onStarted: () => void }) {
  const { tenants } = useTenant();
  const connected = tenants.filter((t) => t.connectionStatus === 'connected');
  const [selected, setSelected] = useState<Set<string>>(new Set(connected.filter((t) => !pkg.deployments.some((d) => d.tenantId === t.id && d.status === 'published')).map((t) => t.id)));
  const [autoApprove, setAutoApprove] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const start = useMutation({
    mutationFn: () => api.post<{ jobs: Job[] }>(`/packages/${pkg.id}/rollout`, { tenantIds: Array.from(selected), autoApprove }),
    onSuccess: () => {
      onStarted();
      onClose();
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="rollout-title">
        <div className="border-b px-4 py-3">
          <h2 id="rollout-title" className="font-medium">
            {pkg.manifest.vendor} {pkg.manifest.name} {pkg.manifest.version} ausrollen
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Je Tenant entsteht ein Job mit Vorschau. Das Paket wird als Win32-App mit Inhalt nach Intune geladen (Store-Apps nur als Verweis), aber noch niemandem zugewiesen; Zuweisungen folgen unter Apps.</p>
        </div>
        <div className="space-y-3 p-4">
          <ErrorBanner error={start.error as Error | null} onDismiss={() => start.reset()} />
          <ul className="max-h-72 divide-y overflow-auto rounded-md border">
            {connected.map((t) => {
              const existing = pkg.deployments.find((d) => d.tenantId === t.id);
              return (
                <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="h-4 w-4 rounded border-gray-300" />
                    <span>
                      <span className="block font-medium">{t.displayName}</span>
                      <span className="block text-xs text-muted-foreground">{t.primaryDomain}</span>
                    </span>
                  </label>
                  {existing ? <DeploymentStatusBadge status={existing.status} /> : <span className="text-xs text-muted-foreground">noch nicht</span>}
                </li>
              );
            })}
            {connected.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Kein verbundener Tenant.</li>}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300" />
            <span>
              Jobs sofort freigeben
              <span className="block text-xs text-muted-foreground">Sonst warten sie in der Job-Liste auf Freigabe je Tenant. Bei einem Paket, das schon in einem Tenant lief, ist die Sofortfreigabe ueblich.</span>
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button onClick={() => start.mutate()} disabled={selected.size === 0 || start.isPending} className={clsx('inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50')}>
            {start.isPending && <LoadingSpinner size="sm" className="text-primary-foreground" />}
            {selected.size} Tenant{selected.size === 1 ? '' : 's'} ausrollen
          </button>
        </div>
      </div>
    </div>
  );
}
