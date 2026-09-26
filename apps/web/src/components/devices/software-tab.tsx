'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { ScriptResultView, wingetUpdatesFrom, wingetInventoryFrom, type WingetUpdate } from '@/components/devices/scripts-tab';
import { WingetInstallDialog, type WingetTarget } from '@/components/devices/winget-install-dialog';
import type { AppPackage, DetectedApp, Device, DeviceSoftwareInventory, Job, ScriptRunResult, WingetCatalogEntry } from '@zerostress/types';

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// winget kennt Ids, Intune kennt Anzeigenamen; ein Treffer ueber den Namen reicht fuer die Markierung
export function matchWingetUpdate(app: DetectedApp, updates: WingetUpdate[]): WingetUpdate | null {
  const appName = normalise(app.displayName);
  if (appName.length < 3) return null;
  for (const update of updates) {
    const name = normalise(update.name.replace(/\.\.\.$/, ''));
    const idTail = normalise(update.id.split('.').slice(1).join(' '));
    if (name.length >= 4 && (appName.includes(name) || name.includes(appName))) return update;
    if (idTail.length >= 4 && appName.includes(idTail)) return update;
  }
  return null;
}

export interface CatalogHit {
  id: string;
  name: string;
  // Paket im eigenen Katalog (mit Version), sonst nur Basis-Set
  packageId: string | null;
  packageVersion: string | null;
}

/**
 * Erkennung gegen den winget-Katalog: Basis-Set und eigene Pakete ueber den
 * Anzeigenamen. Ein Treffer heisst: dafuer gibt es eine winget-Id.
 */
export function matchCatalog(app: DetectedApp, baseSet: WingetCatalogEntry[], packages: AppPackage[]): CatalogHit | null {
  const appName = normalise(app.displayName);
  if (appName.length < 3) return null;
  for (const p of packages) {
    if (p.manifest.installerType !== 'winget' || !p.manifest.wingetPackageIdentifier) continue;
    const name = normalise(p.manifest.name);
    if (name.length >= 3 && (appName.includes(name) || name.includes(appName))) {
      return { id: p.manifest.wingetPackageIdentifier, name: p.manifest.name, packageId: p.id, packageVersion: p.manifest.version };
    }
  }
  for (const e of baseSet) {
    const name = normalise(e.name);
    const idTail = normalise(e.id.split('.').slice(1).join(' '));
    if ((name.length >= 3 && (appName.includes(name) || name.includes(appName))) || (idTail.length >= 4 && appName.includes(idTail))) {
      return { id: e.id, name: e.name, packageId: null, packageVersion: null };
    }
  }
  return null;
}

/** Inventar-Id (aus winget list) ueber den Namensteil der Id dem Intune-Eintrag zuordnen. */
export function matchInventoryId(app: DetectedApp, ids: string[]): string | null {
  const appName = normalise(app.displayName);
  if (appName.length < 3) return null;
  for (const id of ids) {
    const tail = normalise(id.split('.').slice(1).join(' '));
    const head = normalise(id.split('.')[0] ?? '');
    if (tail.length >= 4 && (appName.includes(tail) || tail.includes(appName))) return id;
    if (head.length >= 4 && tail.length >= 3 && appName.includes(head) && appName.includes(tail)) return id;
  }
  return null;
}

