'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { LoadingSpinner } from '@/components/ui/loading';
import type { Job, SyncedUser } from '@zerostress/types';

export type MembershipAction = 'add-member' | 'remove-member' | 'add-owner' | 'remove-owner';

const titles: Record<MembershipAction, string> = {
  'add-member': 'Mitglied hinzufuegen',
  'remove-member': 'Mitglied entfernen',
  'add-owner': 'Besitzer hinzufuegen',
  'remove-owner': 'Besitzer entfernen',
};

interface Target {
  objectId: string;
  objectDisplayName: string;
  objectUpn: string | null;
}

interface MembershipJobDialogProps {
  tenantId: string;
  groupId: string;
  groupName: string;
  action: MembershipAction;
  target: Target;
  onClose: () => void;
  onCompleted: () => void;
}

/**
 * Ein Mitgliedschafts-Job mit Vorschau und Freigabe (Ziel steht fest).
 */
export function MembershipJobDialog({ tenantId, groupId, groupName, action, target, onClose, onCompleted }: MembershipJobDialogProps) {
  const destructive = action.startsWith('remove');
  return (
    <JobActionDialog
      title={`${titles[action]}: ${target.objectDisplayName}`}
      description={`Gruppe ${groupName}. Die Vorschau zeigt den Zustand vorher und nachher; die Aenderung steht im Audit.`}
      confirmLabel={destructive ? 'Entfernen' : 'Hinzufuegen'}
      tone={destructive ? 'destructive' : 'default'}
      createJob={() => api.post<Job>(`/tenants/${tenantId}/groups/${encodeURIComponent(groupId)}/${action}`, { groupName, ...target })}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}

interface PickUserDialogProps {
  tenantId: string;
  groupId: string;
  groupName: string;
  action: 'add-member' | 'add-owner';
  excludeIds: string[];
  onClose: () => void;
  onCompleted: () => void;
}

/**
 * Benutzer suchen und als Mitglied oder Besitzer hinzufuegen; danach der Job-Dialog.
 */
export function PickUserDialog({ tenantId, groupId, groupName, action, excludeIds, onClose, onCompleted }: PickUserDialogProps) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Target | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !picked) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, picked]);

  const users = useQuery({
    queryKey: ['users-pick', tenantId, search],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: '25' });
      if (search.trim()) params.set('search', search.trim());
      return api.get<{ items: SyncedUser[] }>(`/tenants/${tenantId}/users?${params}`);
    },
    staleTime: 30 * 1000,
  });

  if (picked) {
    return <MembershipJobDialog tenantId={tenantId} groupId={groupId} groupName={groupName} action={action} target={picked} onClose={onClose} onCompleted={onCompleted} />;
  }

  const candidates = (users.data?.items ?? []).filter((u) => !excludeIds.includes(u.microsoftId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="pick-user-title">
        <div className="border-b px-4 py-3">
          <h2 id="pick-user-title" className="font-medium">
            {titles[action]} in {groupName}
          </h2>
        </div>
        <div className="space-y-3 p-4">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name oder E-Mail suchen..."
            aria-label="Benutzer suchen"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <ul className="max-h-72 divide-y overflow-auto rounded-md border" role="listbox" aria-label="Benutzer">
            {users.isLoading && (
              <li className="px-3 py-2">
                <LoadingSpinner size="sm" />
              </li>
            )}
            {candidates.map((u) => (
              <li key={u.microsoftId}>
                <button
                  role="option"
                  aria-selected={false}
                  onClick={() => setPicked({ objectId: u.microsoftId, objectDisplayName: u.displayName, objectUpn: u.userPrincipalName })}
                  className={clsx('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent', !u.accountEnabled && 'opacity-60')}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{u.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{u.userPrincipalName}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {u.userType === 'Guest' ? 'Gast' : 'Mitglied'}
                    {!u.accountEnabled && ' · deaktiviert'}
                  </span>
                </button>
              </li>
            ))}
            {!users.isLoading && candidates.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Kein passender Benutzer.</li>}
          </ul>
        </div>
        <div className="flex justify-end border-t px-4 py-3">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
