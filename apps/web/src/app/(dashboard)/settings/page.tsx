'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useTenant } from '@/hooks/use-tenant';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState, ErrorBanner } from '@/components/ui/error-state';
import type { MspSettings, UserRole } from '@zerostress/types';

interface SettingsResponse {
  settings: MspSettings;
  jobTypes: Array<{ type: string; displayName: string }>;
  me: { id: string; email: string; role: UserRole };
}

interface TeamMember {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  tenantIds: string[];
}

interface WorkerTokenInfo {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const inputClass = 'rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const primaryButton = 'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50';
const secondaryButton = 'rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50';
const ROLES: Array<{ value: UserRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'readonly', label: 'Nur lesen' },
];

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('de-DE') : 'nie';
}

/**
 * MSP-Einstellungen: Vier-Augen-Prinzip, Team mit Tenant-Sichtbarkeit und
 * Worker-Token. Schreibende Aktionen nur fuer Owner; die API lehnt andere
 * Rollen ab, die Oberflaeche blendet die Bedienelemente dann aus.
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
  const me = query.data?.me;
  const isOwner = me?.role === 'owner';

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
          <input type="checkbox" checked={fe.enabled} disabled={!isOwner} onChange={(e) => setFe({ enabled: e.target.checked })} />
          Vier-Augen-Prinzip aktiv
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Ab wie vielen betroffenen Objekten (Vorschauzeilen, Geraete einer Sammelaktion, Tenants eines Rollouts); 0 = nie ueber die Anzahl</span>
          <input type="number" min={0} max={10000} className={`${inputClass} w-32`} value={fe.minObjects} onChange={(e) => setFe({ minObjects: Number(e.target.value) })} disabled={!fe.enabled || !isOwner} />
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Jobtypen, die immer eine zweite Freigabe brauchen</span>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {jobTypes.map((j) => (
              <label key={j.type} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  disabled={!fe.enabled || !isOwner}
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
        {isOwner && (
          <div className="flex items-center gap-3">
            <button onClick={() => save.mutate(draft)} disabled={save.isPending} className={primaryButton}>
              Speichern
            </button>
            {saved && <span className="text-xs text-success">Gespeichert.</span>}
          </div>
        )}
      </section>

      <TeamSection meId={me?.id ?? ''} isOwner={isOwner} />
      <WorkerTokenSection isOwner={isOwner} />
    </div>
  );
}

/**
 * Team: Rolle, Status und Tenant-Sichtbarkeit je Mitglied. Owner sehen
 * immer alle Tenants; fuer andere Rollen zaehlt nur die Zuweisung.
 */
