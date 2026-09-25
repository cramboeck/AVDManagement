'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/hooks/use-tenant';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected } from '@/components/ui/empty-state';
import Link from 'next/link';
import type {
  SyncedHostPool,
  SyncedSessionHost,
  HostPoolSummary,
  Job,
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
}

function ActionDialog({ isOpen, onClose, host, action, hostPoolName }: ActionDialogProps) {
  const { activeTenant } = useTenant();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    try {
      const endpoint = actionEndpoints[action];
      const payload: Record<string, unknown> = {
        hostPoolId: host.hostPoolId,
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

      const res = await fetch(
        `/api/tenants/${activeTenant.id}/avd/actions/${endpoint}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) throw new Error('Action failed');

      queryClient.invalidateQueries({ queryKey: ['sessionHosts'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      onClose();
    } catch (error) {
      console.error('Action failed:', error);
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
        <div className="p-4">
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
  onAction: (host: SyncedSessionHost, action: 'start' | 'stop' | 'drain-on' | 'drain-off') => void;
}

function SessionHostRow({ host, hostPoolName, onAction }: SessionHostRowProps) {
  const status = host.status || 'Unknown';
  const statusColor = statusColors[status] || 'bg-muted text-muted-foreground';
  const statusLabel = statusLabels[status] || status;

  const canStart = status === 'Shutdown' || status === 'Unavailable';
  const canStop = status === 'Available' || status === 'Disconnected';
  const isDrainMode = !host.allowNewSession;

  return (
    <tr className="border-b hover:bg-muted/50">
      <td className="px-4 py-3">
        <div>
          <p className="font-medium">{host.name}</p>
          {host.assignedUser && (
            <p className="text-xs text-muted-foreground">{host.assignedUser}</p>
          )}
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
        <span className={host.sessions > 0 ? 'font-medium' : 'text-muted-foreground'}>
          {host.sessions}
        </span>
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
        </div>
      </td>
    </tr>
  );
}

export default function HostPoolDetailPage({
  params,
}: {
  params: { resourceId: string };
}) {
  const resourceId = '/' + decodeURIComponent(params.resourceId);
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const [selectedHost, setSelectedHost] = useState<SyncedSessionHost | null>(null);
  const [selectedAction, setSelectedAction] = useState<'start' | 'stop' | 'drain-on' | 'drain-off' | null>(null);

  const poolQuery = useQuery<SyncedHostPool>({
    queryKey: ['hostPool', activeTenant?.id, resourceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/tenants/${activeTenant!.id}/avd/host-pools/${encodeURIComponent(resourceId)}`
      );
      if (!res.ok) throw new Error('Failed to load host pool');
      return res.json();
    },
    enabled: !!activeTenant,
  });

  const hostsQuery = useQuery<SessionHostsResponse>({
    queryKey: ['sessionHosts', activeTenant?.id, resourceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/tenants/${activeTenant!.id}/avd/host-pools/${encodeURIComponent(resourceId)}/session-hosts`
      );
      if (!res.ok) throw new Error('Failed to load session hosts');
      return res.json();
    },
    enabled: !!activeTenant,
    refetchInterval: 30000,
  });

  const summaryQuery = useQuery<HostPoolSummary>({
    queryKey: ['hostPoolSummary', activeTenant?.id, resourceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/tenants/${activeTenant!.id}/avd/host-pools/${encodeURIComponent(resourceId)}/summary`
      );
      if (!res.ok) throw new Error('Failed to load summary');
      return res.json();
    },
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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full">
          <thead className="border-b bg-muted/50">
            <tr>
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
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Laden...
                </td>
              </tr>
            ) : hostsQuery.error ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-destructive">
                  Fehler beim Laden
                </td>
              </tr>
            ) : !hostsQuery.data?.items.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Keine Session Hosts gefunden
                </td>
              </tr>
            ) : (
              hostsQuery.data.items.map((host) => (
                <SessionHostRow
                  key={host.id}
                  host={host}
                  hostPoolName={pool?.name || ''}
                  onAction={handleAction}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

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
        />
      )}
    </div>
  );
}