interface SoftwareRow extends DetectedApp {
  update: WingetUpdate | null;
  catalog: CatalogHit | null;
  // Id laut winget-Inventar auf dem Geraet (Grundlage fuer Deinstallation)
  wingetId: string | null;
  wingetState: 'update' | 'catalog' | 'none';
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function SoftwareTab({ base, tenantId, device }: { base: string; tenantId: string; device: Device }) {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState<'winget-updates' | 'winget-inventory' | null>(null);
  const [target, setTarget] = useState<WingetTarget | null>(null);
  const [pickedBase, setPickedBase] = useState('');
  const managedDeviceId = device.intune?.managedDeviceId ?? null;

  const softwareQuery = useQuery({
    queryKey: ['device-software', tenantId, device.id],
    queryFn: () => api.get<DeviceSoftwareInventory>(`${base}/software`),
    staleTime: 10 * 60 * 1000,
  });
  const baseSet = useQuery({ queryKey: ['winget-base-set'], queryFn: () => api.get<{ items: WingetCatalogEntry[] }>('/packages/winget/base-set'), staleTime: Infinity });
  const packages = useQuery({ queryKey: ['packages'], queryFn: () => api.get<{ items: AppPackage[] }>('/packages'), staleTime: 60 * 1000 });

  const jobsQuery = useQuery({
    queryKey: ['jobs', tenantId],
    queryFn: () => api.get<{ items: Job[] }>(`/tenants/${tenantId}/jobs?limit=100`),
    refetchInterval: 5000,
    enabled: !!managedDeviceId,
  });

  const latestCheck = useMemo(
    () =>
      (jobsQuery.data?.items ?? []).find(
        (j) => j.type === 'device.run-script' && j.payload.managedDeviceId === managedDeviceId && j.payload.scriptId === 'winget-updates'
      ) ?? null,
    [jobsQuery.data, managedDeviceId]
  );
  const latestResult = latestCheck?.status === 'completed' ? (latestCheck.result as unknown as ScriptRunResult | null) : null;
  const updates = useMemo(() => wingetUpdatesFrom(latestResult), [latestResult]);
  const latestInventory = useMemo(
    () =>
      (jobsQuery.data?.items ?? []).find(
        (j) => j.type === 'device.run-script' && j.payload.managedDeviceId === managedDeviceId && j.payload.scriptId === 'winget-inventory'
      ) ?? null,
    [jobsQuery.data, managedDeviceId]
  );
  const inventory_ = useMemo(() => wingetInventoryFrom(latestInventory?.status === 'completed' ? (latestInventory.result as unknown as ScriptRunResult | null) : null), [latestInventory]);

  const rows: SoftwareRow[] = useMemo(
    () =>
      (softwareQuery.data?.available ? softwareQuery.data.data.items : []).map((app) => {
        const update = matchWingetUpdate(app, updates);
        const catalog = matchCatalog(app, baseSet.data?.items ?? [], packages.data?.items ?? []);
        const wingetId = update?.id ?? matchInventoryId(app, inventory_.ids) ?? null;
        return { ...app, update, catalog, wingetId, wingetState: update ? 'update' : catalog || wingetId ? 'catalog' : 'none' };
      }),
    [softwareQuery.data, updates, baseSet.data, packages.data, inventory_.ids]
  );

  const installedNames = useMemo(() => new Set(rows.filter((r) => r.catalog).map((r) => r.catalog!.id)), [rows]);
  const columns: ColumnDef<SoftwareRow>[] = useMemo(
    () => [
      { id: 'name', header: 'Software', accessor: (a) => a.displayName, cell: (a) => <span className="font-medium">{a.displayName}</span> },
      { id: 'version', header: 'Version', accessor: (a) => a.version, className: 'font-mono text-xs' },
      {
        id: 'winget',
        header: 'winget',
        accessor: (a) => a.wingetState,
        sortValue: (a) => (a.update ? 0 : a.catalog ? 1 : 2),
        filterOptions: [
          { value: 'update', label: 'Update verfuegbar' },
          { value: 'catalog', label: 'Im Katalog bekannt' },
          { value: 'none', label: 'Nicht zugeordnet' },
        ],
        filterLabel: 'winget',
        searchable: false,
        cell: (a) =>
          a.update ? (
            <span className="inline-flex rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning" title={a.update.id}>
              {a.update.installed || a.version || '?'} → {a.update.available}
            </span>
          ) : a.catalog ? (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" title={a.catalog.id}>
              {a.catalog.packageId ? `Paket ${a.catalog.packageVersion}` : a.catalog.id}
            </span>
          ) : a.wingetId ? (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" title="laut winget-Inventar auf dem Geraet">
              {a.wingetId}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: 'actions',
        header: '',
        accessor: () => '',
        searchable: false,
        cell: (a) =>
          managedDeviceId && (a.update || a.catalog || a.wingetId) ? (
            <div className="flex flex-wrap gap-1">
              {a.update && (
                <button onClick={() => setTarget({ packageId: a.update!.id, mode: 'upgrade', displayName: a.displayName, installedVersion: a.update!.installed || a.version, availableVersion: a.update!.available })} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
                  Update installieren
                </button>
              )}
              {a.wingetId && (
                <button onClick={() => setTarget({ packageId: a.wingetId!, mode: 'uninstall', displayName: a.displayName, installedVersion: a.version, availableVersion: null })} className="rounded-md border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10">
                  Deinstallieren
                </button>
              )}
              {(a.update || a.catalog) && !a.catalog?.packageId && (
                <Link href={`/apps/catalog?wingetId=${encodeURIComponent(a.update?.id ?? a.catalog!.id)}`} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
                  Als Paket anlegen
                </Link>
              )}
              {a.catalog?.packageId && (
                <Link href={`/apps/catalog/${a.catalog.packageId}`} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
                  Zum Paket
                </Link>
              )}
            </div>
          ) : null,
      },
      { id: 'publisher', header: 'Hersteller', accessor: (a) => a.publisher },
      {
        id: 'source',
        header: 'Quelle',
        accessor: (a) => a.source,
        filterOptions: [
          { value: 'intune', label: 'Intune' },
          { value: 'defender', label: 'Defender' },
        ],
        searchable: false,
        cell: (a) => <span className="text-xs text-muted-foreground">{a.source === 'intune' ? 'Intune' : 'Defender'}</span>,
      },
      { id: 'size', header: 'Groesse', accessor: (a) => a.sizeBytes, cell: (a) => <span className="text-muted-foreground">{formatSize(a.sizeBytes)}</span>, align: 'right' },
      { id: 'platform', header: 'Plattform', accessor: (a) => a.platform, defaultHidden: true },
    ],
    [managedDeviceId]
  );

  if (softwareQuery.isLoading) return <LoadingTable rows={8} />;
  if (softwareQuery.error) return <ErrorState error={softwareQuery.error as Error} onRetry={softwareQuery.refetch} />;
  const inventory = softwareQuery.data;
  if (!inventory) return null;
  if (!inventory.available) {
    return <CapabilityNotice what="das Softwareinventar" reason={inventory.reason} missingPermission={inventory.missingPermission} detail={inventory.detail} />;
  }

  const apps = inventory.data.items;
  const updateCount = rows.filter((r) => r.update).length;
  const baseCandidates = (baseSet.data?.items ?? []).filter((e) => !installedNames.has(e.id));
  const refreshJobs = () => queryClient.invalidateQueries({ queryKey: ['jobs', tenantId] });

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Update-Pruefung mit winget</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Laeuft als Skript auf dem Geraet im Maschinenkontext und fragt die Quelle winget nach neueren Versionen. Gefundene Updates lassen sich je Zeile direkt installieren oder als Paket in den Katalog uebernehmen.
            </p>
            {latestInventory && (
              <p className="mt-1 text-xs text-muted-foreground">
                Inventar {formatDateTime(latestInventory.completedAt ?? latestInventory.createdAt)}
                {latestInventory.status === 'completed' && <> · {inventory_.ids.length} winget-Pakete erkannt{inventory_.truncated ? ' (Liste gekuerzt)' : ''}</>}
                {latestInventory.status === 'failed' && <> · fehlgeschlagen: {latestInventory.error}</>}
                {(latestInventory.status === 'queued' || latestInventory.status === 'running') && <> · laeuft</>}
              </p>
            )}
            {latestCheck && (
              <p className="mt-1 text-xs text-muted-foreground">
                Letzte Pruefung {formatDateTime(latestCheck.completedAt ?? latestCheck.createdAt)}
                {latestCheck.status === 'completed' && <> · {updates.length} Update{updates.length === 1 ? '' : 's'} gefunden{updateCount !== updates.length ? `, ${updateCount} dem Inventar zugeordnet` : ''}</>}
                {latestCheck.status === 'failed' && <> · fehlgeschlagen: {latestCheck.error}</>}
                {(latestCheck.status === 'queued' || latestCheck.status === 'running') && <> · laeuft</>}
                {latestCheck.status === 'pending_approval' && <> · wartet auf Freigabe</>}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setChecking('winget-inventory')} disabled={!managedDeviceId} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50" title="Welche installierte Software winget kennt; Grundlage fuer Deinstallieren je Zeile">
              Inventar abgleichen
            </button>
            <button onClick={() => setChecking('winget-updates')} disabled={!managedDeviceId} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
              Updates pruefen
            </button>
          </div>
        </div>
        {latestResult && (
          <div className="mt-3 border-t pt-3">
            <ScriptResultView result={latestResult} error={null} />
          </div>
        )}
      </section>

      {managedDeviceId && (
        <section className="rounded-lg border p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-medium">Aus dem Basis-Set installieren</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Gaengige Software per winget direkt auf diesem Geraet installieren. Bereits erkannte Programme sind ausgeblendet.</p>
            </div>
            <div className="flex gap-2">
              <select className="rounded-md border bg-background px-2 py-1.5 text-sm" value={pickedBase} onChange={(e) => setPickedBase(e.target.value)} aria-label="Software aus dem Basis-Set">
                <option value="">Software waehlen...</option>
                {baseCandidates.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.id})
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const entry = baseCandidates.find((e) => e.id === pickedBase);
                  if (entry) setTarget({ packageId: entry.id, mode: 'install', displayName: entry.name, installedVersion: null, availableVersion: null });
                }}
                disabled={!pickedBase}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Installieren
              </button>
            </div>
          </div>
        </section>
      )}