function TeamSection({ meId, isOwner }: { meId: string; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const { tenants } = useTenant();
  const query = useQuery({ queryKey: ['msp-team'], queryFn: () => api.get<{ items: TeamMember[] }>('/settings/team'), staleTime: 30 * 1000 });
  const [editing, setEditing] = useState<TeamMember | null>(null);

  const update = useMutation({
    mutationFn: (input: { userId: string; body: { role?: UserRole; tenantIds?: string[]; isActive?: boolean } }) => api.put<TeamMember>(`/settings/team/${input.userId}`, input.body),
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['msp-team'] });
    },
  });

  if (query.isLoading) return <LoadingTable rows={3} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const members = query.data?.items ?? [];
  const tenantName = (id: string) => tenants.find((t) => t.id === id)?.displayName ?? id;

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Team und Tenant-Sichtbarkeit</h2>
        <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
          Owner sehen alle Tenants. Engineer und Nur-lesen sehen ausschliesslich zugewiesene Tenants; ohne Zuweisung ist die Konsole fuer sie leer. Das begrenzt den Schaden eines kompromittierten Kontos auf die Kunden, die es wirklich betreut. Der letzte Owner bleibt Owner, das eigene Konto laesst sich nicht herabstufen oder deaktivieren.
        </p>
      </div>
      <ErrorBanner error={update.error as Error | null} onDismiss={() => update.reset()} />
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Teammitglieder gefunden.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Mitglied</th>
                <th className="py-1 pr-3 font-medium">Rolle</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Letzte Anmeldung</th>
                <th className="py-1 pr-3 font-medium">Sichtbare Tenants</th>
                {isOwner && <th className="py-1 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="py-2 pr-3">
                    <div>{m.displayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.email}
                      {m.id === meId && ' (du)'}
                    </div>
                  </td>
                  <td className="py-2 pr-3">{ROLES.find((r) => r.value === m.role)?.label ?? m.role}</td>
                  <td className="py-2 pr-3">{m.isActive ? 'aktiv' : <span className="text-warning">deaktiviert</span>}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{formatDate(m.lastLoginAt)}</td>
                  <td className="py-2 pr-3 text-xs">
                    {m.role === 'owner' ? (
                      <span className="text-muted-foreground">alle</span>
                    ) : m.tenantIds.length === 0 ? (
                      <span className="text-warning">keine</span>
                    ) : (
                      <span title={m.tenantIds.map(tenantName).join(', ')}>
                        {m.tenantIds.length} von {tenants.length}
                      </span>
                    )}
                  </td>
                  {isOwner && (
                    <td className="py-2 text-right">
                      <button className={secondaryButton} onClick={() => setEditing(m)} disabled={update.isPending}>
                        Bearbeiten
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <TeamEditor
          member={editing}
          isSelf={editing.id === meId}
          tenants={tenants.map((t) => ({ id: t.id, name: t.displayName }))}
          pending={update.isPending}
          onCancel={() => setEditing(null)}
          onSave={(body) => update.mutate({ userId: editing.id, body })}
        />
      )}
    </section>
  );
}

