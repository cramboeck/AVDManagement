'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingPage } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { ResizeDialog, VmActionDialog, type VmAction } from '@/components/vms/vm-dialogs';
import { PowerBadge } from '@/components/vms/power-badge';
import type { AzureVmDetail } from '@zerostress/types';

export default function VmDetailPage({ params }: { params: { resourceId: string } }) {
  const resourceId = decodeURIComponent(params.resourceId);
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ kind: 'action'; action: VmAction } | { kind: 'resize' } | null>(null);

  const query = useQuery({
    queryKey: ['vm', activeTenant?.id, resourceId],
    queryFn: () => api.get<AzureVmDetail>(`/tenants/${activeTenant!.id}/vms/${encodeURIComponent(resourceId)}`),
    enabled: !!activeTenant,
    refetchInterval: (q) => (q.state.data && ['starting', 'stopping', 'deallocating'].includes(q.state.data.powerState) ? 5000 : false),
  });

  if (tenantLoading) return <LoadingPage message="Lade VM..." />;
  if (!activeTenant) return <NoTenantSelected />;
  if (query.isLoading) return <LoadingPage message="Lade VM..." />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const vm = query.data;
  if (!vm) return <EmptyState title="VM nicht gefunden" />;
  const tenantId = activeTenant.id;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['vm', tenantId, resourceId] });
    queryClient.invalidateQueries({ queryKey: ['vms', tenantId] });
    queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href="/vms" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Zurueck zu den VMs">
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">{vm.name}</h1>
            <p className="text-sm text-muted-foreground">
              {vm.resourceGroup} · {vm.location} · {vm.vmSize} · {vm.imageReference ?? vm.osType}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <PowerBadge state={vm.powerState} />
              {vm.isSessionHost && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">AVD-Sitzungshost</span>}
              {vm.securityType && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{vm.securityType}</span>}
              {vm.licenseType && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{vm.licenseType}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {vm.powerState !== 'running' && vm.powerState !== 'starting' && (
            <button onClick={() => setDialog({ kind: 'action', action: 'start' })} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Starten
            </button>
          )}
          {vm.powerState === 'running' && (
            <>
              <button onClick={() => setDialog({ kind: 'action', action: 'restart' })} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
                Neu starten
              </button>
              <button onClick={() => setDialog({ kind: 'action', action: 'stop' })} className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">
                Stoppen
              </button>
            </>
          )}
          <button onClick={() => setDialog({ kind: 'resize' })} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Groesse aendern
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Netzwerk</h2>
          {vm.nics.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Netzwerkkarte.</p>
          ) : (
            <ul className="divide-y text-sm">
              {vm.nics.map((n) => (
                <li key={n.id} className="py-2">
                  <p className="font-medium">{n.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    privat {n.privateIp ?? '—'}
                    {n.publicIp ? ` · oeffentlich ${n.publicIp}` : ''}
                    {n.macAddress ? ` · ${n.macAddress}` : ''}
                  </p>
                  {n.subnetId && <p className="break-all text-xs text-muted-foreground">{n.subnetId.split('/').slice(-3).join('/')}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Datentraeger</h2>
          <ul className="divide-y text-sm">
            {vm.disks.map((d) => (
              <li key={d.name} className="flex items-center justify-between py-2">
                <span>
                  {d.name} <span className="text-xs text-muted-foreground">({d.role === 'os' ? 'System' : 'Daten'})</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {d.sizeGb ?? '?'} GB · {d.storageType ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Eigenschaften</h2>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[160px_1fr]">
            <dt className="text-muted-foreground">Computername</dt>
            <dd>{vm.computerName ?? '—'}</dd>
            <dt className="text-muted-foreground">Erstellt</dt>
            <dd>{vm.timeCreated ? formatDateTime(vm.timeCreated) : '—'}</dd>
            <dt className="text-muted-foreground">Identitaet</dt>
            <dd>{vm.identity ?? 'keine'}</dd>
            <dt className="text-muted-foreground">Erweiterungen</dt>
            <dd>{vm.extensions.join(', ') || '—'}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{vm.statuses.join(' · ') || '—'}</dd>
            <dt className="text-muted-foreground">Tags</dt>
            <dd className="text-muted-foreground">{Object.entries(vm.tags).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}</dd>
            <dt className="text-muted-foreground">Ressourcen-Id</dt>
            <dd className="break-all font-mono text-xs text-muted-foreground">{vm.id}</dd>
          </dl>
        </section>
      </div>

      {dialog?.kind === 'action' && <VmActionDialog tenantId={tenantId} vm={vm} action={dialog.action} onClose={() => setDialog(null)} onCompleted={refresh} />}
      {dialog?.kind === 'resize' && <ResizeDialog tenantId={tenantId} vm={vm} onClose={() => setDialog(null)} onCompleted={refresh} />}
    </div>
  );
}
