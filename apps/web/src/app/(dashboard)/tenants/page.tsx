'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { AddTenantDialog } from '@/components/add-tenant-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingTable, LoadingSpinner } from '@/components/ui/loading';
import { ErrorState, ErrorBanner } from '@/components/ui/error-state';
import type { ManagedTenant, TenantConnectionStatus, MissingScope } from '@zerostress/types';

interface ConnectionTestResult {
  status: TenantConnectionStatus;
  missingScopes: MissingScope[];
  organizationName: string | null;
  subscriptionCount: number;
  detail: string | null;
}

const statusLabels: Record<TenantConnectionStatus, string> = {
  connected: 'Verbunden',
  'consent-required': 'Consent erforderlich',
  'permissions-insufficient': 'Berechtigungen fehlen',
  error: 'Fehler',
};

const statusClasses: Record<TenantConnectionStatus, string> = {
  connected: 'bg-success/10 text-success',
  'consent-required': 'bg-warning/10 text-warning',
  'permissions-insufficient': 'bg-warning/10 text-warning',
  error: 'bg-destructive/10 text-destructive',
};

const consentErrorMessages: Record<string, string> = {
  'missing-state': 'Der Rueckruf enthielt keinen State. Bitte Consent erneut starten.',
  'invalid-state': 'Der Consent-Link war abgelaufen oder ungueltig (15 Minuten). Bitte erneut starten.',
  'tenant-not-found': 'Der Tenant aus dem Consent-Link existiert nicht mehr.',
  'tenant-mismatch': 'Der Consent wurde in einem anderen Tenant erteilt als registriert. Bitte mit einem Admin des richtigen Tenants anmelden.',
  access_denied: 'Der Consent wurde abgelehnt.',
};

export default function TenantsPage() {
  return (
    <Suspense fallback={<LoadingTable />}>
      <TenantsView />
    </Suspense>
  );
}

function TenantsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { tenants, isLoading, error, refetch, setActiveTenantId } = useTenant();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});
  const [actionError, setActionError] = useState<Error | null>(null);

  const consentParam = searchParams.get('consent');
  const consentReason = searchParams.get('reason');
  const consentStatus = searchParams.get('status');

  const consentMutation = useMutation({
    mutationFn: (tenant: ManagedTenant) =>
      api.get<{ consentUrl: string }>(`/tenants/${tenant.id}/consent-url`),
    onSuccess: ({ consentUrl }) => {
      window.location.assign(consentUrl);
    },
    onError: (err: Error) => setActionError(err),
  });

  const testMutation = useMutation({
    mutationFn: (tenant: ManagedTenant) =>
      api.post<ConnectionTestResult>(`/tenants/${tenant.id}/test-connection`),
    onSuccess: (result, tenant) => {
      setTestResults((prev) => ({ ...prev, [tenant.id]: result }));
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (err: Error) => setActionError(err),
  });

  const dismissConsentBanner = () => router.replace('/tenants');

  if (isLoading) return <LoadingTable />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Kundentenants anbinden, Admin-Consent erteilen und Verbindung pruefen.
          </p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Tenant hinzufuegen
        </button>
      </div>

      {consentParam && (
        <ConsentBanner
          consent={consentParam}
          reason={consentReason}
          status={consentStatus}
          onDismiss={dismissConsentBanner}
        />
      )}

      <ErrorBanner error={actionError} onDismiss={() => setActionError(null)} />

      {tenants.length === 0 ? (
        <EmptyState
          title="Noch kein Tenant angebunden"
          description="Lege den ersten Kundentenant an. Fuer den Start eignet sich dein eigener Partnertenant."
          action={
            <button
              onClick={() => setShowAddDialog(true)}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Ersten Tenant anlegen
            </button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {tenants.map((tenant) => (
            <TenantRow
              key={tenant.id}
              tenant={tenant}
              testResult={testResults[tenant.id]}
              isStartingConsent={consentMutation.isPending && consentMutation.variables?.id === tenant.id}
              isTesting={testMutation.isPending && testMutation.variables?.id === tenant.id}
              onStartConsent={() => consentMutation.mutate(tenant)}
              onTest={() => testMutation.mutate(tenant)}
              onSelect={() => setActiveTenantId(tenant.id)}
            />
          ))}
        </ul>
      )}

      {showAddDialog && (
        <AddTenantDialog
          onClose={() => setShowAddDialog(false)}
          onCreated={(tenant) => {
            setShowAddDialog(false);
            setActiveTenantId(tenant.id);
          }}
        />
      )}
    </div>
  );
}