function TeamEditor({
  member,
  isSelf,
  tenants,
  pending,
  onCancel,
  onSave,
}: {
  member: TeamMember;
  isSelf: boolean;
  tenants: Array<{ id: string; name: string }>;
  pending: boolean;
  onCancel: () => void;
  onSave: (body: { role?: UserRole; tenantIds?: string[]; isActive?: boolean }) => void;
}) {
  const [role, setRole] = useState<UserRole>(member.role);
  const [isActive, setIsActive] = useState(member.isActive);
  const [tenantIds, setTenantIds] = useState<string[]>(member.tenantIds);

  const toggle = (id: string, checked: boolean) => setTenantIds(checked ? [...tenantIds, id] : tenantIds.filter((t) => t !== id));

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3" role="group" aria-label={`Teammitglied ${member.email} bearbeiten`}>
      <div className="text-sm font-medium">{member.email}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Rolle</span>
          <select className={inputClass} value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {isSelf && <span className="mt-1 block text-xs text-muted-foreground">Die eigene Rolle laesst sich nicht aendern.</span>}
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={isActive} disabled={isSelf} onChange={(e) => setIsActive(e.target.checked)} />
          Konto aktiv
        </label>
      </div>
      <div className="text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">
          Sichtbare Tenants {role === 'owner' && '(Owner sehen immer alle; die Zuweisung gilt erst nach einer Herabstufung)'}
        </span>
        {tenants.length === 0 ? (
          <p className="text-xs text-muted-foreground">Noch keine Tenants angebunden.</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {tenants.map((t) => (
              <label key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                <input type="checkbox" checked={tenantIds.includes(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
                <span className="truncate">{t.name}</span>
              </label>
            ))}
          </div>
        )}
        <div className="mt-1 flex gap-2">
          <button type="button" className={secondaryButton} onClick={() => setTenantIds(tenants.map((t) => t.id))}>
            Alle
          </button>
          <button type="button" className={secondaryButton} onClick={() => setTenantIds([])}>
            Keine
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <button className={primaryButton} disabled={pending} onClick={() => onSave({ role, isActive, tenantIds })}>
          Speichern
        </button>
        <button className={secondaryButton} disabled={pending} onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

/**
 * Worker-Token: ein Token je Worker-Installation, der Klartext erscheint nur
 * direkt nach dem Anlegen.
 */
function WorkerTokenSection({ isOwner }: { isOwner: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['worker-tokens'], queryFn: () => api.get<{ items: WorkerTokenInfo[]; envTokenConfigured: boolean }>('/settings/worker-tokens'), staleTime: 30 * 1000 });
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<{ token: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: (name: string) => api.post<{ token: string; info: WorkerTokenInfo }>('/settings/worker-tokens', { label: name }),
    onSuccess: (data) => {
      setFresh({ token: data.token, label: data.info.label });
      setLabel('');
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ['worker-tokens'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (tokenId: string) => api.delete<{ revoked: boolean }>(`/settings/worker-tokens/${tokenId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['worker-tokens'] }),
  });

  if (query.isLoading) return <LoadingTable rows={2} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const items = query.data?.items ?? [];
  const active = items.filter((t) => !t.revokedAt);
  const revoked = items.filter((t) => t.revokedAt);

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Worker-Token</h2>
        <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
          Der Windows-Build-Worker und der Exchange-Worker melden sich mit einem Token an und sehen nur Auftraege dieses MSP. Pro Installation ein eigenes Token, damit sich ein einzelner Worker zurueckziehen laesst, ohne die anderen zu stoeren. Der Klartext wird nur einmal angezeigt; gespeichert ist ein Hash.
        </p>
        {query.data?.envTokenConfigured && (
          <p className="mt-1 text-xs text-warning">
            WORKER_TOKEN ist noch in der Umgebung der API gesetzt. Es gilt nur, solange genau ein MSP existiert. Lege hier ein Token an, trage es beim Worker ein und entferne die Umgebungsvariable.
          </p>
        )}
      </div>
      <ErrorBanner error={(create.error ?? revoke.error) as Error | null} onDismiss={() => { create.reset(); revoke.reset(); }} />

      {fresh && (
        <div className="space-y-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm" role="status">
          <div className="font-medium">Token fuer &quot;{fresh.label}&quot; angelegt. Jetzt kopieren, es wird nicht noch einmal angezeigt.</div>
          <code className="block break-all rounded bg-background px-2 py-1 font-mono text-xs">{fresh.token}</code>
          <div className="flex gap-2">
            <button className={secondaryButton} onClick={copy}>
              {copied ? 'Kopiert' : 'In Zwischenablage'}
            </button>
            <button className={secondaryButton} onClick={() => setFresh(null)}>
              Ausblenden
            </button>
          </div>
        </div>
      )}

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kein aktives Token. Ohne Token koennen Pakete nicht gebaut und Exchange-Auftraege nicht ausgefuehrt werden.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">Bezeichnung</th>
              <th className="py-1 pr-3 font-medium">Angelegt</th>
              <th className="py-1 pr-3 font-medium">Zuletzt benutzt</th>
              {isOwner && <th className="py-1 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {active.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="py-2 pr-3">{t.label}</td>
                <td className="py-2 pr-3 text-xs text-muted-foreground">{formatDate(t.createdAt)}</td>
                <td className="py-2 pr-3 text-xs text-muted-foreground">{formatDate(t.lastUsedAt)}</td>
                {isOwner && (
                  <td className="py-2 text-right">
                    <button
                      className={secondaryButton}
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (window.confirm(`Token "${t.label}" widerrufen? Der Worker kann sich danach nicht mehr anmelden.`)) revoke.mutate(t.id);
                      }}
                    >
                      Widerrufen
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {revoked.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {revoked.length} widerrufene{revoked.length === 1 ? 's' : ''} Token: {revoked.map((t) => t.label).join(', ')}
        </p>
      )}

      {isOwner && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim().length >= 2) create.mutate(label.trim());
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Bezeichnung, z. B. Hostname des Workers</span>
            <input className={`${inputClass} w-64`} value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} placeholder="build-worker-01" />
          </label>
          <button type="submit" className={primaryButton} disabled={create.isPending || label.trim().length < 2}>
            Token anlegen
          </button>
        </form>
      )}
    </section>
  );
}
