'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { NoTenantSelected, NoResults } from '@/components/ui/empty-state';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import clsx from 'clsx';
import type { SyncedUser } from '@zerostress/types';

interface UsersResponse {
  items: SyncedUser[];
  nextPageToken: string | null;
  total: number;
}

export default function UsersPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const [search, setSearch] = useState('');
  const [pageToken, setPageToken] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['users', activeTenant?.id, search, pageToken],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (pageToken) params.set('pageToken', pageToken);
      return api.get<UsersResponse>(
        `/tenants/${activeTenant!.id}/users?${params}`
      );
    },
    enabled: !!activeTenant,
    staleTime: 30 * 1000,
  });

  if (tenantLoading) {
    return <LoadingTable />;
  }

  if (!activeTenant) {
    return <NoTenantSelected />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Benutzer</h1>
        <div className="flex items-center gap-2">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPageToken(null);
            }}
          />
        </div>
      </div>

      {isLoading ? (
        <LoadingTable rows={10} />
      ) : error ? (
        <ErrorState error={error as Error} onRetry={refetch} />
      ) : !data?.items.length ? (
        <NoResults query={search} />
      ) : (
        <>
          <UserTable users={data.items} />
          <Pagination
            hasNext={!!data.nextPageToken}
            onNext={() => setPageToken(data.nextPageToken)}
            onPrev={() => setPageToken(null)}
            hasPrev={!!pageToken}
          />
        </>
      )}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <input
        type="search"
        placeholder="Benutzer suchen..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          'h-9 w-64 rounded-md border bg-background px-3 pl-9 text-sm',
          'placeholder:text-muted-foreground',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        )}
      />
      <svg
        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </div>
  );
}

function UserTable({ users }: { users: SyncedUser[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Anzeigename</th>
            <th className="px-4 py-3 text-left font-medium">E-Mail</th>
            <th className="px-4 py-3 text-left font-medium">Typ</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b last:border-0">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <UserAvatar name={user.displayName} />
                  <span className="font-medium">{user.displayName}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {user.mail ?? user.userPrincipalName}
              </td>
              <td className="px-4 py-3">
                <span
                  className={clsx(
                    'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                    user.userType === 'Member'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {user.userType}
                </span>
              </td>
              <td className="px-4 py-3">
                <span
                  className={clsx(
                    'inline-flex items-center gap-1.5 text-xs',
                    user.accountEnabled
                      ? 'text-success'
                      : 'text-muted-foreground'
                  )}
                >
                  <span
                    className={clsx(
                      'h-1.5 w-1.5 rounded-full',
                      user.accountEnabled ? 'bg-success' : 'bg-muted-foreground'
                    )}
                  />
                  {user.accountEnabled ? 'Aktiv' : 'Deaktiviert'}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  className={clsx(
                    'rounded px-2 py-1 text-xs',
                    'hover:bg-accent',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                  )}
                >
                  Bearbeiten
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
      {initials}
    </div>
  );
}

function Pagination({
  hasNext,
  hasPrev,
  onNext,
  onPrev,
}: {
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={onPrev}
        disabled={!hasPrev}
        className={clsx(
          'rounded-md border px-3 py-1.5 text-sm',
          hasPrev ? 'hover:bg-accent' : 'cursor-not-allowed opacity-50'
        )}
      >
        Zurueck
      </button>
      <button
        onClick={onNext}
        disabled={!hasNext}
        className={clsx(
          'rounded-md border px-3 py-1.5 text-sm',
          hasNext ? 'hover:bg-accent' : 'cursor-not-allowed opacity-50'
        )}
      >
        Weiter
      </button>
    </div>
  );
}
