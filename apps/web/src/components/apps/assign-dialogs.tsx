'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { LoadingSpinner } from '@/components/ui/loading';
import { intentLabels } from '@/components/apps/app-badges';
import type { AppAssignmentIntent, AppAssignmentTargetType, GroupInventory, GroupSummary, IntuneApp, Job } from '@zerostress/types';

interface DialogProps {
  tenantId: string;
  app: IntuneApp;
  onClose: () => void;
  onCompleted: () => void;
}

function Shell({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <div className="border-b px-4 py-3">
          <h2 id="app-dialog-title" className="font-medium">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="space-y-4 p-4">{children}</div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">{footer}</div>
      </div>
    </div>
  );
}

const intents: AppAssignmentIntent[] = ['required', 'available', 'uninstall'];

/**
 * Zuweisung waehlen: Ziel (Gruppe aus dem Snapshot, alle Benutzer, alle Geraete) und Absicht.
 * Preview und Ausfuehrung uebernimmt der Job.
 */
export function AssignAppDialog({ tenantId, app, onClose, onCompleted }: DialogProps) {
  const [targetType, setTargetType] = useState<AppAssignmentTargetType>('group');
  const [intent, setIntent] = useState<AppAssignmentIntent>('required');
  const [groupId, setGroupId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const groups = useQuery({
    queryKey: ['groups', tenantId],
    queryFn: () => api.get<GroupInventory>(`/tenants/${tenantId}/groups`),
    staleTime: 5 * 60 * 1000,
  });

  const candidates: GroupSummary[] = useMemo(() => {
    if (!groups.data?.available) return [];
    const q = search.trim().toLowerCase();
    return groups.data.data.items.filter((g) => g.kind !== 'distribution' && (!q || g.displayName.toLowerCase().includes(q))).slice(0, 50);
  }, [groups.data, search]);

  const selected = candidates.find((g) => g.id === groupId) ?? null;
  const needsGroup = targetType === 'group' || targetType === 'exclusionGroup';
  const valid = !needsGroup || !!groupId;

  if (submitted) {
    return (
      <JobActionDialog
        title={`${app.displayName} zuweisen`}
        description={`${intentLabels[intent]} fuer ${needsGroup ? (selected?.displayName ?? groupId) : targetType === 'allUsers' ? 'alle Benutzer' : 'alle Geraete'}.`}
        confirmLabel="Zuweisen"
        tone={intent === 'uninstall' ? 'destructive' : 'default'}
        createJob={() =>
          api.post<Job>(`/tenants/${tenantId}/apps/${encodeURIComponent(app.id)}/assign`, {
            appName: app.displayName,
            intent,
            targetType,
            groupId: needsGroup ? groupId : null,
          })
        }
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );
  }

  return (
    <Shell
      title={`${app.displayName} zuweisen`}
      subtitle="Bestehende Zuweisungen bleiben erhalten; dieselbe Gruppe wird ersetzt. Die Vorschau zeigt Vorher und Nachher."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button onClick={() => setSubmitted(true)} disabled={!valid} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
            Weiter zur Vorschau
          </button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Absicht</legend>
        <div className="flex flex-wrap gap-2">
          {intents.map((i) => (
            <button
              key={i}
              onClick={() => setIntent(i)}
              aria-pressed={intent === i}
              className={clsx('rounded-full border px-3 py-1 text-xs', intent === i ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}
            >
              {intentLabels[i]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Ziel</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['group', 'Gruppe'],
              ['exclusionGroup', 'Gruppe ausschliessen'],
              ['allUsers', 'Alle Benutzer'],
              ['allDevices', 'Alle Geraete'],
            ] as [AppAssignmentTargetType, string][]
          ).map(([t, label]) => (
            <button key={t} onClick={() => setTargetType(t)} aria-pressed={targetType === t} className={clsx('rounded-full border px-3 py-1 text-xs', targetType === t ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {needsGroup && (
        <div>
          <label htmlFor="assign-group-search" className="mb-1 block text-sm font-medium">
            Gruppe
          </label>
          <input
            id="assign-group-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Gruppe suchen..."
            className="mb-2 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {groups.isLoading && <LoadingSpinner size="sm" />}
          {groups.data && !groups.data.available && <p className="text-sm text-muted-foreground">Gruppen nicht lesbar: {groups.data.reason}</p>}
          <ul className="max-h-56 divide-y overflow-auto rounded-md border" role="listbox" aria-label="Gruppen">
            {candidates.map((g) => (
              <li key={g.id}>
                <button
                  role="option"
                  aria-selected={groupId === g.id}
                  onClick={() => setGroupId(g.id)}
                  className={clsx('flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent', groupId === g.id && 'bg-primary/10')}
                >
                  <span className="truncate">{g.displayName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{g.memberCount ?? '—'} Mitgl.</span>
                </button>
              </li>
            ))}
            {candidates.length === 0 && !groups.isLoading && <li className="px-3 py-2 text-sm text-muted-foreground">Keine Gruppe gefunden.</li>}
          </ul>
        </div>
      )}
    </Shell>
  );
}

/**
 * Drei Bereitstellungsgruppen je App mit Namensvorschau (Muster aus PackageFactory).
 */
export function DeploymentGroupsDialog({ tenantId, app, onClose, onCompleted }: DialogProps) {
  const [prefix, setPrefix] = useState('');
  const [autoAssign, setAutoAssign] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const p = prefix.trim() ? `${prefix.trim()} ` : '';
  const names = [`${p}${app.displayName} - Install (Required)`, `${p}${app.displayName} - Available`, `${p}${app.displayName} - Uninstall`];

  if (submitted) {
    return (
      <JobActionDialog
        title="Bereitstellungsgruppen anlegen"
        description={`Drei Sicherheitsgruppen fuer ${app.displayName}${autoAssign ? ' und Zuweisung mit passender Absicht' : ''}.`}
        confirmLabel="Anlegen"
        createJob={() => api.post<Job>(`/tenants/${tenantId}/apps/${encodeURIComponent(app.id)}/deployment-groups`, { appName: app.displayName, prefix: prefix.trim(), autoAssign })}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );
  }

  return (
    <Shell
      title="Bereitstellungsgruppen anlegen"
      subtitle="Erforderlich, Verfuegbar und Deinstallieren als eigene Sicherheitsgruppen; Mitglieder pflegst du danach in der Gruppe."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button onClick={() => setSubmitted(true)} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Weiter zur Vorschau
          </button>
        </>
      }
    >
      <div>
        <label htmlFor="dg-prefix" className="mb-1 block text-sm font-medium">
          Praefix (optional, z. B. Kundenkuerzel)
        </label>
        <input id="dg-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={30} placeholder="SCI" className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
      </div>
      <ul className="space-y-1 rounded-md border bg-muted/40 p-3 font-mono text-xs">
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
        Gruppen der App sofort mit ihrer Absicht zuweisen
      </label>
    </Shell>
  );
}
