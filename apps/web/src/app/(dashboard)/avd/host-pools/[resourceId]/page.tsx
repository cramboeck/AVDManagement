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
import Link from 'next/link';
import type {
  SyncedHostPool,
  SyncedSessionHost,
  HostPoolSummary,
} from '@zerostress/types';

interface SessionHostsResponse {
  items: SyncedSessionHost[];
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

interface ActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  host: SyncedSessionHost;
  action: 'start' | 'stop' | 'drain-on' | 'drain-off';
  hostPoolName: string;
  hostPoolResourceId: string;
}

function ActionDialog({
  isOpen,
  onClose,
  host,
  action,
  hostPoolName,
  hostPoolResourceId,
}: ActionDialogProps) {
  const { activeTenant } = useTenant();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const actionLabels = {
    start: 'Session-Host starten',
    stop: 'Session-Host stoppen',
    'drain-on': 'Drain-Modus aktivieren',
    'drain-off': 'Drain-Modus deaktivieren',
  };

  const actionEndpoints = {
    start: 'start-session-host',
    stop: 'stop-session-host',
    'drain-on': 'set-drain-mode',
    'drain-off': 'set-drain-mode',
  };

  const handleSubmit = async () => {
    if (!activeTenant) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const endpoint = actionEndpoints[action];
      const payload: Record<string, unknown> = {
        hostPoolId: hostPoolResourceId,
        hostPoolName,
        sessionHostId: host.id,
        sessionHostName: host.name,
      };

      if (action === 'start' || action === 'stop') {
        payload.vmResourceId = host.vmResourceId;
      }

      if (action === 'drain-on' || action === 'drain-off') {
        payload.allowNewSession = action === 'drain-off';
      }

      await api.post(`/tenants/${activeTenant.id}/avd/actions/${endpoint}`, payload);

      queryClient.invalidateQueries({ queryKey: ['sessionHosts'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="w-full max-w-md rounded-lg border bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
      >
        <div className="border-b p-4">
          <h2 className="text-lg font-semibold">{actionLabels[action]}</h2>
        </div>
        <div className="space-y-3 p-4">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          <p className="text-sm text-muted-foreground">
            {action === 'start' && (
              <>Die VM <strong>{host.name}</strong> wird gestartet. Dies kann bis zu 2 Minuten dauern.</>
            )}
            {action === 'stop' && (
              <>Die VM <strong>{host.name}</strong> wird heruntergefahren.
              {host.sessions > 0 && (
                <span className="text-destructive"> Achtung: {host.sessions} aktive Session(s) werden beendet!</span>
              )}
              </>
            )}
            {action === 'drain-on' && (
              <>Drain-Modus wird fuer <strong>{host.name}</strong> aktiviert. Neue Verbindungen werden blockiert.</>
            )}
            {action === 'drain-off' && (
              <>Drain-Modus wird fuer <strong>{host.name}</strong> deaktiviert. Neue Verbindungen sind wieder moeglich.</>
            )}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            disabled={isSubmitting}
          >
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`rounded-md px-4 py-2 text-sm text-white ${
              action === 'stop' ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {isSubmitting ? 'Wird ausgefuehrt...' : actionLabels[action]}
          </button>
        </div>
      </div>
    </div>
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

function BulkActionBar({
  selectedCount,
  hosts,
  selectedIds,
  hostPoolName,
  hostPoolResourceId,
  onClearSelection,
}: BulkActionBarProps) {
  const { activeTenant } = useTenant();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const selectedHosts = hosts.filter((h) => selectedIds.has(h.id));
  const canStartAny = selectedHosts.some(
    (h) => h.status === 'Shutdown' || h.status === 'Unavailable'
  );
  const canStopAny = selectedHosts.some(
    (h) => h.status === 'Available' || h.status === 'Disconnected'
  );
  const canDrainAny = selectedHosts.some(
    (h) => h.status === 'Available' && h.allowNewSession
  );

  const executeBulkAction = async (
    action: 'start' | 'stop' | 'drain-on',
    filterFn: (h: SyncedSessionHost) => boolean
  ) => {
    if (!activeTenant) return;
    setIsSubmitting(true);
    setError(null);

    const hostsToProcess = selectedHosts.filter(filterFn);
    const endpoint =
      action === 'start'
        ? 'start-session-host'
        : action === 'stop'
          ? 'stop-session-host'
          : 'set-drain-mode';

    try {
      await Promise.all(
        hostsToProcess.map(async (host) => {
          const payload: Record<string, unknown> = {
            hostPoolId: hostPoolResourceId,
            hostPoolName,
            sessionHostId: host.id,
            sessionHostName: host.name,
          };

          if (action === 'start' || action === 'stop') {
            payload.vmResourceId = host.vmResourceId;
          }
          if (action === 'drain-on') {
            payload.allowNewSession = false;
          }

          await api.post(`/tenants/${activeTenant.id}/avd/actions/${endpoint}`, payload);
        })
      );

      queryClient.invalidateQueries({ queryKey: ['sessionHosts'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      onClearSelection();
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
    <ErrorBanner error={error} onDismiss={() => setError(null)} />
    <div className="flex items-center gap-4 rounded-lg border bg-accent/50 px-4 py-2">
      <span className="text-sm font-medium">{selectedCount} ausgewaehlt</span>
      <div className="flex gap-2">
        {canStartAny && (
          <button
            onClick={() =>
              executeBulkAction(
                'start',
                (h) => h.status === 'Shutdown' || h.status === 'Unavailable'
              )
            }
            disabled={isSubmitting}
            className="rounded-md bg-primary px-3 py-1 text-xs text-white hover:bg-primary/90 disabled:opacity-50"
          >
            Alle starten
          </button>
        )}
        {canStopAny && (
          <button
            onClick={() =>
              executeBulkAction(
                'stop',
                (h) => h.status === 'Available' || h.status === 'Disconnected'
              )
            }
            disabled={isSubmitting}
            className="rounded-md bg-destructive px-3 py-1 text-xs text-white hover:bg-destructive/90 disabled:opacity-50"
          >
            Alle stoppen
          </button>
        )}
        {canDrainAny && (
          <button
            onClick={() =>
              executeBulkAction(
                'drain-on',
                (h) => h.status === 'Available' && h.allowNewSession
              )
            }
            disabled={isSubmitting}
            className="rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            Drain aktivieren
          </button>
        )}
      </div>
      <button
        onClick={onClearSelection}
        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
      >
        Auswahl aufheben
      </button>
    </div>
    </div>
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
  const [selectedAction, setSelectedAction] = useState<'start' | 'stop' | 'drain-on' | 'drain-off' | null>(null);
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

  const summaryQuery = useQuery<HostPoolSummary>({
    queryKey: ['hostPoolSummary', activeTenant?.id, resourceId],
    queryFn: () =>
      api.get<HostPoolSummary>(
        `/tenants/${activeTenant!.id}/avd/host-pools/${encodeURIComponent(resourceId)}/summary`
      ),
    enabled: !!activeTenant,
    refetchInterval: 30000,
  });

  const handleAction = (host: SyncedSessionHost, action: 'start' | 'stop' | 'drain-on' | 'drain-off') => {
    setSelectedHost(host);
    setSelectedAction(action);
  };

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;

  const pool = poolQuery.data;
  const summary = summaryQuery.data;

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
          isOpen={true}
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
