'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LoadingSpinner } from '@/components/ui/loading';
import type { AppManifest, PackageArchitecture, WingetCatalogEntry, WingetResolution } from '@zerostress/types';

const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';

interface WingetSourcePickerProps {
  draft: Partial<AppManifest>;
  locked: boolean;
  onApply: (patch: Partial<AppManifest>) => void;
}

/**
 * winget als Installerquelle: Id aus dem Basis-Set oder von Hand, Version,
 * dann "Aus Katalog laden". Die Aufloesung fuellt Hersteller, Name, Version,
 * Installer und Produktcode ins Manifest.
 */
export function WingetSourcePicker({ draft, locked, onApply }: WingetSourcePickerProps) {
  const [id, setId] = useState(draft.wingetPackageIdentifier ?? '');
  const [version, setVersion] = useState(draft.wingetVersion && draft.wingetVersion !== 'latest' ? draft.wingetVersion : '');
  const [publisher, setPublisher] = useState('');
  const [resolution, setResolution] = useState<WingetResolution | null>(null);

  const baseSet = useQuery({ queryKey: ['winget-base-set'], queryFn: () => api.get<{ items: WingetCatalogEntry[]; githubToken: boolean }>('/packages/winget/base-set'), staleTime: Infinity });
  const browse = useQuery({
    queryKey: ['winget-browse', publisher],
    queryFn: () => api.get<{ items: string[] }>(`/packages/winget/browse?publisher=${encodeURIComponent(publisher.trim())}`),
    enabled: publisher.trim().length >= 2,
    staleTime: 10 * 60 * 1000,
  });
  const resolve = useMutation({
    mutationFn: () => api.post<{ resolution: WingetResolution; manifest: Partial<AppManifest> }>('/packages/winget/resolve', { id: id.trim(), version: version.trim() || null, architecture: (draft.architecture ?? 'x64') as PackageArchitecture }),
    onSuccess: (data) => {
      setResolution(data.resolution);
      onApply({ ...data.manifest, wingetVersion: version.trim() || 'latest' });
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, WingetCatalogEntry[]>();
    for (const e of baseSet.data?.items ?? []) map.set(e.category, [...(map.get(e.category) ?? []), e]);
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [baseSet.data]);

  const current = draft.sourceInstaller ?? resolution?.installer ?? null;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Basis-Set</span>
          <select className={inputClass} disabled={locked} value="" onChange={(e) => e.target.value && setId(e.target.value)}>
            <option value="">Aus dem Basis-Set waehlen...</option>
            {grouped.map(([cat, items]) => (
              <optgroup key={cat} label={cat}>
                {items.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.id}){e.note ? ` - ${e.note}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="mt-0.5 block text-xs text-muted-foreground">Gaengige Software fuer Kunden; setzt nur die Id.</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nach Herausgeber blaettern</span>
          <input className={inputClass} disabled={locked} value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="z. B. Microsoft, Google, Adobe" list="winget-browse-list" />
          <datalist id="winget-browse-list">
            {(browse.data?.items ?? []).map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
          {browse.data && browse.data.items.length > 0 && (
            <select className={`${inputClass} mt-1`} disabled={locked} value="" onChange={(e) => e.target.value && setId(e.target.value)}>
              <option value="">{browse.data.items.length} Pakete von {publisher.trim()}...</option>
              {browse.data.items.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          )}
          {browse.data && browse.data.items.length === 0 && <span className="mt-0.5 block text-xs text-muted-foreground">Kein Herausgeber mit diesem Namen im Katalog (Schreibweise wie in winget).</span>}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">winget-Id</span>
          <input className={inputClass} disabled={locked} value={id} onChange={(e) => setId(e.target.value)} placeholder="7zip.7zip" />
          <span className="mt-0.5 block text-xs text-muted-foreground">Wie in &apos;winget search&apos;: Herausgeber.Paket</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Version</span>
          <input className={inputClass} disabled={locked} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="latest" />
          <span className="mt-0.5 block text-xs text-muted-foreground">leer = neueste</span>
        </label>
        <button type="button" onClick={() => resolve.mutate()} disabled={locked || !id.trim() || resolve.isPending} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50">
          {resolve.isPending && <LoadingSpinner size="sm" />}
          Aus Katalog laden
        </button>
      </div>

      {resolve.error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{(resolve.error as Error).message}</p>}

      {current ? (
        <div className="rounded-md bg-muted/50 p-3 text-xs">
          <p className="font-medium">
            Installer aus dem Katalog: {current.packageIdentifier} {current.version} · {current.installerType} · {current.architecture}
            {current.scope ? ` · ${current.scope}` : ''}
          </p>
          <p className="mt-1 break-all text-muted-foreground">{current.url}</p>
          <p className="text-muted-foreground">
            SHA-256 {current.sha256.slice(0, 16)}… · Datei {current.fileName}
            {current.silentSwitch ? ` · still: ${current.silentSwitch}` : ''}
            {current.productCode ? ` · Produktcode ${current.productCode}` : ''}
            {current.displayName ? ` · Apps und Features: ${current.displayName}` : ''}
          </p>
          {resolution && resolution.availableVersions.length > 1 && <p className="mt-1 text-muted-foreground">Weitere Versionen: {resolution.availableVersions.slice(0, 8).join(', ')}</p>}
          {resolution && resolution.skipped.length > 0 && <p className="mt-1 text-muted-foreground">Nicht gewaehlt: {resolution.skipped.join('; ')}</p>}
          <p className="mt-1 text-muted-foreground">Der Worker laedt den Installer von dieser URL, prueft den Hash und baut ein Win32-Paket mit PSADT-Wrapper und eigener Erkennung.</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Noch nichts geladen. Ohne Katalogaufloesung kann das Paket nicht gespeichert werden.</p>
      )}
      {baseSet.data && !baseSet.data.githubToken && <p className="text-xs text-muted-foreground">Hinweis: ohne GITHUB_TOKEN in der API sind 60 Katalogabfragen je Stunde moeglich.</p>}
    </div>
  );
}
