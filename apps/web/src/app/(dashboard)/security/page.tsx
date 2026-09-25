'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { SignInTable, isLegacyClient, formatLocation } from '@/components/identity/sign-in-table';
import { AuditTable } from '@/components/identity/audit-table';
import type { CapabilityResult, SignInEvent, DirectoryAuditEvent } from '@zerostress/types';

type Range = '24h' | '7d' | '30d';
type Tab = 'sign-ins' | 'audit';

const rangeHours: Record<Range, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
const rangeLabels: Record<Range, string> = { '24h': '24 Stunden', '7d': '7 Tage', '30d': '30 Tage' };

const FAILURE_THRESHOLD = 5;

interface Finding {
  key: string;
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  userId: string | null;
}

// Erste Stufe der Anomalie-Erkennung: clientseitig ueber das geladene Fenster
function analyse(events: SignInEvent[]): Finding[] {
  const findings: Finding[] = [];
  const byUser = new Map<string, SignInEvent[]>();
  for (const event of events) {
    const list = byUser.get(event.userId) ?? [];
    list.push(event);
    byUser.set(event.userId, list);
  }

  for (const [userId, list] of byUser) {
    const failures = list.filter((e) => e.outcome === 'failure');
    const name = list[0].userDisplayName;
    if (failures.length >= FAILURE_THRESHOLD) {
      const ips = new Set(failures.map((e) => e.ipAddress).filter(Boolean));
      findings.push({
        key: `failures:${userId}`,
        severity: failures.length >= FAILURE_THRESHOLD * 4 ? 'high' : 'medium',
        title: `${failures.length} fehlgeschlagene Anmeldungen: ${name}`,
        detail: `${ips.size} verschiedene IP-Adressen. Haeufigster Grund: ${mostCommon(failures.map((e) => e.failureReason ?? 'unbekannt'))}`,
        userId,
      });
    }

    const countries = new Set(list.filter((e) => e.outcome === 'success').map((e) => e.location?.countryOrRegion).filter(Boolean));
    if (countries.size >= 3) {
      findings.push({
        key: `countries:${userId}`,
        severity: 'medium',
        title: `Erfolgreiche Anmeldungen aus ${countries.size} Laendern: ${name}`,
        detail: Array.from(countries).join(', '),
        userId,
      });
    }

    const legacySuccess = list.filter((e) => e.outcome === 'success' && isLegacyClient(e.clientAppUsed));
    if (legacySuccess.length > 0) {
      findings.push({
        key: `legacy:${userId}`,
        severity: 'high',
        title: `Legacy-Authentifizierung erfolgreich: ${name}`,
        detail: `${legacySuccess.length}x ueber ${Array.from(new Set(legacySuccess.map((e) => e.clientAppUsed))).join(', ')} — kein MFA moeglich`,
        userId,
      });
    }

    const risky = list.filter((e) => ['medium', 'high'].includes(e.riskLevel) && e.outcome === 'success');
    if (risky.length > 0) {
      findings.push({
        key: `risk:${userId}`,
        severity: 'high',
        title: `Riskante Anmeldung erfolgreich: ${name}`,
        detail: risky.map((e) => `${e.riskLevel} aus ${formatLocation(e.location)}`).join('; '),
        userId,
      });
    }
  }

  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
}

