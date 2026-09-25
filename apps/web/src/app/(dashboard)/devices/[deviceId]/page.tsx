'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingPage, LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { formatDateTime } from '@/components/identity/sign-in-table';
import {
  ComplianceBadge,
  ExposureBadge,
  RiskBadge,
  HealthBadge,
  formatRelative,
} from '@/components/devices/device-badges';
import type { Device, DeviceSecurityPosture, DeviceVulnerability, MissingKb, VulnerabilitySeverity, Job, JobStatus } from '@zerostress/types';

type Tab = 'overview' | 'security' | 'jobs';
type DeviceAction = 'sync-device' | 'restart-device' | 'defender-scan';

const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Uebersicht' },
  { id: 'security', label: 'Sicherheit' },
  { id: 'jobs', label: 'Jobs' },
];

const actionMeta: Record<DeviceAction, { title: string; description: string; confirmLabel: string; tone: 'default' | 'destructive' }> = {
  'sync-device': {
    title: 'Geraet synchronisieren',
    description: 'Intune fordert das Geraet auf, Richtlinien und Apps sofort abzurufen.',
    confirmLabel: 'Synchronisieren',
    tone: 'default',
  },
  'restart-device': {
    title: 'Geraet neu starten',
    description: 'Das Geraet startet ohne Rueckfrage beim Benutzer neu.',
    confirmLabel: 'Neu starten',
    tone: 'destructive',
  },
  'defender-scan': {
    title: 'Defender-Schnellscan starten',
    description: 'Microsoft Defender fuehrt einen Schnellscan auf dem Geraet aus.',
    confirmLabel: 'Scan starten',
    tone: 'default',
  },
};

const severityClasses: Record<VulnerabilitySeverity, string> = {
  Critical: 'bg-destructive/15 text-destructive',
  High: 'bg-destructive/10 text-destructive',
  Medium: 'bg-warning/10 text-warning',
  Low: 'bg-muted text-muted-foreground',
  Unknown: 'bg-muted text-muted-foreground',
};

const jobStatusLabels: Record<JobStatus, string> = {
  pending_approval: 'Warte auf Freigabe',
  queued: 'In Warteschlange',
  running: 'Laeuft',
  completed: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

export default function DeviceDetailPage({ params }: { params: { deviceId: string } }) {
  const deviceId = decodeURIComponent(params.deviceId);
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [action, setAction] = useState<DeviceAction | null>(null);

  const base = activeTenant ? `/tenants/${activeTenant.id}/devices/${encodeURIComponent(deviceId)}` : '';

  const deviceQuery = useQuery({
    queryKey: ['device', activeTenant?.id, deviceId],
    queryFn: () => api.get<Device>(base),
    enabled: !!activeTenant,
    staleTime: 5 * 60 * 1000,
  });

  const device = deviceQuery.data;

  const createJob = useCallback(() => {
    if (!device?.intune || !action || !activeTenant) return Promise.reject(new Error('Geraet ist nicht in Intune verwaltet'));
    return api.post<Job>(`/tenants/${activeTenant.id}/jobs/${action}`, {
      managedDeviceId: device.intune.managedDeviceId,
      deviceName: device.name,
      quickScan: true,
    });
  }, [device, action, activeTenant]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['device', activeTenant?.id, deviceId] });
  }, [queryClient, activeTenant?.id, deviceId]);

  if (tenantLoading) return <LoadingPage message="Lade Tenant..." />;
  if (!activeTenant) return <NoTenantSelected />;
  if (deviceQuery.isLoading) return <LoadingPage message="Lade Geraet..." />;
  if (deviceQuery.error) return <ErrorState error={deviceQuery.error as Error} onRetry={deviceQuery.refetch} />;
  if (!device) return <EmptyState title="Geraet nicht gefunden" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href="/devices" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Zurueck zur Geraeteliste">
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">{device.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[device.operatingSystem, device.osVersion].filter(Boolean).join(' ')}
              {device.primaryUser && <> · {device.primaryUser}</>}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {device.intune && <ComplianceBadge state={device.intune.complianceState} />}
              {device.defender && (
                <>
                  <ExposureBadge level={device.defender.exposureLevel} />
                  <RiskBadge score={device.defender.riskScore} />
                  <HealthBadge status={device.defender.healthStatus} />
                </>
              )}
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Zuletzt aktiv {formatRelative(device.lastActivityAt)}
              </span>
            </div>
          </div>
        </div>

        {device.intune ? (
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => setAction('sync-device')}>Synchronisieren</ActionButton>
            <ActionButton onClick={() => setAction('defender-scan')}>Defender-Scan</ActionButton>
            <ActionButton onClick={() => setAction('restart-device')} tone="destructive">Neu starten</ActionButton>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Aktionen erfordern Intune-Verwaltung.</p>
        )}
      </div>

      <div role="tablist" aria-label="Geraetebereiche" className="flex gap-1 border-b">
        {tabs.map((t) => (
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

      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab device={device} />}
        {tab === 'security' && <SecurityTab base={base} tenantId={activeTenant.id} deviceId={deviceId} />}
        {tab === 'jobs' && <JobsTab tenantId={activeTenant.id} managedDeviceId={device.intune?.managedDeviceId ?? null} />}
      </div>

      {action && (
        <JobActionDialog
          title={actionMeta[action].title}
          description={actionMeta[action].description}
          confirmLabel={actionMeta[action].confirmLabel}
          tone={actionMeta[action].tone}
          createJob={createJob}
          onClose={() => setAction(null)}
          onCompleted={refresh}
        />
      )}
    </div>
  );
}

