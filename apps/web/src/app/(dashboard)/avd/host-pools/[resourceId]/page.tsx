'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState, ErrorBanner } from '@/components/ui/error-state';
import { NoTenantSelected } from '@/components/ui/empty-state';
import { SessionList } from '@/components/avd/session-list';
import { RunScriptDialog } from '@/components/avd/run-script-dialog';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import Link from 'next/link';
import type {
  Job,
  SyncedHostPool,
  SyncedSessionHost,
  HostPoolSummary,
} from '@zerostress/types';

interface SessionHostsResponse {
  items: SyncedSessionHost[];
  summary?: HostPoolSummary | null;
}

const statusColors: Record<string, string> = {
  Available: 'bg-success text-success-foreground',
  Unavailable: 'bg-destructive text-destructive-foreground',
  Shutdown: 'bg-muted text-muted-foreground',
  Disconnected: 'bg-warning text-warning-foreground',
  Upgrading: 'bg-accent text-accent-foreground',
  NoHeartbeat: 'bg-destructive text-destructive-foreground',
};

const statusLabels: Record<string, string> = {
  Available: 'Verfuegbar',
  Unavailable: 'Nicht verfuegbar',
  Shutdown: 'Heruntergefahren',
  Disconnected: 'Getrennt',
  Upgrading: 'Aktualisierung',
  NoHeartbeat: 'Kein Heartbeat',
};

type HostAction = 'start' | 'stop' | 'drain-on' | 'drain-off';

const actionLabels: Record<HostAction, string> = {
  start: 'Session-Host starten',
  stop: 'Session-Host stoppen',
  'drain-on': 'Drain-Modus aktivieren',
  'drain-off': 'Drain-Modus deaktivieren',
};

interface ActionDialogProps {
  onClose: () => void;
  host: SyncedSessionHost;
  action: HostAction;
  hostPoolName: string;
  hostPoolResourceId: string;
}

/**
 * Einzelaktion auf einem Host als Job mit Vorschau und Freigabe. Die VM
 * bestimmt die API aus dem Hostpool; der Browser schickt keine VM-Id mit.
 */
function ActionDialog({ onClose, host, action, hostPoolName, hostPoolResourceId }: ActionDialogProps) {
  const { activeTenant } = useTenant();
  const queryClient = useQueryClient();
  const endpoint = action === 'start' ? 'start-session-host' : action === 'stop' ? 'stop-session-host' : 'set-drain-mode';
  const payload: Record<string, unknown> = {
    hostPoolId: hostPoolResourceId,
    hostPoolName,
    sessionHostId: host.id,
    sessionHostName: host.name,
    ...(action === 'start' || action === 'stop' ? { vmResourceId: host.vmResourceId ?? '' } : {}),
    ...(action === 'drain-on' || action === 'drain-off' ? { allowNewSession: action === 'drain-off' } : {}),
  };
  return (
    <JobActionDialog
      title={`${actionLabels[action]}: ${host.name}`}
      confirmLabel={actionLabels[action]}
      tone={action === 'stop' ? 'destructive' : 'default'}
      createJob={() => api.post<Job>(`/tenants/${activeTenant!.id}/avd/actions/${endpoint}`, payload)}
      onClose={onClose}
      onCompleted={() => queryClient.invalidateQueries({ queryKey: ['sessionHosts'] })}
    />
  );
}

interface SessionHostRowProps {
  host: SyncedSessionHost;
  hostPoolName: string;
  hostPoolResourceId: string;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: (hostId: string) => void;
  onToggleExpand: (hostId: string) => void;
  onAction: (host: SyncedSessionHost, action: 'start' | 'stop' | 'drain-on' | 'drain-off') => void;
  onRunScript: (host: SyncedSessionHost) => void;
}

