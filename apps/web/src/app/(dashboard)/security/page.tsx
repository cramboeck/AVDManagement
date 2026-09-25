'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { SnapshotStatus } from '@/components/inventory/snapshot-status';
import { SignInTable, isLegacyClient, formatLocation } from '@/components/identity/sign-in-table';
import { AuditTable } from '@/components/identity/audit-table';
import { ChartCard } from '@/components/charts/chart-card';
import { StackedBar, type StackedSegment } from '@/components/charts/stacked-bar';
import { BarList } from '@/components/charts/bar-list';
import { ColumnChart } from '@/components/charts/column-chart';
import { Meter } from '@/components/charts/meter';
import { type Tone, formatCount, formatPercent } from '@/components/charts/tones';
import type {
  CapabilityResult,
  SignInEvent,
  DirectoryAuditEvent,
  TenantVulnerability,
  TenantVulnerabilityList,
  VulnerabilitySeverity,
  SecurityPosture,
  DistributionBucket,
  SecureScoreImprovement,
} from '@zerostress/types';

type Range = '24h' | '7d' | '30d';
type Tab = 'overview' | 'sign-ins' | 'audit' | 'vulnerabilities';

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
  const [tab, setTab] = useState<Tab>('overview');
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
        {(tab === 'sign-ins' || tab === 'audit') && (
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
        )}
      </div>

      <div role="tablist" className="flex gap-1 border-b">
        {([
          { id: 'overview', label: 'Ueberblick' },
          { id: 'sign-ins', label: 'Anmeldungen' },
          { id: 'audit', label: 'Verzeichnisaenderungen' },
          { id: 'vulnerabilities', label: 'Schwachstellen' },
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

      {tab === 'overview' && (
        <div role="tabpanel">
          <PostureTab tenantId={activeTenant.id} />
        </div>
      )}

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

      {tab === 'vulnerabilities' && (
        <div role="tabpanel">
          <VulnerabilitiesTab tenantId={activeTenant.id} />
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

const severityClasses: Record<VulnerabilitySeverity, string> = {
  Critical: 'bg-destructive/15 text-destructive',
  High: 'bg-destructive/10 text-destructive',
  Medium: 'bg-warning/10 text-warning',
  Low: 'bg-muted text-muted-foreground',
  Unknown: 'bg-muted text-muted-foreground',
};

function VulnerabilitiesTab({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [severity, setSeverity] = useState<'all' | VulnerabilitySeverity>('all');

  const query = useQuery({
    queryKey: ['tenant-vulnerabilities', tenantId, severity],
    queryFn: () =>
      api.get<TenantVulnerabilityList>(`/tenants/${tenantId}/vulnerabilities${severity === 'all' ? '' : `?severity=${severity}`}`),
    staleTime: 5 * 60 * 1000,
  });

  if (query.isLoading) return <LoadingTable rows={8} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const result = query.data;
  if (!result) return null;
  if (!result.available) return <CapabilityNotice what="Schwachstellen aus Defender" {...result} />;

  const items = result.data.items;
  const totals = (['Critical', 'High', 'Medium', 'Low'] as VulnerabilitySeverity[]).map((s) => ({
    severity: s,
    count: items.filter((i) => i.severity === s).length,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {totals.map((t) => (
            <button
              key={t.severity}
              onClick={() => setSeverity(severity === t.severity ? 'all' : t.severity)}
              aria-pressed={severity === t.severity}
              title="Filtert serverseitig nach Schwere"
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                severityClasses[t.severity],
                severity === t.severity && 'ring-2 ring-primary'
              )}
            >
              {t.severity}: {t.count}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {result.data.truncated && <span className="text-xs text-warning">Stichprobe — der Tenant hat mehr Schwachstellen als geladen</span>}
          <SnapshotStatus tenantId={tenantId} kinds={['vulnerabilities']} invalidate={[['tenant-vulnerabilities', tenantId]]} />
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState title="Keine offenen Schwachstellen" description="Defender meldet fuer diesen Filter keine betroffenen Geraete." />
      ) : (
        <DataTable
          rows={items}
          columns={vulnerabilityColumns}
          getRowId={(v) => v.cveId}
          storageKey="tenant-vulnerabilities"
          initialSort={{ columnId: 'severity', direction: 'asc' }}
          searchPlaceholder="CVE, Produkt, KB..."
          onRowClick={(v) => router.push(`/security/vulnerabilities/${encodeURIComponent(v.cveId)}`)}
          exportFileName="schwachstellen"
          dense
        />
      )}
    </div>
  );
}

const severityRank: Record<VulnerabilitySeverity, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Unknown: 4 };

const vulnerabilityColumns: ColumnDef<TenantVulnerability>[] = [
  {
    id: 'cveId',
    header: 'CVE',
    accessor: (v) => v.cveId,
    cell: (v) => (
      <Link href={`/security/vulnerabilities/${encodeURIComponent(v.cveId)}`} className="font-mono text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
        {v.cveId}
      </Link>
    ),
  },
  {
    id: 'severity',
    header: 'Schwere',
    accessor: (v) => v.severity,
    sortValue: (v) => severityRank[v.severity],
    filterOptions: (['Critical', 'High', 'Medium', 'Low'] as VulnerabilitySeverity[]).map((s) => ({ value: s, label: s })),
    cell: (v) => <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', severityClasses[v.severity])}>{v.severity}</span>,
  },
  { id: 'deviceCount', header: 'Geraete', accessor: (v) => v.deviceCount, align: 'right', className: 'tabular-nums' },
  {
    id: 'products',
    header: 'Produkte',
    accessor: (v) => v.products.join(', ') || null,
    cell: (v) => (
      <span className="block max-w-[20rem] truncate text-xs text-muted-foreground" title={v.products.join(', ')}>
        {v.products.join(', ') || '—'}
      </span>
    ),
  },
  {
    id: 'kbs',
    header: 'Behebende KBs',
    accessor: (v) => v.fixingKbIds.map((kb) => `KB${kb}`).join(', ') || null,
    className: 'font-mono text-xs',
  },
];

const complianceTones: Record<string, Tone> = {
  compliant: 'good',
  inGracePeriod: 'warning',
  noncompliant: 'critical',
  conflict: 'serious',
  error: 'serious',
  notApplicable: 'neutral',
  unknown: 'neutral',
  'not-managed': 'neutral',
};

const exposureTones: Record<string, Tone> = {
  High: 'critical',
  Medium: 'warning',
  Low: 'good',
  None: 'good',
  Unknown: 'neutral',
  'not-onboarded': 'neutral',
};

const cveTones: Record<string, Tone> = {
  Critical: 'critical',
  High: 'serious',
  Medium: 'warning',
  Low: 'neutral',
  Unknown: 'neutral',
};

const comparisonLabels: Record<string, string> = {
  AllTenants: 'Durchschnitt aller Tenants',
  TotalSeats: 'Tenants gleicher Groesse',
  IndustryTypes: 'Gleiche Branche',
};

function toSegments(buckets: DistributionBucket[], tones: Record<string, Tone>): StackedSegment[] {
  return buckets.map((b) => ({ key: b.key, label: b.label, count: b.count, tone: tones[b.key] ?? 'neutral' }));
}

function scoreTone(percent: number, good: number, warning: number): Tone {
  if (percent >= good) return 'good';
  if (percent >= warning) return 'warning';
  return 'critical';
}

function PostureTab({ tenantId }: { tenantId: string }) {
  const query = useQuery({
    queryKey: ['security-posture', tenantId],
    queryFn: () => api.get<SecurityPosture>(`/tenants/${tenantId}/security/posture`),
    staleTime: 5 * 60 * 1000,
  });

  if (query.isLoading) return <LoadingTable rows={8} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const posture = query.data;
  if (!posture) return null;
  const fetching = query.isFetching;

  const secure = posture.secureScore.available ? posture.secureScore.data : null;
  const exposure = posture.exposureScore.available ? posture.exposureScore.data : null;
  const mfa = posture.mfa.available ? posture.mfa.data : null;
  const alerts = posture.alerts.available ? posture.alerts.data : null;
  const devices = posture.devices.available ? posture.devices.data : null;
  const vulns = posture.vulnerabilities.available ? posture.vulnerabilities.data : null;
  const signIns = posture.signIns.available ? posture.signIns.data : null;

  const mfaPercent = mfa && mfa.totalUsers > 0 ? (mfa.mfaRegistered / mfa.totalUsers) * 100 : 0;
  const allTenantsAverage = secure?.comparisons.find((c) => c.basis === 'AllTenants') ?? null;

  const todo = buildTodo(posture);

  return (
    <div className={clsx('space-y-6 transition-opacity', fetching && 'opacity-70')}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Scores, MFA und Alerts live um {new Date(posture.generatedAt).toLocaleTimeString('de-DE')}; Geraete und Schwachstellen aus dem Bestand
        </p>
        <SnapshotStatus tenantId={tenantId} kinds={['devices', 'vulnerabilities']} invalidate={[['security-posture', tenantId]]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border p-4">
          {secure ? (
            <Meter
              label="Microsoft Secure Score"
              percent={secure.percent}
              tone={scoreTone(secure.percent, 70, 45)}
              detail={`${formatCount(Math.round(secure.currentScore))} von ${formatCount(Math.round(secure.maxScore))} Punkten`}
              marker={allTenantsAverage ? { percent: allTenantsAverage.averagePercent, label: comparisonLabels.AllTenants } : null}
            />
          ) : (
            <UnavailableNotice what="den Secure Score" result={posture.secureScore} />
          )}
        </section>
        <section className="rounded-lg border p-4">
          {exposure ? (
            <Meter
              label="Defender Exposure Score"
              percent={exposure.score}
              tone={exposure.score <= 30 ? 'good' : exposure.score <= 70 ? 'warning' : 'critical'}
              valueText={`${formatCount(Math.round(exposure.score))} / 100`}
              detail="Niedriger ist besser; bis 30 gilt als niedrig, ab 70 als hoch"
            />
          ) : (
            <UnavailableNotice what="den Exposure Score" result={posture.exposureScore} />
          )}
        </section>
        <section className="rounded-lg border p-4">
          {mfa ? (
            <Meter
              label="MFA registriert"
              percent={mfaPercent}
              tone={scoreTone(mfaPercent, 90, 70)}
              detail={`${formatCount(mfa.mfaRegistered)} von ${formatCount(mfa.totalUsers)} Mitgliedern · ${formatCount(mfa.passwordlessCapable)} passwortlos faehig`}
            />
          ) : (
            <UnavailableNotice what="den MFA-Registrierungsreport" result={posture.mfa} />
          )}
        </section>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PostureStat
          label="Admins ohne MFA"
          value={mfa ? formatCount(mfa.adminsWithoutMfa) : '—'}
          tone={mfa ? (mfa.adminsWithoutMfa > 0 ? 'critical' : 'good') : 'neutral'}
          detail={mfa ? `${formatCount(mfa.admins)} Konten mit Adminrolle` : 'nicht verfuegbar'}
        />
        <PostureStat
          label="Offene Alerts"
          value={alerts ? formatCount(alerts.total) : '—'}
          tone={alerts ? (alerts.bySeverity.high > 0 ? 'critical' : alerts.total > 0 ? 'warning' : 'good') : 'neutral'}
          detail={alerts ? `${alerts.bySeverity.high} hoch · ${alerts.bySeverity.medium} mittel · ${alerts.bySeverity.low} niedrig` : posture.alerts.available ? '' : 'nicht verfuegbar'}
        />
        <PostureStat
          label="Kritische CVEs"
          value={vulns ? formatCount(vulns.bySeverity.find((b) => b.key === 'Critical')?.count ?? 0) : '—'}
          tone={vulns ? ((vulns.bySeverity.find((b) => b.key === 'Critical')?.count ?? 0) > 0 ? 'critical' : 'good') : 'neutral'}
          detail={vulns ? `${formatCount(vulns.bySeverity.reduce((s, b) => s + b.count, 0))} CVEs gesamt${vulns.truncated ? ' (Stichprobe)' : ''}` : 'nicht verfuegbar'}
        />
        <PostureStat
          label="Geraete mit hoher Exposure"
          value={devices ? formatCount(devices.exposure.find((b) => b.key === 'High')?.count ?? 0) : '—'}
          tone={devices ? ((devices.exposure.find((b) => b.key === 'High')?.count ?? 0) > 0 ? 'critical' : 'good') : 'neutral'}
          detail={devices ? `${formatCount(devices.total)} Geraete gesamt` : 'nicht verfuegbar'}
        />
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Was ist zu tun</h2>
        {todo.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine offenen Massnahmen aus den verfuegbaren Quellen.</p>
        ) : (
          <ol className="divide-y">
            {todo.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span className={clsx('mr-2 inline-block h-2 w-2 rounded-full', item.tone === 'critical' ? 'bg-destructive' : item.tone === 'serious' || item.tone === 'warning' ? 'bg-warning' : 'bg-muted-foreground')} aria-hidden="true" />
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 text-xs">
                  {item.gain !== null && <span className="tabular-nums text-muted-foreground">+{formatCount(item.gain)} Punkte</span>}
                  {item.href &&
                    (item.external ? (
                      <a href={item.href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Im Portal
                      </a>
                    ) : (
                      <Link href={item.href} className="text-primary hover:underline">
                        Oeffnen
                      </Link>
                    ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Compliance (Intune)"
          subtitle={devices ? `${formatCount(devices.total)} Geraete` : undefined}
          tableHeaders={['Status', 'Geraete']}
          tableRows={(devices?.compliance ?? []).map((b) => ({ label: b.label, values: [b.count] }))}
          isFetching={fetching}
        >
          {devices ? <StackedBar segments={toSegments(devices.compliance, complianceTones)} /> : <UnavailableNotice what="die Geraetedaten" result={posture.devices} />}
        </ChartCard>
        <ChartCard
          title="Exposure (Defender)"
          subtitle="Angriffsflaeche je Geraet"
          tableHeaders={['Exposure', 'Geraete']}
          tableRows={(devices?.exposure ?? []).map((b) => ({ label: b.label, values: [b.count] }))}
          isFetching={fetching}
        >
          {devices ? <StackedBar segments={toSegments(devices.exposure, exposureTones)} /> : <UnavailableNotice what="die Geraetedaten" result={posture.devices} />}
        </ChartCard>
        <ChartCard
          title="Schwachstellen nach Schwere"
          subtitle={vulns?.truncated ? 'Stichprobe der schwersten' : 'Offene CVEs im Tenant'}
          tableHeaders={['Schwere', 'CVEs']}
          tableRows={(vulns?.bySeverity ?? []).map((b) => ({ label: b.label, values: [b.count] }))}
          isFetching={fetching}
        >
          {vulns ? <StackedBar segments={toSegments(vulns.bySeverity, cveTones)} /> : <UnavailableNotice what="die Schwachstellen" result={posture.vulnerabilities} />}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Anmeldungen der letzten 7 Tage"
          subtitle={signIns?.sampled ? 'Stichprobe der letzten 500 Anmeldungen' : 'Erfolgreich, unterbrochen, fehlgeschlagen'}
          tableHeaders={['Tag', 'Erfolgreich', 'Unterbrochen', 'Fehlgeschlagen']}
          tableRows={(signIns?.days ?? []).map((d) => ({ label: formatDay(d.day), values: [d.success, d.interrupted, d.failure] }))}
          isFetching={fetching}
        >
          {signIns ? (
            <ColumnChart
              series={[
                { key: 'success', label: 'Erfolgreich', tone: 'good' },
                { key: 'interrupted', label: 'Unterbrochen', tone: 'warning' },
                { key: 'failure', label: 'Fehlgeschlagen', tone: 'critical' },
              ]}
              data={signIns.days.map((d) => ({ label: formatDay(d.day), values: { success: d.success, interrupted: d.interrupted, failure: d.failure } }))}
            />
          ) : (
            <UnavailableNotice what="das Anmeldeprotokoll" result={posture.signIns} />
          )}
        </ChartCard>
        <ChartCard
          title="Betriebssysteme"
          subtitle="Geraete je Version"
          tableHeaders={['Version', 'Geraete']}
          tableRows={(devices?.osVersions ?? []).map((b) => ({ label: b.label, values: [b.count] }))}
          isFetching={fetching}
        >
          {devices ? <BarList items={devices.osVersions.map((b) => ({ key: b.key, label: b.label, value: b.count }))} /> : <UnavailableNotice what="die Geraetedaten" result={posture.devices} />}
        </ChartCard>
      </div>

      {secure && secure.comparisons.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Secure-Score-Vergleich:{' '}
          {secure.comparisons.map((c) => `${comparisonLabels[c.basis] ?? c.basis} ${formatPercent(c.averagePercent)}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

interface TodoItem {
  key: string;
  title: string;
  detail: string;
  tone: Tone;
  gain: number | null;
  href: string | null;
  external: boolean;
}

// Eigene Befunde zuerst (sie betreffen konkrete Objekte), dann Secure-Score-Massnahmen nach Punktgewinn
function buildTodo(posture: SecurityPosture): TodoItem[] {
  const items: TodoItem[] = [];
  const mfa = posture.mfa.available ? posture.mfa.data : null;
  const devices = posture.devices.available ? posture.devices.data : null;
  const vulns = posture.vulnerabilities.available ? posture.vulnerabilities.data : null;
  const alerts = posture.alerts.available ? posture.alerts.data : null;

  if (mfa && mfa.adminsWithoutMfa > 0) {
    items.push({
      key: 'admins-mfa',
      title: `${mfa.adminsWithoutMfa} Administratorkonto${mfa.adminsWithoutMfa === 1 ? '' : 'en'} ohne registrierte MFA`,
      detail: 'Hoechstes Risiko im Tenant: Admin-Konten muessen MFA, besser phishing-resistent, registriert haben.',
      tone: 'critical',
      gain: null,
      href: '/users',
      external: false,
    });
  }
  if (alerts && alerts.bySeverity.high > 0) {
    items.push({
      key: 'alerts-high',
      title: `${alerts.bySeverity.high} offene Alerts mit hoher Schwere`,
      detail: alerts.newest[0] ? `Neuester: ${alerts.newest[0].title}` : '',
      tone: 'critical',
      gain: null,
      href: 'https://security.microsoft.com/alerts',
      external: true,
    });
  }
  const critical = vulns?.bySeverity.find((b) => b.key === 'Critical')?.count ?? 0;
  if (critical > 0) {
    items.push({
      key: 'cve-critical',
      title: `${critical} kritische CVEs mit betroffenen Geraeten`,
      detail: 'Prioritaet nach KEV, Exploit und EPSS in der CVE-Detailseite.',
      tone: 'critical',
      gain: null,
      href: '/security?tab=vulnerabilities',
      external: false,
    });
  }
  const highExposure = devices?.exposure.find((b) => b.key === 'High')?.count ?? 0;
  if (highExposure > 0) {
    items.push({
      key: 'exposure-high',
      title: `${highExposure} Geraete mit hoher Exposure`,
      detail: 'Fehlende Updates und verwundbare Software im Geraetedetail pruefen.',
      tone: 'serious',
      gain: null,
      href: '/devices',
      external: false,
    });
  }
  const noncompliant = devices?.compliance.find((b) => b.key === 'noncompliant')?.count ?? 0;
  if (noncompliant > 0) {
    items.push({
      key: 'noncompliant',
      title: `${noncompliant} nicht konforme Geraete`,
      detail: 'Compliance-Richtlinien in Intune verletzt; Zugriff kann per Conditional Access blockiert sein.',
      tone: 'warning',
      gain: null,
      href: '/devices',
      external: false,
    });
  }

  const secure = posture.secureScore.available ? posture.secureScore.data : null;
  for (const improvement of secure?.topImprovements.slice(0, 8) ?? []) {
    items.push(improvementToTodo(improvement));
  }

  return items;
}

function improvementToTodo(i: SecureScoreImprovement): TodoItem {
  const meta = [i.category, i.userImpact ? `Benutzerauswirkung ${i.userImpact}` : null, i.implementationCost ? `Aufwand ${i.implementationCost}` : null]
    .filter(Boolean)
    .join(' · ');
  return {
    key: `secure-${i.control}`,
    title: i.title,
    detail: i.remediation ? `${meta} — ${i.remediation.slice(0, 160)}${i.remediation.length > 160 ? '…' : ''}` : meta,
    tone: i.scoreGain >= 8 ? 'serious' : i.scoreGain >= 4 ? 'warning' : 'neutral',
    gain: i.scoreGain,
    href: i.actionUrl,
    external: true,
  };
}

// Verengt das CapabilityResult selbst, damit die Aufrufer nicht spreizen muessen
function UnavailableNotice<T>({ what, result }: { what: string; result: CapabilityResult<T> }) {
  if (result.available) return null;
  return <CapabilityNotice what={what} reason={result.reason} missingPermission={result.missingPermission} detail={result.detail} compact />;
}

function PostureStat({ label, value, tone, detail }: { label: string; value: string; tone: Tone; detail: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold', tone === 'critical' && 'text-destructive', (tone === 'warning' || tone === 'serious') && 'text-warning', tone === 'good' && 'text-success')}>
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year.slice(2)}`;
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