function OverviewTab({ device }: { device: Device }) {
  const intune = device.intune;
  const defender = device.defender;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Intune</h2>
        {intune ? (
          <Fields
            fields={[
              ['Compliance', <ComplianceBadge key="c" state={intune.complianceState} />],
              ['Letzter Sync', intune.lastSyncAt ? formatDateTime(intune.lastSyncAt) : '—'],
              ['Registriert', intune.enrolledAt ? formatDateTime(intune.enrolledAt) : '—'],
              ['Besitz', intune.ownerType ?? '—'],
              ['Verschluesselt', intune.isEncrypted === null ? '—' : intune.isEncrypted ? 'ja' : 'nein'],
              ['Modell', [intune.manufacturer, intune.model].filter(Boolean).join(' ') || '—'],
              ['Seriennummer', intune.serialNumber ?? '—'],
              ['Verwaltung', intune.managementAgent ?? '—'],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Nicht in Intune verwaltet.</p>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Defender for Endpoint</h2>
        {defender ? (
          <Fields
            fields={[
              ['Sensor', <HealthBadge key="h" status={defender.healthStatus} />],
              ['Onboarding', defender.onboardingStatus ?? '—'],
              ['Exposure', <ExposureBadge key="e" level={defender.exposureLevel} />],
              ['Risiko', <RiskBadge key="r" score={defender.riskScore} />],
              ['Zuletzt gesehen', defender.lastSeenAt ? formatDateTime(defender.lastSeenAt) : '—'],
              ['Letzte IP', defender.lastIpAddress ?? '—'],
              ['OS-Build', defender.osBuild ?? '—'],
              ['Entra-Join', defender.isAadJoined === null ? '—' : defender.isAadJoined ? 'ja' : 'nein'],
              ['Tags', defender.tags.length ? defender.tags.join(', ') : '—'],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Nicht in Defender onboarded.</p>
        )}
      </section>
    </div>
  );
}

function SecurityTab({ base, tenantId, deviceId }: { base: string; tenantId: string; deviceId: string }) {
  const postureQuery = useQuery({
    queryKey: ['device-security', tenantId, deviceId],
    queryFn: () => api.get<DeviceSecurityPosture>(`${base}/security`),
    staleTime: 5 * 60 * 1000,
  });

  if (postureQuery.isLoading) return <LoadingTable rows={5} />;
  if (postureQuery.error) return <ErrorState error={postureQuery.error as Error} onRetry={postureQuery.refetch} />;
  const posture = postureQuery.data;
  if (!posture) return null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-medium">Fehlende Sicherheitsupdates</h2>
          {posture.missingKbsSource === 'derived' && (
            <span className="text-xs text-muted-foreground" title="Der Defender-Endpunkt fuer fehlende KBs ist ohne Software.Read.All nicht verfuegbar; die Liste ist aus den Schwachstellen des Geraets abgeleitet.">
              abgeleitet aus Schwachstellen
            </span>
          )}
        </div>
        {!posture.missingKbs.available ? (
          <CapabilityNotice what="fehlende Sicherheitsupdates" {...posture.missingKbs} />
        ) : posture.missingKbs.data.length === 0 ? (
          <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm">Keine fehlenden Sicherheitsupdates bekannt.</p>
        ) : (
          <MissingKbTable kbs={posture.missingKbs.data} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Schwachstellen</h2>
        {!posture.vulnerabilities.available ? (
          <CapabilityNotice what="Schwachstellen" {...posture.vulnerabilities} />
        ) : posture.vulnerabilities.data.length === 0 ? (
          <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm">Keine offenen Schwachstellen bekannt.</p>
        ) : (
          <VulnerabilityList vulnerabilities={posture.vulnerabilities.data} />
        )}
      </section>
    </div>
  );
}

function MissingKbTable({ kbs }: { kbs: MissingKb[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">KB</th>
            <th className="px-3 py-2 font-medium">Update</th>
            <th className="px-3 py-2 font-medium">Produkte</th>
            <th className="px-3 py-2 font-medium">Behobene CVEs</th>
          </tr>
        </thead>
        <tbody>
          {kbs.map((kb) => (
            <tr key={kb.id} className="border-b last:border-0">
              <td className="px-3 py-2 font-mono text-xs">
                {kb.url ? (
                  <a href={kb.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    KB{kb.id}
                  </a>
                ) : (
                  `KB${kb.id}`
                )}
              </td>
              <td className="px-3 py-2">
                <span className="block">{kb.name}</span>
                {kb.osBuild && <span className="block text-xs text-muted-foreground">Build {kb.osBuild}</span>}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{kb.products.join(', ') || '—'}</td>
              <td className={clsx('px-3 py-2 tabular-nums', kb.cveAddressed >= 50 && 'font-medium text-destructive')}>{kb.cveAddressed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VulnerabilityList({ vulnerabilities }: { vulnerabilities: DeviceVulnerability[] }) {
  const counts = (['Critical', 'High', 'Medium', 'Low'] as VulnerabilitySeverity[]).map((s) => ({
    severity: s,
    count: vulnerabilities.filter((v) => v.severity === s).length,
  }));
  const exploitable = vulnerabilities.filter((v) => v.publicExploit).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {counts.map((c) => (
          <span key={c.severity} className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', severityClasses[c.severity])}>
            {c.severity}: {c.count}
          </span>
        ))}
        {exploitable > 0 && (
          <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
            {exploitable} mit oeffentlichem Exploit
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">CVE</th>
              <th className="px-3 py-2 font-medium">Schwere</th>
              <th className="px-3 py-2 font-medium">CVSS</th>
              <th className="px-3 py-2 font-medium">Exploit</th>
              <th className="px-3 py-2 font-medium">Veroeffentlicht</th>
            </tr>
          </thead>
          <tbody>
            {vulnerabilities.slice(0, 200).map((v) => (
              <tr key={v.cveId} className="border-b align-top last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/security/vulnerabilities/${encodeURIComponent(v.cveId)}`}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {v.cveId}
                  </Link>
                  {v.description && (
                    <p className="mt-0.5 max-w-md truncate text-xs text-muted-foreground" title={v.description}>
                      {v.description}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', severityClasses[v.severity])}>{v.severity}</span>
                </td>
                <td className="px-3 py-2 tabular-nums">{v.cvssScore ?? '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {v.publicExploit ? <span className="text-destructive">oeffentlich{v.exploitVerified ? ', verifiziert' : ''}</span> : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{v.publishedAt ? formatDateTime(v.publishedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {vulnerabilities.length > 200 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">Die ersten 200 von {vulnerabilities.length} Schwachstellen.</p>
        )}
      </div>
    </div>
  );
}

function JobsTab({ tenantId, managedDeviceId }: { tenantId: string; managedDeviceId: string | null }) {
  const jobsQuery = useQuery({
    queryKey: ['jobs', tenantId],
    queryFn: () => api.get<{ items: Job[] }>(`/tenants/${tenantId}/jobs`),
    refetchInterval: 5000,
  });

  if (jobsQuery.isLoading) return <LoadingTable rows={3} />;
  if (jobsQuery.error) return <ErrorState error={jobsQuery.error as Error} onRetry={jobsQuery.refetch} />;
  const jobs = (jobsQuery.data?.items ?? []).filter((job) => managedDeviceId && job.payload.managedDeviceId === managedDeviceId);
  if (jobs.length === 0) return <EmptyState title="Keine Jobs fuer dieses Geraet" />;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Zeit</th>
            <th className="px-3 py-2 font-medium">Aktion</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Ausgeloest von</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-b last:border-0">
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(job.createdAt)}</td>
              <td className="px-3 py-2 font-mono text-xs">{job.type}</td>
              <td className="px-3 py-2">{jobStatusLabels[job.status]}</td>
              <td className="px-3 py-2 text-muted-foreground">{job.createdByEmail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fields({ fields }: { fields: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionButton({ children, onClick, tone = 'default' }: { children: React.ReactNode; onClick: () => void; tone?: 'default' | 'destructive' }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        tone === 'destructive' ? 'border border-destructive/40 text-destructive hover:bg-destructive/10' : 'border hover:bg-accent'
      )}
    >
      {children}
    </button>
  );
}
