'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { ErrorBanner } from '@/components/ui/error-state';
import type { UserSession } from '@zerostress/types';

interface SessionListProps {
  hostPoolResourceId: string;
  sessionHostName: string;
  hostPoolName: string;
}

interface SessionsResponse {
  items: UserSession[];
}

const sessionStateColors: Record<string, string> = {
  Active: 'bg-success text-success-foreground',
  Disconnected: 'bg-warning text-warning-foreground',
  Pending: 'bg-accent text-accent-foreground',
  LogOff: 'bg-muted text-muted-foreground',
};

const sessionStateLabels: Record<string, string> = {
  Active: 'Aktiv',
  Disconnected: 'Getrennt',
  Pending: 'Ausstehend',
  LogOff: 'Abmeldung',
};

interface SendMessageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  session: UserSession;
  hostPoolResourceId: string;
  sessionHostName: string;
  hostPoolName: string;
}

function SendMessageDialog({
  isOpen,
  onClose,
  session,
  hostPoolResourceId,
  sessionHostName,
  hostPoolName,
}: SendMessageDialogProps) {
  const { activeTenant } = useTenant();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTenant || !title || !body) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await api.post(`/tenants/${activeTenant.id}/avd/actions/send-message`, {
        hostPoolId: hostPoolResourceId,
        hostPoolName,
        sessionHostId: `${hostPoolResourceId}/sessionHosts/${sessionHostName}`,
        sessionHostName,
        sessionId: session.id,
        userPrincipalName: session.userPrincipalName,
        messageTitle: title,
        messageBody: body,
      });

      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      onClose();
      setTitle('');
      setBody('');
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-lg">
        <form onSubmit={handleSubmit}>
          <div className="border-b p-4">
            <h2 className="text-lg font-semibold">Nachricht senden</h2>
            <p className="text-sm text-muted-foreground">
              An: {session.userPrincipalName}
            </p>
          </div>
          <div className="space-y-4 p-4">
            <ErrorBanner error={error} onDismiss={() => setError(null)} />
            <div>
              <label className="mb-1 block text-sm font-medium">Titel</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Wartungsarbeiten"
                maxLength={100}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Nachricht</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                rows={4}
                placeholder="Bitte speichern Sie Ihre Arbeit. Der Server wird in 10 Minuten neu gestartet."
                maxLength={1000}
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t p-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
              disabled={isSubmitting}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title || !body}
              className="rounded-md bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Wird gesendet...' : 'Senden'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SessionList({
  hostPoolResourceId,
  sessionHostName,
  hostPoolName,
}: SessionListProps) {
  const { activeTenant } = useTenant();
  const queryClient = useQueryClient();
  const [messageSession, setMessageSession] = useState<UserSession | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const sessionHostId = `${hostPoolResourceId}/sessionHosts/${sessionHostName}`;

  const { data, isLoading, error } = useQuery<SessionsResponse>({
    queryKey: ['userSessions', activeTenant?.id, hostPoolResourceId, sessionHostName],
    queryFn: () =>
      api.get<SessionsResponse>(
        `/tenants/${activeTenant!.id}/avd/host-pools/${encodeURIComponent(hostPoolResourceId)}/session-hosts/${encodeURIComponent(sessionHostName)}/sessions`
      ),
    enabled: !!activeTenant,
    refetchInterval: 15000,
  });

  const disconnectSession = async (session: UserSession) => {
    if (!activeTenant) return;
    setActionError(null);

    try {
      await api.post(`/tenants/${activeTenant.id}/avd/actions/disconnect-session`, {
        hostPoolId: hostPoolResourceId,
        hostPoolName,
        sessionHostId,
        sessionHostName,
        sessionId: session.id,
        userPrincipalName: session.userPrincipalName,
      });

      queryClient.invalidateQueries({ queryKey: ['userSessions'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    } catch (err) {
      setActionError(err as Error);
    }
  };

  const logoffSession = async (session: UserSession) => {
    if (!activeTenant) return;

    if (!confirm(`Benutzer ${session.userPrincipalName} wirklich abmelden?`)) {
      return;
    }

    setActionError(null);
    try {
      await api.post(`/tenants/${activeTenant.id}/avd/actions/logoff-session`, {
        hostPoolId: hostPoolResourceId,
        hostPoolName,
        sessionHostId,
        sessionHostName,
        sessionId: session.id,
        userPrincipalName: session.userPrincipalName,
        force: false,
      });

      queryClient.invalidateQueries({ queryKey: ['userSessions'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    } catch (err) {
      setActionError(err as Error);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Sessions werden geladen...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">Fehler beim Laden der Sessions</p>
      </div>
    );
  }

  if (!data?.items.length) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Keine aktiven Sessions</p>
      </div>
    );
  }

  return (
    <>
      <ErrorBanner error={actionError} onDismiss={() => setActionError(null)} className="mb-2" />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-medium">Benutzer</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Status</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Typ</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Seit</th>
              <th className="px-4 py-2 text-left text-sm font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((session) => {
              const stateColor =
                sessionStateColors[session.sessionState] || 'bg-muted text-muted-foreground';
              const stateLabel =
                sessionStateLabels[session.sessionState] || session.sessionState;

              return (
                <tr key={session.id} className="border-b hover:bg-muted/50">
                  <td className="px-4 py-2">
                    <div>
                      <p className="font-medium">{session.userPrincipalName}</p>
                      {session.activeDirectoryUserName && (
                        <p className="text-xs text-muted-foreground">
                          {session.activeDirectoryUserName}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${stateColor}`}
                    >
                      {stateLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm">{session.applicationType}</td>
                  <td className="px-4 py-2 text-sm text-muted-foreground">
                    {new Date(session.createTime).toLocaleTimeString('de-DE')}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setMessageSession(session)}
                        className="rounded px-2 py-1 text-xs hover:bg-accent"
                        title="Nachricht senden"
                      >
                        Nachricht
                      </button>
                      {session.sessionState === 'Active' && (
                        <button
                          onClick={() => disconnectSession(session)}
                          className="rounded px-2 py-1 text-xs text-warning hover:bg-warning/10"
                          title="Trennen"
                        >
                          Trennen
                        </button>
                      )}
                      <button
                        onClick={() => logoffSession(session)}
                        className="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                        title="Abmelden"
                      >
                        Abmelden
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {messageSession && (
        <SendMessageDialog
          isOpen={true}
          onClose={() => setMessageSession(null)}
          session={messageSession}
          hostPoolResourceId={hostPoolResourceId}
          sessionHostName={sessionHostName}
          hostPoolName={hostPoolName}
        />
      )}
    </>
  );
}