export default function SecurityPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const [tab, setTab] = useState<Tab>('sign-ins');
  const [range, setRange] = useState<Range>('24h');
  const [failuresOnly, setFailuresOnly] = useState(false);

  const since = useMemo(() => new Date(Date.now() - rangeHours[range] * 3600 * 1000).toISOString(), [range]);

  // Kein Auto-Refresh: jeder Abruf personenbezogener Protokolle wird auditiert
  const signInsQuery = useQuery({
    queryKey: ['security-sign-ins', activeTenant?.id, range],
    queryFn: () =>
      api.get<CapabilityResult<SignInEvent[]>>(
        `/tenants/${activeTenant!.id}/security/sign-ins?top=500&since=${encodeURIComponent(since)}`
      ),
    enabled: !!activeTenant && tab === 'sign-ins',
    staleTime: 2 * 60 * 1000,
  });

  const auditQuery = useQuery({
    queryKey: ['security-audit', activeTenant?.id, range],
    queryFn: () =>
      api.get<CapabilityResult<DirectoryAuditEvent[]>>(
        `/tenants/${activeTenant!.id}/security/audit?top=200&since=${encodeURIComponent(since)}`
      ),
    enabled: !!activeTenant && tab === 'audit',
    staleTime: 2 * 60 * 1000,
  });

  const events = signInsQuery.data?.available ? signInsQuery.data.data : [];
  const findings = useMemo(() => analyse(events), [events]);
  const visibleEvents = failuresOnly ? events.filter((e) => e.outcome === 'failure') : events;

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;

  const stats = {
    total: events.length,
    failures: events.filter((e) => e.outcome === 'failure').length,
    failedUsers: new Set(events.filter((e) => e.outcome === 'failure').map((e) => e.userId)).size,
    countries: new Set(events.map((e) => e.location?.countryOrRegion).filter(Boolean)).size,
    legacy: events.filter((e) => isLegacyClient(e.clientAppUsed)).length,
    singleFactor: events.filter((e) => e.outcome === 'success' && e.authenticationRequirement === 'singleFactorAuthentication' && e.isInteractive).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Sicherheit</h1>
          <p className="text-sm text-muted-foreground">Woher kommen Anmeldungen, was schlaegt fehl, was hat sich im Verzeichnis geaendert.</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Zeitraum" className="flex rounded-md border">
            {(Object.keys(rangeLabels) as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                aria-pressed={range === r}
                className={clsx('px-3 py-1.5 text-sm first:rounded-l-md last:rounded-r-md', range === r ? 'bg-accent font-medium' : 'hover:bg-accent/50')}
              >
                {rangeLabels[r]}
              </button>
            ))}
          </div>
          <button
            onClick={() => (tab === 'sign-ins' ? signInsQuery.refetch() : auditQuery.refetch())}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Aktualisieren
          </button>
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b">
        {([
          { id: 'sign-ins', label: 'Anmeldungen' },
          { id: 'audit', label: 'Verzeichnisaenderungen' },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              '-mb-px border-b-2 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              tab === t.id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'sign-ins' && (
        <div role="tabpanel" className="space-y-6">
          {signInsQuery.isLoading ? (
            <LoadingTable rows={6} />
          ) : signInsQuery.error ? (
            <ErrorState error={signInsQuery.error as Error} onRetry={signInsQuery.refetch} />
          ) : signInsQuery.data && !signInsQuery.data.available ? (
            <CapabilityNotice what="das Anmeldeprotokoll" {...signInsQuery.data} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Anmeldungen" value={stats.total} />
                <Stat label="Fehlgeschlagen" value={stats.failures} tone={stats.failures > 0 ? 'warning' : 'default'} />
                <Stat label="Benutzer mit Fehlern" value={stats.failedUsers} />
                <Stat label="Laender" value={stats.countries} />
                <Stat label="Legacy-Auth" value={stats.legacy} tone={stats.legacy > 0 ? 'destructive' : 'default'} />
                <Stat label="Ohne MFA (interaktiv)" value={stats.singleFactor} tone={stats.singleFactor > 0 ? 'warning' : 'default'} />
              </div>

              <section className="rounded-lg border p-4">
                <h2 className="mb-2 font-medium">Auffaelligkeiten</h2>
                {findings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Auffaelligkeiten im gewaehlten Zeitraum.</p>
                ) : (
                  <ul className="divide-y">
                    {findings.map((finding) => (
                      <li key={finding.key} className="flex items-start justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            <span className={clsx('mr-2 inline-block h-2 w-2 rounded-full', finding.severity === 'high' ? 'bg-destructive' : 'bg-warning')} />
                            {finding.title}
                          </p>
                          <p className="truncate text-xs text-muted-foreground" title={finding.detail}>{finding.detail}</p>
                        </div>
                        {finding.userId && (
                          <Link href={`/users/${finding.userId}`} className="flex-shrink-0 text-xs text-primary hover:underline">
                            Benutzer oeffnen
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex items-center justify-between">
                <h2 className="font-medium">Anmeldungen ({visibleEvents.length})</h2>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={failuresOnly} onChange={(e) => setFailuresOnly(e.target.checked)} className="h-4 w-4" />
                  Nur Fehlschlaege
                </label>
              </div>
              {visibleEvents.length === 0 ? (
                <EmptyState title="Keine Anmeldungen im Zeitraum" />
              ) : (
                <SignInTable events={visibleEvents} showUser />
              )}
            </>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div role="tabpanel">
          {auditQuery.isLoading ? (
            <LoadingTable rows={6} />
          ) : auditQuery.error ? (
            <ErrorState error={auditQuery.error as Error} onRetry={auditQuery.refetch} />
          ) : auditQuery.data && !auditQuery.data.available ? (
            <CapabilityNotice what="das Entra-Verzeichnisaudit" {...auditQuery.data} />
          ) : auditQuery.data?.available && auditQuery.data.data.length === 0 ? (
            <EmptyState title="Keine Verzeichnisaenderungen im Zeitraum" />
          ) : auditQuery.data?.available ? (
            <AuditTable events={auditQuery.data.data} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warning' | 'destructive' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>
        {value}
      </p>
    </div>
  );
}