function TenantRow({
  tenant,
  testResult,
  isStartingConsent,
  isTesting,
  onStartConsent,
  onTest,
  onSelect,
}: {
  tenant: ManagedTenant;
  testResult?: ConnectionTestResult;
  isStartingConsent: boolean;
  isTesting: boolean;
  onStartConsent: () => void;
  onTest: () => void;
  onSelect: () => void;
}) {
  const needsConsent = tenant.connectionStatus !== 'connected';

  return (
    <li className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="truncate font-medium">{tenant.displayName}</h2>
            <span
              className={clsx(
                'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                statusClasses[tenant.connectionStatus]
              )}
            >
              {statusLabels[tenant.connectionStatus]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{tenant.primaryDomain}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{tenant.microsoftTenantId}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {needsConsent && (
            <ActionButton onClick={onStartConsent} pending={isStartingConsent} primary>
              Consent starten
            </ActionButton>
          )}
          <ActionButton onClick={onTest} pending={isTesting}>
            Verbindung testen
          </ActionButton>
          {tenant.connectionStatus === 'connected' && (
            <ActionButton onClick={onSelect}>Als aktiv setzen</ActionButton>
          )}
        </div>
      </div>

      {tenant.missingScopes.length > 0 && (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <p className="font-medium">Eingeschraenkter Zugriff</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {tenant.missingScopes.map((scope) => (
              <li key={scope.scope}>
                <span className="font-mono">{scope.scope}</span>: {scope.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {testResult && (
        <div
          className={clsx(
            'mt-3 rounded-md border px-3 py-2 text-sm',
            testResult.status === 'connected'
              ? 'border-success/30 bg-success/10'
              : 'border-destructive/30 bg-destructive/10'
          )}
          role="status"
        >
          <p className="font-medium">
            Test: {statusLabels[testResult.status]}
            {testResult.organizationName && ` (${testResult.organizationName})`}
          </p>
          <p className="text-xs text-muted-foreground">
            {testResult.status === 'connected'
              ? `Graph erreichbar, ${testResult.subscriptionCount} Azure-Subscription(s) sichtbar.`
              : testResult.detail ?? 'Keine Details verfuegbar.'}
          </p>
        </div>
      )}

      {tenant.lastSyncAt && (
        <p className="mt-3 text-xs text-muted-foreground">
          Zuletzt geprueft: {new Date(tenant.lastSyncAt).toLocaleString('de-DE')}
        </p>
      )}
    </li>
  );
}

function ActionButton({
  children,
  onClick,
  pending = false,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pending?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className={clsx(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        primary
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border hover:bg-accent'
      )}
    >
      {pending && <LoadingSpinner size="sm" className={primary ? 'text-primary-foreground' : undefined} />}
      {children}
    </button>
  );
}

function ConsentBanner({
  consent,
  reason,
  status,
  onDismiss,
}: {
  consent: string;
  reason: string | null;
  status: string | null;
  onDismiss: () => void;
}) {
  let tone: 'success' | 'warning' | 'error' = 'error';
  let message: string;

  if (consent === 'success') {
    tone = 'success';
    message = 'Admin-Consent erteilt. Der Tenant ist verbunden.';
  } else if (consent === 'incomplete') {
    tone = 'warning';
    message = `Consent erteilt, aber die Verbindung ist noch nicht vollstaendig (${
      status ? statusLabels[status as TenantConnectionStatus] ?? status : 'unbekannt'
    }). Details stehen beim Tenant.`;
  } else {
    message = (reason && consentErrorMessages[reason]) ?? `Consent fehlgeschlagen: ${reason ?? 'unbekannter Fehler'}`;
  }

  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-md border px-4 py-3 text-sm',
        tone === 'success' && 'border-success/30 bg-success/10',
        tone === 'warning' && 'border-warning/30 bg-warning/10',
        tone === 'error' && 'border-destructive/30 bg-destructive/10'
      )}
      role="status"
    >
      <p className="flex-1">{message}</p>
      <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground" aria-label="Hinweis schliessen">
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
