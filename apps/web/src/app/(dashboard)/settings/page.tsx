'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState, ErrorBanner } from '@/components/ui/error-state';
import type { MspSettings } from '@zerostress/types';

interface SettingsResponse {
  settings: MspSettings;
  jobTypes: Array<{ type: string; displayName: string }>;
}

const inputClass = 'rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * MSP-Einstellungen: Vier-Augen-Prinzip. Speichern nur fuer Owner; die API
 * lehnt andere Rollen ab.
 */
export default function SettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['msp-settings'], queryFn: () => api.get<SettingsResponse>('/settings'), staleTime: 60 * 1000 });
  const [draft, setDraft] = useState<MspSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.settings);
  }, [query.data, draft]);

  const save = useMutation({
    mutationFn: (settings: MspSettings) => api.put<{ settings: MspSettings }>('/settings', settings),
    onSuccess: (data) => {
      setDraft(data.settings);
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['msp-settings'] });
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (query.isLoading || !draft) return <LoadingTable rows={4} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const fe = draft.fourEyes;
  const setFe = (patch: Partial<MspSettings['fourEyes']>) => setDraft({ ...draft, fourEyes: { ...fe, ...patch } });
  const jobTypes = query.data?.jobTypes ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <p className="text-sm text-muted-foreground">Gilt fuer den ganzen MSP. Aenderungen stehen im Audit; speichern koennen nur Owner.</p>
      </div>

      <ErrorBanner error={save.error as Error | null} onDismiss={() => save.reset()} />

      <section className="space-y-4 rounded-lg border p-4">
        <div>
          <h2 className="font-medium">Vier-Augen-Prinzip</h2>
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
            Jobs, die die Schwelle erreichen oder einen gelisteten Typ haben, brauchen nach der ersten Freigabe eine zweite von einer anderen Person. Bis dahin passiert nichts, die Vorschau bleibt vier Stunden gueltig. Das ist die wichtigste Bremse gegen ein kompromittiertes Technikerkonto; fuer einen einzelnen Techniker ist es nicht nutzbar, weil niemand die zweite Freigabe erteilen kann.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={fe.enabled} onChange={(e) => setFe({ enabled: e.target.checked })} />
          Vier-Augen-Prinzip aktiv
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Ab wie vielen betroffenen Objekten (Vorschauzeilen, Geraete einer Sammelaktion, Tenants eines Rollouts); 0 = nie ueber die Anzahl</span>
          <input type="number" min={0} max={10000} className={`${inputClass} w-32`} value={fe.minObjects} onChange={(e) => setFe({ minObjects: Number(e.target.value) })} disabled={!fe.enabled} />
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Jobtypen, die immer eine zweite Freigabe brauchen</span>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {jobTypes.map((j) => (
              <label key={j.type} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  disabled={!fe.enabled}
                  checked={fe.jobTypes.includes(j.type)}
                  onChange={(e) => setFe({ jobTypes: e.target.checked ? [...fe.jobTypes, j.type] : fe.jobTypes.filter((t) => t !== j.type) })}
                />
                <span className="truncate" title={j.type}>
                  {j.displayName} <span className="font-mono text-muted-foreground">{j.type}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => save.mutate(draft)} disabled={save.isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Speichern
          </button>
          {saved && <span className="text-xs text-success">Gespeichert.</span>}
        </div>
      </section>
    </div>
  );
}
