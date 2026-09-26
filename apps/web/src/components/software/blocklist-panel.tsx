'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ErrorBanner } from '@/components/ui/error-state';
import { formatDateTime } from '@/components/identity/sign-in-table';
import type { SoftwareBlockRule } from '@zerostress/types';

const inputClass = 'rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * Sperrliste je MSP: Namensteile oder winget-Ids. Treffer im Inventar
 * eines Tenants erzeugen Alerts ("Gesperrte Software").
 */
export function BlocklistPanel({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'name' | 'winget-id'>('name');
  const [pattern, setPattern] = useState('');
  const [note, setNote] = useState('');
  const rules = useQuery({ queryKey: ['software-blocklist'], queryFn: () => api.get<{ items: SoftwareBlockRule[] }>(`/tenants/${tenantId}/software/blocklist`), staleTime: 60 * 1000 });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['software-blocklist'] });
    queryClient.invalidateQueries({ queryKey: ['software', tenantId] });
  };
  const add = useMutation({
    mutationFn: () => api.post<SoftwareBlockRule>(`/tenants/${tenantId}/software/blocklist`, { kind, pattern: pattern.trim(), note: note.trim() || null }),
    onSuccess: () => {
      setPattern('');
      setNote('');
      invalidate();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete<{ removed: boolean }>(`/tenants/${tenantId}/software/blocklist/${id}`), onSuccess: invalidate });

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Sperrliste</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Unerwuenschte Software fuer alle Tenants dieses MSP. Taucht ein Treffer im Inventar auf, entsteht ein Alert &quot;Gesperrte Software&quot; mit Geraetezahl; Zeilen in der Tabelle sind markiert. Es wird nichts automatisch entfernt.</p>
      </div>
      <ErrorBanner error={(add.error ?? remove.error) as Error | null} onDismiss={() => { add.reset(); remove.reset(); }} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (pattern.trim().length >= 3) add.mutate();
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Art</span>
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as 'name' | 'winget-id')}>
            <option value="name">Name enthaelt</option>
            <option value="winget-id">winget-Id</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Muster</span>
          <input className={inputClass} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={kind === 'name' ? 'z. B. TeamViewer' : 'z. B. Zoom.Zoom'} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Notiz (optional)</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Grund" />
        </label>
        <button type="submit" disabled={pattern.trim().length < 3 || add.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          Sperren
        </button>
      </form>
      {rules.data && rules.data.items.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {rules.data.items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{r.kind === 'name' ? 'Name' : 'winget-Id'}</span> <span className="ml-1 font-medium">{r.pattern}</span>
                {r.note ? <span className="ml-2 text-xs text-muted-foreground">{r.note}</span> : null}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {r.createdByEmail} · {formatDateTime(r.createdAt)}
                <button onClick={() => remove.mutate(r.id)} className="rounded border px-2 py-0.5 hover:bg-accent">
                  Entfernen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {rules.data && rules.data.items.length === 0 && <p className="text-xs text-muted-foreground">Noch keine Regeln.</p>}
    </section>
  );
}
