'use client';

import Link from 'next/link';
import clsx from 'clsx';
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

export function SignInTable({ events, showUser }: { events: SignInEvent[]; showUser: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Zeit</th>
            {showUser && <th className="px-3 py-2 font-medium">Benutzer</th>}
            <th className="px-3 py-2 font-medium">Anwendung</th>
            <th className="px-3 py-2 font-medium">Ergebnis</th>
            <th className="px-3 py-2 font-medium">Herkunft</th>
            <th className="px-3 py-2 font-medium">Client</th>
            <th className="px-3 py-2 font-medium">Auth</th>
            <th className="px-3 py-2 font-medium">Geraet</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const legacy = isLegacyClient(event.clientAppUsed);
            return (
              <tr key={event.id} className={clsx('border-b last:border-0', event.outcome === 'failure' && 'bg-destructive/5')}>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground" title={event.createdAt}>
                  {formatDateTime(event.createdAt)}
                  {!event.isInteractive && (
                    <span className="ml-1 text-xs" title="Nicht-interaktive Anmeldung">(auto)</span>
                  )}
                </td>
                {showUser && (
                  <td className="px-3 py-2">
                    <Link href={`/users/${event.userId}`} className="hover:underline">
                      <span className="block truncate font-medium">{event.userDisplayName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{event.userPrincipalName}</span>
                    </Link>
                  </td>
                )}
                <td className="max-w-[12rem] truncate px-3 py-2" title={event.appDisplayName}>
                  {event.appDisplayName}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', outcomeClasses[event.outcome])}
                    title={event.failureReason ?? undefined}
                  >
                    {outcomeLabels[event.outcome]}
                    {event.errorCode !== 0 && <span className="ml-1 font-mono">{event.errorCode}</span>}
                  </span>
                  {event.failureReason && event.outcome !== 'success' && (
                    <p className="mt-0.5 max-w-[16rem] truncate text-xs text-muted-foreground" title={event.failureReason}>
                      {event.failureReason}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="block">{formatLocation(event.location)}</span>
                  {event.ipAddress && <span className="block font-mono text-xs text-muted-foreground">{event.ipAddress}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className="block truncate text-xs">{event.clientAppUsed ?? '—'}</span>
                  {legacy && (
                    <span className="inline-flex rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                      Legacy
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <span
                      className={clsx(
                        'rounded-full px-1.5 py-0.5 text-xs',
                        event.authenticationRequirement === 'multiFactorAuthentication'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-foreground'
                      )}
                      title="Authentifizierungsanforderung"
                    >
                      {event.authenticationRequirement === 'multiFactorAuthentication' ? 'MFA' : '1FA'}
                    </span>
                    {event.conditionalAccessStatus === 'failure' && (
                      <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive" title="Conditional Access hat blockiert">
                        CA
                      </span>
                    )}
                    {event.riskLevel !== 'none' && event.riskLevel !== 'unknown' && (
                      <span className={clsx('rounded-full px-1.5 py-0.5 text-xs', riskClasses[event.riskLevel])} title="Risiko waehrend der Anmeldung">
                        Risiko {event.riskLevel}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {event.device ? (
                    <>
                      <span className="block">{[event.device.operatingSystem, event.device.browser].filter(Boolean).join(' / ') || '—'}</span>
                      {event.device.isCompliant !== null && (
                        <span className={event.device.isCompliant ? 'text-success' : 'text-warning'}>
                          {event.device.isCompliant ? 'konform' : 'nicht konform'}
                        </span>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