function SessionHostRow({
  host,
  hostPoolName,
  hostPoolResourceId,
  isSelected,
  isExpanded,
  onSelect,
  onToggleExpand,
  onAction,
  onRunScript,
}: SessionHostRowProps) {
  const status = host.status || 'Unknown';
  const statusColor = statusColors[status] || 'bg-muted text-muted-foreground';
  const statusLabel = statusLabels[status] || status;

  const canStart = status === 'Shutdown' || status === 'Unavailable';
  const canStop = status === 'Available' || status === 'Disconnected';
  const isDrainMode = !host.allowNewSession;

  return (
    <>
      <tr className="border-b hover:bg-muted/50">
        <td className="px-4 py-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect(host.id)}
            className="h-4 w-4 rounded border-gray-300"
          />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleExpand(host.id)}
              className="rounded p-0.5 hover:bg-accent"
              title={isExpanded ? 'Sessions ausblenden' : 'Sessions anzeigen'}
            >
              <svg
                className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <div>
              <p className="font-medium">{host.name}</p>
              {host.assignedUser && (
                <p className="text-xs text-muted-foreground">{host.assignedUser}</p>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
            {statusLabel}
          </span>
          {isDrainMode && status === 'Available' && (
            <span className="ml-2 inline-flex rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
              Drain
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          <button
            onClick={() => host.sessions > 0 && onToggleExpand(host.id)}
            className={`${host.sessions > 0 ? 'cursor-pointer font-medium underline-offset-2 hover:underline' : 'cursor-default text-muted-foreground'}`}
            disabled={host.sessions === 0}
          >
            {host.sessions}
          </button>
        </td>
        <td className="px-4 py-3">
          {host.lastHeartbeat ? (
            <span className="text-sm text-muted-foreground">
              {new Date(host.lastHeartbeat).toLocaleTimeString('de-DE')}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-1">
            {canStart && (
              <button
                onClick={() => onAction(host, 'start')}
                className="rounded px-2 py-1 text-xs hover:bg-accent"
                title="Starten"
              >
                Start
              </button>
            )}
            {canStop && (
              <button
                onClick={() => onAction(host, 'stop')}
                className="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                title="Stoppen"
              >
                Stop
              </button>
            )}
            {status === 'Available' && !isDrainMode && (
              <button
                onClick={() => onAction(host, 'drain-on')}
                className="rounded px-2 py-1 text-xs hover:bg-accent"
                title="Drain aktivieren"
              >
                Drain
              </button>
            )}
            {status === 'Available' && isDrainMode && (
              <button
                onClick={() => onAction(host, 'drain-off')}
                className="rounded px-2 py-1 text-xs text-warning hover:bg-warning/10"
                title="Drain deaktivieren"
              >
                Drain aus
              </button>
            )}
            {host.vmResourceId && canStop && (
              <button
                onClick={() => onRunScript(host)}
                className="rounded px-2 py-1 text-xs hover:bg-accent"
                title="Bibliotheksskript ueber Azure Run Command ausfuehren"
              >
                Skript
              </button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b bg-muted/30">
          <td colSpan={6} className="px-8 py-4">
            <SessionList
              hostPoolResourceId={hostPoolResourceId}
              sessionHostName={host.name}
              hostPoolName={hostPoolName}
            />
          </td>
        </tr>
      )}
    </>
  );
}

interface BulkActionBarProps {
  selectedCount: number;
  hosts: SyncedSessionHost[];
  selectedIds: Set<string>;
  hostPoolName: string;
  hostPoolResourceId: string;
  onClearSelection: () => void;
}

const bulkFilters: Record<HostAction, (h: SyncedSessionHost) => boolean> = {
  start: (h) => h.status === 'Shutdown' || h.status === 'Unavailable',
  stop: (h) => h.status === 'Available' || h.status === 'Disconnected',
  'drain-on': (h) => h.allowNewSession,
  'drain-off': (h) => !h.allowNewSession,
};

const bulkLabels: Record<HostAction, string> = { start: 'Alle starten', stop: 'Alle stoppen', 'drain-on': 'Drain aktivieren', 'drain-off': 'Drain aufheben' };

/**
 * Sammelaktion: ein Job fuer alle passenden Hosts, eine gemeinsame Vorschau
 * und ein Ergebnis je Host (statt vieler Einzeljobs ohne Uebersicht).
 */
function BulkActionBar({ selectedCount, hosts, selectedIds, hostPoolName, hostPoolResourceId, onClearSelection }: BulkActionBarProps) {
  const { activeTenant } = useTenant();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<HostAction | null>(null);
  const selectedHosts = hosts.filter((h) => selectedIds.has(h.id));
  const targets = action ? selectedHosts.filter(bulkFilters[action]) : [];

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-accent/50 px-4 py-2">
      <span className="text-sm font-medium">{selectedCount} ausgewaehlt</span>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(bulkLabels) as HostAction[]).map((a) => {
          const count = selectedHosts.filter(bulkFilters[a]).length;
          if (count === 0) return null;
          return (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={
                a === 'stop'
                  ? 'rounded-md bg-destructive px-3 py-1 text-xs text-white hover:bg-destructive/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive'
                  : a === 'start'
                    ? 'rounded-md bg-primary px-3 py-1 text-xs text-white hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                    : 'rounded-md border px-3 py-1 text-xs hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
              }
            >
              {bulkLabels[a]} ({count})
            </button>
          );
        })}
      </div>
      <button onClick={onClearSelection} className="ml-auto text-xs text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        Auswahl aufheben
      </button>
      {action && targets.length > 0 && (
        <JobActionDialog
          title={`${bulkLabels[action]}: ${targets.length} Hosts in ${hostPoolName}`}
          description="Ein Job, eine Vorschau fuer alle Hosts; das Ergebnis steht je Host im Job."
          confirmLabel={bulkLabels[action]}
          tone={action === 'stop' ? 'destructive' : 'default'}
          createJob={() =>
            api.post<Job>(`/tenants/${activeTenant!.id}/avd/actions/bulk`, {
              hostPoolId: hostPoolResourceId,
              hostPoolName,
              action,
              hosts: targets.map((h) => ({ sessionHostId: h.id, sessionHostName: h.name })),
            })
          }
          renderResult={(job) => <BulkHostResult job={job} />}
          onClose={() => setAction(null)}
          onCompleted={() => {
            queryClient.invalidateQueries({ queryKey: ['sessionHosts'] });
            onClearSelection();
          }}
        />
      )}
    </div>
  );
}

function BulkHostResult({ job }: { job: Job }) {
  const outcomes = (job.result as { outcomes?: Array<{ sessionHostName: string; success: boolean; message: string | null }> } | null)?.outcomes ?? [];
  if (outcomes.length === 0) return <p className="text-sm text-muted-foreground">{job.error ?? 'Kein Ergebnis.'}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {outcomes.map((o) => (
        <li key={o.sessionHostName} className="flex justify-between gap-3">
          <span>{o.sessionHostName}</span>
          <span className={o.success ? 'text-success' : 'text-destructive'}>{o.success ? 'ok' : o.message ?? 'fehlgeschlagen'}</span>
        </li>
      ))}
    </ul>
  );
}

export default function HostPoolDetailPage({
  params,
}: {
  params: { resourceId: string };
}) {
  // Die Liste verlinkt die vollstaendige ARM-Resource-ID URL-kodiert als ein Segment
  const resourceId = decodeURIComponent(params.resourceId);
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const [selectedHost, setSelectedHost] = useState<SyncedSessionHost | null>(null);
  const [selectedAction, setSelectedAction] = useState<HostAction | null>(null);
  const [scriptHost, setScriptHost] = useState<SyncedSessionHost | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleSelection = (hostId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) {
        next.delete(hostId);
      } else {
        next.add(hostId);
      }
      return next;
    });
  };

  const toggleExpand = (hostId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) {
        next.delete(hostId);
      } else {
        next.add(hostId);
      }
      return next;
    });
  };

  const toggleSelectAll = (hosts: SyncedSessionHost[]) => {
    if (selectedIds.size === hosts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(hosts.map((h) => h.id)));
    }
  };

  const poolQuery = useQuery<SyncedHostPool>({
    queryKey: ['hostPool', activeTenant?.id, resourceId],
    queryFn: () =>
      api.get<SyncedHostPool>(
        `/tenants/${activeTenant!.id}/avd/host-pools/${encodeURIComponent(resourceId)}`
      ),
    enabled: !!activeTenant,
  });

  const hostsQuery = useQuery<SessionHostsResponse>({
    queryKey: ['sessionHosts', activeTenant?.id, resourceId],
    queryFn: () =>
      api.get<SessionHostsResponse>(
        `/tenants/${activeTenant!.id}/avd/host-pools/${encodeURIComponent(resourceId)}/session-hosts`
      ),
    enabled: !!activeTenant,
    refetchInterval: 30000,
  });

  // Kennzahlen kommen mit der Hostliste; Einzelabfrage nur als Rueckfall fuer aeltere API-Staende
  const summaryQuery = useQuery<HostPoolSummary>({
    queryKey: ['hostPoolSummary', activeTenant?.id, resourceId],
    queryFn: () =>
      api.get<HostPoolSummary>(
        `/tenants/${activeTenant!.id}/avd/host-pools/${encodeURIComponent(resourceId)}/summary`
      ),
    enabled: !!activeTenant && hostsQuery.isSuccess && hostsQuery.data?.summary === undefined,
  });

  const handleAction = (host: SyncedSessionHost, action: 'start' | 'stop' | 'drain-on' | 'drain-off') => {
    setSelectedHost(host);
    setSelectedAction(action);
  };

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;

  const pool = poolQuery.data;
  const summary = hostsQuery.data?.summary ?? summaryQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/avd" className="text-muted-foreground hover:text-foreground">
          ← Zurueck
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">{pool?.friendlyName || pool?.name || 'Host Pool'}</h1>
          <p className="text-muted-foreground">{pool?.name}</p>
        </div>
      </div>

      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Hosts</p>
            <p className="text-2xl font-semibold">
              {summary.availableHosts} / {summary.totalHosts}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Sessions</p>
            <p className="text-2xl font-semibold">
              {summary.totalSessions} / {summary.maxSessions}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Auslastung</p>
            <p className="text-2xl font-semibold">{summary.utilizationPercent}%</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Probleme</p>
            <p className="text-2xl font-semibold">
              {summary.unavailableHosts > 0 || summary.hostsInDrainMode > 0 ? (
                <span className="text-warning">
                  {summary.unavailableHosts + summary.hostsInDrainMode}
                </span>
              ) : (
                <span className="text-success">0</span>
              )}
            </p>
          </div>
        </div>
      )}

      {selectedIds.size > 0 && hostsQuery.data?.items && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          hosts={hostsQuery.data.items}
          selectedIds={selectedIds}
          hostPoolName={pool?.name || ''}
          hostPoolResourceId={resourceId}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={
                    hostsQuery.data?.items.length
                      ? selectedIds.size === hostsQuery.data.items.length
                      : false
                  }
                  onChange={() =>
                    hostsQuery.data?.items && toggleSelectAll(hostsQuery.data.items)
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium">Name</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
              <th className="px-4 py-3 text-center text-sm font-medium">Sessions</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Heartbeat</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {hostsQuery.isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Laden...
                </td>
              </tr>
            ) : hostsQuery.error ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-destructive">
                  Fehler beim Laden
                </td>
              </tr>
            ) : !hostsQuery.data?.items.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Keine Session Hosts gefunden
                </td>
              </tr>
            ) : (
              hostsQuery.data.items.map((host) => (
                <SessionHostRow
                  key={host.id}
                  host={host}
                  hostPoolName={pool?.name || ''}
                  hostPoolResourceId={resourceId}
                  isSelected={selectedIds.has(host.id)}
                  isExpanded={expandedIds.has(host.id)}
                  onSelect={toggleSelection}
                  onToggleExpand={toggleExpand}
                  onAction={handleAction}
                  onRunScript={setScriptHost}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {scriptHost && activeTenant && (
        <RunScriptDialog
          tenantId={activeTenant.id}
          host={scriptHost}
          hostPoolName={pool?.name || ''}
          hostPoolResourceId={resourceId}
          onClose={() => setScriptHost(null)}
        />
      )}

      {selectedHost && selectedAction && (
        <ActionDialog
          onClose={() => {
            setSelectedHost(null);
            setSelectedAction(null);
          }}
          host={selectedHost}
          action={selectedAction}
          hostPoolName={pool?.name || ''}
          hostPoolResourceId={resourceId}
        />
      )}
    </div>
  );
}
