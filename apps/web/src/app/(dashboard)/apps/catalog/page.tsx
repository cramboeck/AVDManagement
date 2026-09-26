'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { PackageForm, type ManifestDraft } from '@/components/apps/package-form';
import { PackageStatusBadge, installerTypeLabels, formatBytes } from '@/components/apps/package-badges';
import type { AppPackage, PackageInstallerType, PackageStatus } from '@zerostress/types';

interface CatalogResponse {
  items: AppPackage[];
  detectionPrefix: string;
  store: 'local' | 'azure';
}

const columns: ColumnDef<AppPackage>[] = [
  {
    id: 'name',
    header: 'Paket',
    accessor: (p) => `${p.manifest.vendor} ${p.manifest.name} ${p.manifest.version}`,
    cell: (p) => (
      <>
        <span className="block font-medium">
          {p.manifest.vendor} {p.manifest.name}
        </span>
        <span className="block text-xs text-muted-foreground">
          Version {p.manifest.version} · {p.manifest.architecture} · Rev. {p.manifest.revision}
        </span>
      </>
    ),
  },
  { id: 'type', header: 'Typ', accessor: (p) => p.manifest.installerType, filterOptions: (Object.keys(installerTypeLabels) as PackageInstallerType[]).map((k) => ({ value: k, label: installerTypeLabels[k] })), cell: (p) => <span className="text-muted-foreground">{installerTypeLabels[p.manifest.installerType]}</span>, searchable: false },
  {
    id: 'status',
    header: 'Status',
    accessor: (p) => p.status,
    filterOptions: (['draft', 'installer-uploaded', 'queued', 'building', 'ready', 'failed'] as PackageStatus[]).map((s) => ({ value: s, label: s })),
    cell: (p) => <PackageStatusBadge status={p.status} />,
    searchable: false,
  },
  { id: 'artifact', header: 'Artefakt', accessor: (p) => p.artifact?.fileName ?? null, cell: (p) => (p.artifact ? <span className="text-xs">{p.artifact.fileName} · {formatBytes(p.artifact.sizeBytes)}</span> : <span className="text-xs text-muted-foreground">{p.manifest.installerType === 'store' ? 'nicht noetig' : p.manifest.installerType === 'winget' ? 'aus Katalog bauen' : '—'}</span>) },
  {
    id: 'deployments',
    header: 'Tenants',
    accessor: (p) => p.deployments.filter((d) => d.status === 'published').length,
    align: 'right',
    cell: (p) => {
      const published = p.deployments.filter((d) => d.status === 'published').length;
      const failed = p.deployments.filter((d) => d.status === 'failed').length;
      return (
        <span className="tabular-nums">
          {published}
          {failed > 0 && <span className="ml-1 text-xs text-destructive">({failed} fehlgeschlagen)</span>}
        </span>
      );
    },
  },
  { id: 'updated', header: 'Geaendert', accessor: (p) => new Date(p.updatedAt), cell: (p) => <span className="text-muted-foreground">{formatDateTime(p.updatedAt)}</span> },
  { id: 'creator', header: 'Erstellt von', accessor: (p) => p.createdByEmail, defaultHidden: true },
];

export default function CatalogPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const query = useQuery({ queryKey: ['packages'], queryFn: () => api.get<CatalogResponse>('/packages'), staleTime: 30 * 1000 });

  const create = useMutation({
    mutationFn: (draft: ManifestDraft) => api.post<AppPackage>('/packages', draft),
    onSuccess: (pkg) => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
      setCreating(false);
      router.push(`/apps/catalog/${pkg.id}`);
    },
    onError: (e: Error) => {
      const p = e instanceof ApiError ? (e.problem as { problems?: string[] }).problems : undefined;
      setProblems(p ?? []);
    },
  });

  const items = query.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Paketkatalog</h1>
          <p className="text-sm text-muted-foreground">
            Einmal gebaut, in jeden Tenant ausgerollt. Manifest, Artefakt und Rollout-Stand je Tenant.{' '}
            {query.data && (
              <>
                Erkennungspraefix <span className="font-mono">{query.data.detectionPrefix}</span>, Ablage {query.data.store === 'azure' ? 'Azure Blob (EU)' : 'lokal'}.
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/apps" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Zu den Intune-Apps
          </Link>
          <button onClick={() => setCreating(true)} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Neues Paket
          </button>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingTable rows={6} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : items.length === 0 ? (
        <EmptyState title="Noch keine Pakete" description="Lege das erste Paket an: aus dem winget-Katalog (Basis-Set oder Id), Installer fuer den Build-Worker oder ein fertiges .intunewin." action={<button onClick={() => setCreating(true)} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Neues Paket</button>} />
      ) : (
        <DataTable rows={items} columns={columns} getRowId={(p) => p.id} storageKey="packages" initialSort={{ columnId: 'updated', direction: 'desc' }} searchPlaceholder="Hersteller, Name, Version..." onRowClick={(p) => router.push(`/apps/catalog/${p.id}`)} exportFileName="paketkatalog" />
      )}

      {creating && (
        <PackageForm
          submitLabel="Paket anlegen"
          pending={create.isPending}
          error={create.error as Error | null}
          problems={problems}
          onSubmit={(draft) => create.mutate(draft)}
          onCancel={() => {
            setCreating(false);
            create.reset();
            setProblems([]);
          }}
        />
      )}
    </div>
  );
}
