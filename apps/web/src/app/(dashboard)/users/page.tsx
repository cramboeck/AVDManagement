'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { NoTenantSelected, NoResults } from '@/components/ui/empty-state';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { AssignLicenseDialog } from '@/components/assign-license-dialog';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import clsx from 'clsx';
import type { SyncedUser, Job } from '@zerostress/types';

interface UsersResponse {
  items: SyncedUser[];
  nextPageToken: string | null;
}

export default function UsersPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<SyncedUser | null>(null);
  const [pendingJob, setPendingJob] = useState<Job | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['users', activeTenant?.id, search, pageToken],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: '100' });
      if (search) params.set('search', search);
      if (pageToken) params.set('pageToken', pageToken);
      return api.get<UsersResponse>(`/tenants/${activeTenant!.id}/users?${params}`);
    },
    enabled: !!activeTenant,
    staleTime: 30 * 1000,
  });

  const columns: ColumnDef<SyncedUser>[] = [
    {
      id: 'displayName',
      header: 'Anzeigename',
      accessor: (u) => u.displayName,
      cell: (u) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={u.displayName} />
          <span className="font-medium">{u.displayName}</span>
        </div>
      ),
    },
    { id: 'mail', header: 'E-Mail', accessor: (u) => u.mail ?? u.userPrincipalName, className: 'text-muted-foreground' },
    { id: 'upn', header: 'UPN', accessor: (u) => u.userPrincipalName, defaultHidden: true, className: 'text-muted-foreground' },
    {
      id: 'userType',
      header: 'Typ',
      accessor: (u) => u.userType,
      filterOptions: [
        { value: 'Member', label: 'Mitglied' },
        { value: 'Guest', label: 'Gast' },
      ],
      cell: (u) => (
        <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', u.userType === 'Member' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
          {u.userType === 'Member' ? 'Mitglied' : 'Gast'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (u) => (u.accountEnabled ? 'Aktiv' : 'Deaktiviert'),
      filterOptions: [
        { value: 'Aktiv', label: 'Aktiv' },
        { value: 'Deaktiviert', label: 'Deaktiviert' },
      ],
      cell: (u) => (
        <span className={clsx('inline-flex items-center gap-1.5 text-xs', u.accountEnabled ? 'text-success' : 'text-muted-foreground')}>
          <span className={clsx('h-1.5 w-1.5 rounded-full', u.accountEnabled ? 'bg-success' : 'bg-muted-foreground')} />
          {u.accountEnabled ? 'Aktiv' : 'Deaktiviert'}
        </span>
      ),
    },
    {
      id: 'createdAt',
      header: 'Erstellt',
      accessor: (u) => (u.createdAt ? new Date(u.createdAt) : null),
      cell: (u) => (u.createdAt ? new Date(u.createdAt).toLocaleDateString('de-DE') : '—'),
      defaultHidden: true,
      className: 'text-muted-foreground',
    },
    {
      id: 'actions',
      header: 'Aktionen',
      accessor: () => null,
      sortable: false,
      searchable: false,
      align: 'right',
      cell: (u) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedUser(u);
          }}
          className="rounded px-2 py-1 text-xs hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Lizenz zuweisen
        </button>
      ),
    },
  ];

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Benutzer</h1>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPageToken(null);
          }}
        />
      </div>

      {isLoading ? (
        <LoadingTable rows={10} />
      ) : error ? (
        <ErrorState error={error as Error} onRetry={refetch} />
      ) : !data?.items.length ? (
        <NoResults query={search} />
      ) : (
        <>
          <DataTable
            rows={data.items}
            columns={columns}
            getRowId={(u) => u.id}
            storageKey="users"
            initialSort={{ columnId: 'displayName', direction: 'asc' }}
            initialPageSize={100}
            enableSearch={false}
            onRowClick={(u) => router.push(`/users/${encodeURIComponent(u.microsoftId)}`)}
            exportFileName="benutzer"
          />
          {(data.nextPageToken || pageToken) && (
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setPageToken(null)} disabled={!pageToken} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">
                Erste Seite
              </button>
              <button onClick={() => setPageToken(data.nextPageToken)} disabled={!data.nextPageToken} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">
                Naechste 100
              </button>
            </div>
          )}
        </>
      )}

      {selectedUser && (
        <AssignLicenseDialog
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onSuccess={(job: Job) => {
            setSelectedUser(null);
            setPendingJob(job);
          }}
        />
      )}

      {pendingJob && (
        <JobActionDialog
          title="Lizenz zuweisen"
          confirmLabel="Zuweisen"
          createJob={() => Promise.resolve(pendingJob)}
          onClose={() => setPendingJob(null)}
        />
      )}
    </div>
  );
}

function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onChange(draft.trim());
      }}
      className="relative"
    >
      <input
        type="search"
        placeholder="Im Tenant suchen (Name, E-Mail)..."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Benutzer im Tenant suchen"
        className={clsx(
          'h-9 w-72 rounded-md border bg-background px-3 pl-9 text-sm',
          'placeholder:text-muted-foreground',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        )}
      />
      <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </form>
  );
}

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
      {initials}
    </div>
  );
}
