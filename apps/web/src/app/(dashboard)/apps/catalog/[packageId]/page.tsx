'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, ApiError } from '@/lib/api';
import { useTenant } from '@/hooks/use-tenant';
import { LoadingPage, LoadingSpinner } from '@/components/ui/loading';
import { ErrorState, ErrorBanner } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { Collapsible } from '@/components/ui/collapsible';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { PackageForm, type ManifestDraft } from '@/components/apps/package-form';
import { PackageStatusBadge, DeploymentStatusBadge, installerTypeLabels, formatBytes } from '@/components/apps/package-badges';
import { RolloutDialog } from '@/components/apps/rollout-dialog';
import type { AppPackage, BuildJob } from '@zerostress/types';

const buildStatusLabels: Record<BuildJob['status'], string> = { queued: 'wartet', claimed: 'angenommen', building: 'baut', succeeded: 'erfolgreich', failed: 'fehlgeschlagen' };

export default function PackageDetailPage({ params }: { params: { packageId: string } }) {
  const packageId = params.packageId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tenants } = useTenant();
  const [editing, setEditing] = useState(false);
  const [rollout, setRollout] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<Error | null>(null);
  const artifactInput = useRef<HTMLInputElement>(null);
  const installerInput = useRef<HTMLInputElement>(null);

  const query = useQuery({ queryKey: ['package', packageId], queryFn: () => api.get<AppPackage>(`/packages/${packageId}`), refetchInterval: (q) => (q.state.data && ['queued', 'building', 'draft'].includes(q.state.data.status) ? 5000 : q.state.data?.deployments.some((d) => d.status === 'publishing' || d.status === 'pending') ? 5000 : false) });

  const builds = useQuery({
    queryKey: ['package-builds', packageId],
    queryFn: () => api.get<{ items: BuildJob[]; workerConfigured: boolean }>(`/packages/${packageId}/builds`),
    enabled: !!query.data && ['msi', 'exe', 'psadt'].includes(query.data.manifest.installerType),
    refetchInterval: (q) => (q.state.data?.items.some((b) => ['queued', 'claimed', 'building'].includes(b.status)) ? 5000 : false),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['package', packageId] });
    queryClient.invalidateQueries({ queryKey: ['package-builds', packageId] });
    queryClient.invalidateQueries({ queryKey: ['packages'] });
  };

  const save = useMutation({
    mutationFn: (draft: ManifestDraft) => apiPut<AppPackage>(`/packages/${packageId}`, draft),
    onSuccess: () => {
      refresh();
      setEditing(false);
    },
    onError: (e: Error) => setProblems(e instanceof ApiError ? ((e.problem as { problems?: string[] }).problems ?? []) : []),
  });
  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: 'artifact' | 'installer'; file: File }) => api.upload<AppPackage>(`/packages/${packageId}/${kind}`, file),
    onSuccess: refresh,
    onError: (e: Error) => setUploadError(e),
  });
  const build = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/packages/${packageId}/build`),
    onSuccess: refresh,
    onError: (e: Error) => setUploadError(e),
  });
  const remove = useMutation({
    mutationFn: () => api.delete<{ deleted: boolean }>(`/packages/${packageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages'] });
      router.push('/apps/catalog');
    },
    onError: (e: Error) => setUploadError(e),
  });

  if (query.isLoading) return <LoadingPage message="Lade Paket..." />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const pkg = query.data;
  if (!pkg) return <EmptyState title="Paket nicht gefunden" />;
  const m = pkg.manifest;
  const needsArtifact = m.installerType !== 'winget';
  const canBuild = ['msi', 'exe', 'psadt'].includes(m.installerType) && !!pkg.installer && !['queued', 'building'].includes(pkg.status);
  const canRollout = pkg.status === 'ready' && tenants.some((t) => t.connectionStatus === 'connected');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href="/apps/catalog" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Zurueck zum Katalog">
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">
              {m.vendor} {m.name} {m.version}
            </h1>
            <p className="text-sm text-muted-foreground">
              {installerTypeLabels[m.installerType]} · {m.architecture} · {m.language} · Rev. {m.revision} · angelegt von {pkg.createdByEmail} am {formatDateTime(pkg.createdAt)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <PackageStatusBadge status={pkg.status} />
              {pkg.detectionKeyPath && (
                <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground" title="Erkennungsschluessel, den der Worker in das Paket schreibt">
                  {pkg.detectionKeyPath.replace('HKEY_LOCAL_MACHINE\\SOFTWARE\\', 'HKLM\\...\\')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setEditing(true)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Bearbeiten
          </button>
          <button onClick={() => setRollout(true)} disabled={!canRollout} title={canRollout ? undefined : 'Paket muss bereit sein'} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Ausrollen
          </button>
        </div>
      </div>

      <ErrorBanner error={uploadError} onDismiss={() => setUploadError(null)} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Dateien</h2>
          {!needsArtifact ? (
            <p className="text-sm text-muted-foreground">
              winget-Paket <span className="font-mono">{m.wingetPackageIdentifier}</span>: Intune laedt die Software selbst aus dem Microsoft-Store-Katalog. Kein Upload noetig.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <FileRow
                label="Artefakt (.intunewin)"
                file={pkg.artifact}
                hint={m.installerType === 'intunewin' ? 'Fertiges Paket, z. B. aus PackageFactory' : 'Entsteht durch den Build-Worker; kann auch direkt hochgeladen werden'}
                pending={upload.isPending && upload.variables?.kind === 'artifact'}
                onPick={() => artifactInput.current?.click()}
                downloadHref={pkg.artifact ? `/packages/${packageId}/artifact` : null}
              />
              {m.installerType !== 'intunewin' && (
                <FileRow label="Installer (msi/exe)" file={pkg.installer} hint="Eingabe fuer den Build-Worker" pending={upload.isPending && upload.variables?.kind === 'installer'} onPick={() => installerInput.current?.click()} downloadHref={pkg.installer ? `/packages/${packageId}/installer` : null} />
              )}
              <input ref={artifactInput} type="file" accept=".intunewin" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate({ kind: 'artifact', file: e.target.files[0] })} />
              <input ref={installerInput} type="file" accept=".msi,.exe" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate({ kind: 'installer', file: e.target.files[0] })} />
              {['msi', 'exe', 'psadt'].includes(m.installerType) && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {pkg.status === 'queued' ? 'Build wartet auf einen Worker.' : pkg.status === 'building' ? 'Der Worker baut gerade.' : pkg.status === 'failed' ? `Letzter Build fehlgeschlagen: ${pkg.buildError ?? ''}` : 'Der Windows-Worker erzeugt aus Installer und Manifest das .intunewin.'}
                  </span>
                  <button onClick={() => build.mutate()} disabled={!canBuild || build.isPending} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
                    {build.isPending && <LoadingSpinner size="sm" />}
                    Build starten
                  </button>
                </div>
              )}
              {builds.data && !builds.data.workerConfigured && ['msi', 'exe', 'psadt'].includes(m.installerType) && (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  Kein Build-Worker eingerichtet: in der API fehlt WORKER_TOKEN. Auftraege bleiben auf &quot;wartet&quot;, bis ein Worker laeuft (siehe apps/worker-windows/README.md). Alternativ das fertige .intunewin direkt hochladen.
                </p>
              )}
              {builds.data && builds.data.items.length > 0 && (
                <Collapsible summary="Build-Auftraege" aside={`${builds.data.items.length}`} defaultOpen={builds.data.items.some((b) => ['queued', 'claimed', 'building'].includes(b.status))}>
                  <ul className="divide-y text-xs">
                    {builds.data.items.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                        <span className={clsx('font-medium', b.status === 'failed' && 'text-destructive', b.status === 'succeeded' && 'text-success')}>{buildStatusLabels[b.status]}</span>
                        <span className="text-muted-foreground">
                          {formatDateTime(b.createdAt)}
                          {b.workerId ? ` · Worker ${b.workerId}` : ''}
                          {b.finishedAt ? ` · fertig ${formatDateTime(b.finishedAt)}` : ''}
                        </span>
                        {b.error && <span className="basis-full text-destructive">{b.error}</span>}
                      </li>
                    ))}
                  </ul>
                </Collapsible>
              )}
              {pkg.buildLog && (
                <Collapsible summary="Build-Protokoll" aside={pkg.status === 'failed' ? 'fehlgeschlagen' : 'letzter Lauf'} defaultOpen={pkg.status === 'failed'}>
                  <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{pkg.buildLog}</pre>
                </Collapsible>
              )}
            </div>
          )}
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Manifest</h2>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <Row k="Installation" v={m.installerType === 'psadt' ? `PSADT Silent${m.installCommand ? ` (Installer-Parameter ${m.installCommand})` : ''}` : (m.installCommand ?? (m.installerType === 'msi' ? 'msiexec /qn' : '—'))} mono />
            <Row k="Deinstallation" v={m.installerType === 'psadt' ? `PSADT Silent${m.uninstallCommand ? ` (${m.uninstallCommand})` : m.installerFileName?.toLowerCase().endsWith('.msi') ? ' (msiexec /x)' : ' (kein Befehl hinterlegt)'}` : (m.uninstallCommand ?? (m.installerType === 'msi' && m.msiProductCode ? `msiexec /x ${m.msiProductCode}` : '—'))} mono />
            <Row k="Kontext" v={m.installContext === 'system' ? 'System' : 'Benutzer'} />
            <Row k="Neustart" v={m.restartBehavior} />
            <Row k="Windows ab" v={m.requirements.minimumWindowsRelease ?? '—'} />
            <Row k="Architektur" v={m.requirements.architecture} />
            <Row k="Prozesse schliessen" v={m.processesToClose.join(', ') || '—'} />
            <Row k="Erkennung" v={m.installerType === 'psadt' ? 'Registry-Marker (Installed = Y, Version)' : m.installerType === 'winget' ? 'durch Intune' : m.detection.map((d) => (d.type === 'registry' ? `Registry ${d.keyPath}` : d.type === 'file' ? `Datei ${d.path}\\${d.fileOrFolderName}` : d.type === 'msi' ? `MSI ${d.productCode}` : 'Skript')).join('; ') || (m.msiProductCode ? `MSI ${m.msiProductCode}` : '—')} mono />
            <Row k="Rueckgabecodes" v={m.returnCodes.map((r) => `${r.code}=${r.type}`).join(', ')} mono />
            <Row k="Herausgeber" v={m.publisher} />
          </dl>
          {m.description && <p className="mt-3 text-sm text-muted-foreground">{m.description}</p>}
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Rollout je Tenant</h2>
        {pkg.deployments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch in keinem Tenant veroeffentlicht.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Tenant</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Intune-App</th>
                  <th className="px-3 py-2 font-medium">Veroeffentlicht</th>
                  <th className="px-3 py-2 font-medium">Fehler</th>
                </tr>
              </thead>
              <tbody>
                {pkg.deployments.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{d.tenantDisplayName}</td>
                    <td className="px-3 py-2">
                      <DeploymentStatusBadge status={d.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{d.intuneAppId ? d.intuneAppId.slice(0, 8) + '…' : '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{d.publishedAt ? formatDateTime(d.publishedAt) : '—'}</td>
                    <td className={clsx('px-3 py-2 text-xs', d.error && 'text-destructive')}>{d.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Gefahrenzone</summary>
        <div className="mt-2 flex items-center justify-between rounded-md border border-destructive/30 p-3">
          <span className="text-muted-foreground">Paket samt Dateien aus dem Katalog entfernen. Bereits veroeffentlichte Intune-Apps bleiben in den Tenants bestehen.</span>
          <button onClick={() => window.confirm(`Paket ${m.vendor} ${m.name} ${m.version} wirklich loeschen?`) && remove.mutate()} className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">
            Loeschen
          </button>
        </div>
      </details>

      {editing && (
        <PackageForm
          initial={m}
          lockIdentity={!!pkg.artifact}
          submitLabel="Speichern"
          pending={save.isPending}
          error={save.error as Error | null}
          problems={problems}
          onSubmit={(draft) => save.mutate(draft)}
          onCancel={() => {
            setEditing(false);
            save.reset();
            setProblems([]);
          }}
        />
      )}
      {rollout && <RolloutDialog pkg={pkg} onClose={() => setRollout(false)} onStarted={refresh} />}
    </div>
  );
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const { apiFetch } = await import('@/lib/api');
  return apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={clsx('break-all', mono && 'font-mono text-xs')}>{v}</dd>
    </div>
  );
}

function FileRow({ label, file, hint, pending, onPick, downloadHref }: { label: string; file: AppPackage['artifact']; hint: string; pending: boolean; onPick: () => void; downloadHref: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        {file ? (
          <p className="truncate text-xs text-muted-foreground">
            {file.fileName} · {formatBytes(file.sizeBytes)} · SHA-256 <span className="font-mono">{file.sha256.slice(0, 12)}…</span> · {formatDateTime(file.uploadedAt)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className="flex gap-2">
        {downloadHref && (
          <a href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}${downloadHref}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Download
          </a>
        )}
        <button onClick={onPick} disabled={pending} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
          {pending && <LoadingSpinner size="sm" />}
          {file ? 'Ersetzen' : 'Hochladen'}
        </button>
      </div>
    </div>
  );
}