      {managedDeviceId && inventory_.ids.length > 0 && (
        <section className="rounded-lg border p-4">
          <h2 className="font-medium">Von winget erkannt, aber keiner Inventarzeile zugeordnet</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Diese Pakete kennt winget auf dem Geraet; im Intune-Inventar fehlen sie noch oder heissen anders. Deinstallieren geht direkt.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {inventory_.ids
              .filter((id) => !rows.some((r) => r.wingetId === id))
              .map((id) => (
                <li key={id} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                  <span className="font-mono">{id}</span>
                  <button onClick={() => setTarget({ packageId: id, mode: 'uninstall', displayName: null, installedVersion: null, availableVersion: null })} className="rounded px-1 text-destructive hover:bg-destructive/10" title="Deinstallieren">
                    Deinstallieren
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>Quellen:</span>
        <span>{inventory.data.intune.available ? `Intune ${inventory.data.intune.data.count} Eintraege` : `Intune nicht verfuegbar (${inventory.data.intune.reason})`}</span>
        <span>·</span>
        <span>{inventory.data.defender.available ? `Defender ${inventory.data.defender.data.count} Eintraege` : `Defender nicht verfuegbar (${inventory.data.defender.reason})`}</span>
        <span>·</span>
        <span>Katalog: {rows.filter((r) => r.catalog).length} zugeordnet</span>
      </div>

      {apps.length === 0 ? (
        <EmptyState title="Noch kein Inventar" description="Weder Intune noch Defender haben fuer dieses Geraet Software gemeldet. Der Intune-Client meldet das Inventar etwa woechentlich; ein Geraete-Sync beschleunigt das." />
      ) : (
        <DataTable rows={rows} columns={columns} getRowId={(a) => a.id} storageKey="device-software" initialSort={{ columnId: 'name', direction: 'asc' }} searchPlaceholder="Software, Version, Hersteller..." exportFileName={`software-${device.name}`} dense />
      )}

      {checking && (
        <JobActionDialog
          title={checking === 'winget-updates' ? 'Software-Updates mit winget pruefen' : 'winget-Inventar abgleichen'}
          description={`Auf ${device.name}.`}
          confirmLabel={checking === 'winget-updates' ? 'Pruefung starten' : 'Abgleich starten'}
          createJob={() => api.post<Job>(`/tenants/${tenantId}/jobs/run-script`, { managedDeviceId, deviceName: device.name, scriptId: checking })}
          renderResult={(job) => <ScriptResultView result={job.result as unknown as ScriptRunResult | null} error={job.error} />}
          onClose={() => setChecking(null)}
          onCompleted={refreshJobs}
        />
      )}
      {target && (
        <WingetInstallDialog
          tenantId={tenantId}
          device={device}
          target={target}
          onClose={() => setTarget(null)}
          onCompleted={() => {
            refreshJobs();
            queryClient.invalidateQueries({ queryKey: ['device-software', tenantId, device.id] });
          }}
        />
      )}
    </div>
  );
}
