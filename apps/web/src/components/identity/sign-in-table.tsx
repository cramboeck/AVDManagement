'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import type { SignInEvent } from '@zerostress/types';

const MODERN_CLIENTS = new Set(['Browser', 'Mobile Apps and Desktop clients']);

// Alles ausser Browser und modernen Clients ist Legacy-Authentifizierung (kein MFA moeglich)
export function isLegacyClient(clientAppUsed: string | null): boolean {
  return !!clientAppUsed && !MODERN_CLIENTS.has(clientAppUsed);
}

const outcomeLabels: Record<SignInEvent['outcome'], string> = {
  success: 'Erfolgreich',
  failure: 'Fehlgeschlagen',
  interrupted: 'Unterbrochen',
};

const outcomeClasses: Record<SignInEvent['outcome'], string> = {
  success: 'bg-success/10 text-success',
  failure: 'bg-destructive/10 text-destructive',
  interrupted: 'bg-warning/10 text-warning',
};

const riskClasses: Record<string, string> = {
  low: 'bg-warning/10 text-warning',
  medium: 'bg-warning/20 text-warning',
  high: 'bg-destructive/10 text-destructive',
  hidden: 'bg-muted text-muted-foreground',
};

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatLocation(location: SignInEvent['location']): string {
  if (!location) return '—';
  return [location.city, location.countryOrRegion].filter(Boolean).join(', ') || '—';
}

export function SignInTable({
  events,
  showUser,
  storageKey = 'sign-ins',
}: {
  events: SignInEvent[];
  showUser: boolean;
  storageKey?: string;
}) {
  const columns: ColumnDef<SignInEvent>[] = [
    {
      id: 'createdAt',
      header: 'Zeit',
      accessor: (e) => new Date(e.createdAt),
      cell: (e) => (
        <span className="whitespace-nowrap text-muted-foreground" title={e.createdAt}>
          {formatDateTime(e.createdAt)}
          {!e.isInteractive && (
            <span className="ml-1 text-xs" title="Nicht-interaktive Anmeldung">
              (auto)
            </span>
          )}
        </span>
      ),
    },
    ...(showUser
      ? [
          {
            id: 'user',
            header: 'Benutzer',
            accessor: (e: SignInEvent) => `${e.userDisplayName} ${e.userPrincipalName}`,
            cell: (e: SignInEvent) => (
              <Link href={`/users/${e.userId}`} className="hover:underline">
                <span className="block truncate font-medium">{e.userDisplayName}</span>
                <span className="block truncate text-xs text-muted-foreground">{e.userPrincipalName}</span>
              </Link>
            ),
          } satisfies ColumnDef<SignInEvent>,
        ]
      : []),
    {
      id: 'app',
      header: 'Anwendung',
      accessor: (e) => e.appDisplayName,
      cell: (e) => (
        <span className="block max-w-[12rem] truncate" title={e.appDisplayName}>
          {e.appDisplayName}
        </span>
      ),
    },
    {
      id: 'outcome',
      header: 'Ergebnis',
      accessor: (e) => outcomeLabels[e.outcome],
      filterOptions: (Object.keys(outcomeLabels) as SignInEvent['outcome'][]).map((o) => ({ value: outcomeLabels[o], label: outcomeLabels[o] })),
      cell: (e) => (
        <>
          <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', outcomeClasses[e.outcome])} title={e.failureReason ?? undefined}>
            {outcomeLabels[e.outcome]}
            {e.errorCode !== 0 && <span className="ml-1 font-mono">{e.errorCode}</span>}
          </span>
          {e.failureReason && e.outcome !== 'success' && (
            <p className="mt-0.5 max-w-[16rem] truncate text-xs text-muted-foreground" title={e.failureReason}>
              {e.failureReason}
            </p>
          )}
        </>
      ),
    },
    {
      id: 'location',
      header: 'Herkunft',
      accessor: (e) => `${formatLocation(e.location)} ${e.ipAddress ?? ''}`.trim(),
      cell: (e) => (
        <>
          <span className="block">{formatLocation(e.location)}</span>
          {e.ipAddress && <span className="block font-mono text-xs text-muted-foreground">{e.ipAddress}</span>}
        </>
      ),
    },
    {
      id: 'country',
      header: 'Land',
      accessor: (e) => e.location?.countryOrRegion ?? null,
      defaultHidden: true,
    },
    {
      id: 'client',
      header: 'Client',
      accessor: (e) => e.clientAppUsed,
      filterOptions: [
        { value: 'Browser', label: 'Browser' },
        { value: 'Mobile Apps and Desktop clients', label: 'Moderne Clients' },
      ],
      cell: (e) => (
        <>
          <span className="block truncate text-xs">{e.clientAppUsed ?? '—'}</span>
          {isLegacyClient(e.clientAppUsed) && (
            <span className="inline-flex rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">Legacy</span>
          )}
        </>
      ),
    },
    {
      id: 'auth',
      header: 'Auth',
      accessor: (e) => (e.authenticationRequirement === 'multiFactorAuthentication' ? 'MFA' : '1FA'),
      filterOptions: [
        { value: 'MFA', label: 'MFA' },
        { value: '1FA', label: 'Nur Passwort' },
      ],
      cell: (e) => (
        <div className="flex flex-wrap gap-1">
          <span
            className={clsx(
              'rounded-full px-1.5 py-0.5 text-xs',
              e.authenticationRequirement === 'multiFactorAuthentication' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
            )}
            title="Authentifizierungsanforderung"
          >
            {e.authenticationRequirement === 'multiFactorAuthentication' ? 'MFA' : '1FA'}
          </span>
          {e.conditionalAccessStatus === 'failure' && (
            <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive" title="Conditional Access hat blockiert">
              CA
            </span>
          )}
          {e.riskLevel !== 'none' && e.riskLevel !== 'unknown' && (
            <span className={clsx('rounded-full px-1.5 py-0.5 text-xs', riskClasses[e.riskLevel])} title="Risiko waehrend der Anmeldung">
              Risiko {e.riskLevel}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'device',
      header: 'Geraet',
      accessor: (e) => (e.device ? [e.device.operatingSystem, e.device.browser].filter(Boolean).join(' / ') || null : null),
      cell: (e) =>
        e.device ? (
          <span className="text-xs text-muted-foreground">
            <span className="block">{[e.device.operatingSystem, e.device.browser].filter(Boolean).join(' / ') || '—'}</span>
            {e.device.isCompliant !== null && (
              <span className={e.device.isCompliant ? 'text-success' : 'text-warning'}>{e.device.isCompliant ? 'konform' : 'nicht konform'}</span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <DataTable
      rows={events}
      columns={columns}
      getRowId={(e) => e.id}
      storageKey={storageKey}
      initialSort={{ columnId: 'createdAt', direction: 'desc' }}
      searchPlaceholder="Benutzer, App, IP, Ort..."
      rowClassName={(e) => (e.outcome === 'failure' ? 'bg-destructive/5' : undefined)}
      exportFileName="anmeldungen"
      dense
    />
  );
}
