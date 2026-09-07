'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import clsx from 'clsx';
import type { AuditEntry, AuditOutcome } from '@zerostress/types';

interface AuditResponse {
  items: AuditEntry[];
  nextPageToken: string | null;
}

const outcomeColors: Record<AuditOutcome, string> = {
  success: 'bg-success/10 text-success',
  failure: 'bg-destructive/10 text-destructive',
  partial: 'bg-warning/10 text-warning',
};

const outcomeLabels: Record<AuditOutcome, string> = {
  success: 'Erfolgreich',
  failure: 'Fehlgeschlagen',
  partial: 'Teilweise',
};

export default function AuditPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const [filters, setFilters] = useState({
    action: '',
    outcome: '' as AuditOutcome | '',
    search: '',
  });
  const [pageToken, setPageToken] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['audit', activeTenant?.id, filters, pageToken],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.action) params.set('action', filters.action);
      if (filters.outcome) params.set('outcome', filters.outcome);
      if (filters.search) params.set('search', filters.search);
      if (pageToken) params.set('pageToken', pageToken);
      const queryString = params.toString();
      return api.get<AuditResponse>(
        `/tenants/${activeTenant!.id}/audit${queryString ? `?${queryString}` : ''}`
      );
    },
    enabled: !!activeTenant,
    staleTime: 10 * 1000,
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
        <h1 className="text-2xl font-semibold">Audit-Log</h1>
      </div>

      <AuditFilters filters={filters} onChange={setFilters} />

      {isLoading ? (
        <LoadingTable rows={10} />
      ) : error ? (
        <ErrorState error={error as Error} onRetry={refetch} />
      ) : !data?.items.length ? (
        <EmptyState
          icon={<AuditEmptyIcon className="h-6 w-6" />}
          title="Keine Eintraege"
          description="Es wurden keine Audit-Eintraege gefunden, die deinen Filtern entsprechen."
        />
      ) : (
        <>
          <AuditTable entries={data.items} />
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

function AuditFilters({
  filters,
  onChange,
}: {
  filters: { action: string; outcome: AuditOutcome | ''; search: string };
  onChange: (filters: typeof filters) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        placeholder="Suchen..."
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        className={clsx(
          'h-9 w-64 rounded-md border bg-background px-3 text-sm',
          'placeholder:text-muted-foreground',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        )}
      />

      <select
        value={filters.outcome}
        onChange={(e) =>
          onChange({ ...filters, outcome: e.target.value as AuditOutcome | '' })
        }
        className={clsx(
          'h-9 rounded-md border bg-background px-3 text-sm',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        )}
      >
        <option value="">Alle Ergebnisse</option>
        <option value="success">Erfolgreich</option>
        <option value="failure">Fehlgeschlagen</option>
        <option value="partial">Teilweise</option>
      </select>

      <select
        value={filters.action}
        onChange={(e) => onChange({ ...filters, action: e.target.value })}
        className={clsx(
          'h-9 rounded-md border bg-background px-3 text-sm',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        )}
      >
        <option value="">Alle Aktionen</option>
        <option value="license.assign">Lizenz zuweisen</option>
        <option value="license.remove">Lizenz entfernen</option>
        <option value="user.create">Benutzer erstellen</option>
        <option value="user.update">Benutzer aktualisieren</option>
        <option value="user.disable">Benutzer deaktivieren</option>
      </select>
    </div>
  );
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="w-8 px-4 py-3" />
            <th className="px-4 py-3 text-left font-medium">Zeitpunkt</th>
            <th className="px-4 py-3 text-left font-medium">Aktion</th>
            <th className="px-4 py-3 text-left font-medium">Benutzer</th>
            <th className="px-4 py-3 text-left font-medium">Ziel</th>
            <th className="px-4 py-3 text-left font-medium">Ergebnis</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <>
              <tr
                key={entry.id}
                onClick={() =>
                  setExpandedId(expandedId === entry.id ? null : entry.id)
                }
                className="cursor-pointer border-b hover:bg-accent/50"
              >
                <td className="px-4 py-3">
                  <ChevronIcon
                    className={clsx(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      expandedId === entry.id && 'rotate-90'
                    )}
                  />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDateTime(entry.timestamp)}
                </td>
                <td className="px-4 py-3 font-medium">{entry.action}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {entry.actorEmail}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {entry.targetType}:{entry.targetId.slice(0, 8)}...
                </td>
                <td className="px-4 py-3">
                  <span
                    className={clsx(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                      outcomeColors[entry.outcome]
                    )}
                  >
                    {outcomeLabels[entry.outcome]}
                  </span>
                </td>
              </tr>
              {expandedId === entry.id && (
                <tr key={`${entry.id}-detail`} className="border-b bg-muted/30">
                  <td colSpan={6} className="px-4 py-3">
                    <AuditEntryDetail entry={entry} />
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditEntryDetail({ entry }: { entry: AuditEntry }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-xs text-muted-foreground">Correlation ID</p>
        <p className="font-mono text-xs">{entry.correlationId}</p>
      </div>

      {entry.previousValue && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Vorheriger Wert</p>
          <pre className="max-h-32 overflow-auto rounded bg-background p-2 text-xs">
            {JSON.stringify(entry.previousValue, null, 2)}
          </pre>
        </div>
      )}

      {entry.newValue && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Neuer Wert</p>
          <pre className="max-h-32 overflow-auto rounded bg-background p-2 text-xs">
            {JSON.stringify(entry.newValue, null, 2)}
          </pre>
        </div>
      )}

      {entry.errorMessage && (
        <div className="sm:col-span-2">
          <p className="mb-1 text-xs text-muted-foreground">Fehlermeldung</p>
          <p className="text-sm text-destructive">{entry.errorMessage}</p>
        </div>
      )}
    </div>
  );
}

function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(date));
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

function AuditEmptyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
