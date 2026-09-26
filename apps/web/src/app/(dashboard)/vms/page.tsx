'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { DeployVmDialog, ResizeDialog, VmActionDialog, type VmAction } from '@/components/vms/vm-dialogs';
import { PowerBadge, powerMeta } from '@/components/vms/power-badge';
import type { AzureVm, VmPowerState } from '@zerostress/types';

export default function VmsPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ kind: 'action'; vm: AzureVm; action: VmAction } | { kind: 'resize'; vm: AzureVm } | { kind: 'deploy' } | null>(null);

  const query = useQuery({
    queryKey: ['vms', activeTenant?.id],
    queryFn: () => api.get<{ items: AzureVm[]; warnings: string[]; generatedAt: string }>(`/tenants/${activeTenant!.id}/vms`),
    enabled: !!activeTenant,
    staleTime: 60 * 1000,
  });

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;
  const tenantId = activeTenant.id;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['vms', tenantId] });
    queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] });
  };

  const columns: ColumnDef<AzureVm>[] = [
    {
      id: 'name',
      header: 'VM',
      accessor: (v) => v.name,
      cell: (v) => (
        <>
          <Link href={`/vms/${encodeURIComponent(v.id)}`} className="block font-medium hover:underline">
            {v.name}
          </Link>
          <span className="block text-xs text-muted-foreground">
            {v.resourceGroup} · {v.location}
            {v.isSessionHost ? ' · AVD' : ''}
          </span>
        </>
      ),
    },
    {
      id: 'power',
      header: 'Zustand',
      accessor: (v) => v.powerState,
      filterOptions: (Object.keys(powerMeta) as VmPowerState[]).map((s) => ({ value: s, label: powerMeta[s].label })),
      searchable: false,
      cell: (v) => <PowerBadge state={v.powerState} />,
    },
    { id: 'size', header: 'Groesse', accessor: (v) => v.vmSize, className: 'font-mono text-xs' },
    { id: 'os', header: 'OS', accessor: (v) => v.osType, filterOptions: [{ value: 'Windows', label: 'Windows' }, { value: 'Linux', label: 'Linux' }], searchable: false, cell: (v) => <span className="text-xs text-muted-foreground">{v.imageReference ?? v.osType}</span> },
    { id: 'rg', header: 'Ressourcengruppe', accessor: (v) => v.resourceGroup, defaultHidden: true },
    { id: 'tags', header: 'Tags', accessor: (v) => Object.entries(v.tags).map(([k, val]) => `${k}=${val}`).join(', '), cell: (v) => <span className="text-xs text-muted-foreground">{Object.entries(v.tags).map(([k, val]) => `${k}=${val}`).join(', ') || '—'}</span>, defaultHidden: true },
    {
      id: 'actions',
      header: '',
      accessor: () => '',
      searchable: false,
      cell: (v) => (
        <div className="flex flex-wrap gap-1">
          {v.powerState !== 'running' && v.powerState !== 'starting' && (
            <button onClick={() => setDialog({ kind: 'action', vm: v, action: 'start' })} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
              Starten
            </button>
          )}
          {v.powerState === 'running' && (
            <>
              <button onClick={() => setDialog({ kind: 'action', vm: v, action: 'restart' })} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
                Neustart
              </button>
              <button onClick={() => setDialog({ kind: 'action', vm: v, action: 'stop' })} className="rounded-md border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10">
                Stoppen
              </button>
            </>
          )}
          <button onClick={() => setDialog({ kind: 'resize', vm: v })} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
            Groesse
          </button>
        </div>
      ),
    },
  ];

  const items = query.data?.items ?? [];
  const running = items.filter((v) => v.powerState === 'running').length;
  const stopped = items.filter((v) => v.powerState === 'stopped').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Azure VMs</h1>
          <p className="text-sm text-muted-foreground">Alle virtuellen Maschinen der verbundenen Subscriptions. Aktionen sind Jobs mit Vorschau und Audit; neue VMs entstehen aus versionierten Vorlagen mit Kostenschaetzung.</p>
        </div>
        <button onClick={() => setDialog({ kind: 'deploy' })} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Neue VM aus Vorlage
        </button>
      </div>

      {query.isLoading ? (
        <LoadingTable rows={6} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="VMs" value={items.length} />
            <Stat label="Laufend" value={running} />
            <Stat label="Gestoppt, aber nicht freigegeben" value={stopped} tone={stopped > 0 ? 'warning' : undefined} sub={stopped > 0 ? 'kostet weiter Rechenzeit' : undefined} />
            <Stat label="AVD-Sitzungshosts" value={items.filter((v) => v.isSessionHost).length} />
          </div>
          {query.data && query.data.warnings.length > 0 && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">{query.data.warnings.join(' · ')}</p>
          )}
          {items.length === 0 ? (
            <EmptyState title="Keine VMs" description="In den Subscriptions dieses Tenants gibt es keine virtuellen Maschinen, oder der Konsole fehlt die Rolle Reader darauf." />
          ) : (
            <DataTable rows={items} columns={columns} getRowId={(v) => v.id} storageKey="vms" initialSort={{ columnId: 'name', direction: 'asc' }} searchPlaceholder="Name, Ressourcengruppe, Groesse..." exportFileName="azure-vms" />
          )}
        </>
      )}

      {dialog?.kind === 'action' && <VmActionDialog tenantId={tenantId} vm={dialog.vm} action={dialog.action} onClose={() => setDialog(null)} onCompleted={refresh} />}
      {dialog?.kind === 'resize' && <ResizeDialog tenantId={tenantId} vm={dialog.vm} onClose={() => setDialog(null)} onCompleted={refresh} />}
      {dialog?.kind === 'deploy' && <DeployVmDialog tenantId={tenantId} onClose={() => setDialog(null)} onCompleted={refresh} />}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'warning' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'warning' && 'text-warning')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
