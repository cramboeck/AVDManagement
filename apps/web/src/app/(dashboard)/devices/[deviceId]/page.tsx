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
import { RecoveryTab } from '@/components/devices/recovery-tab';
import { ScriptsTab } from '@/components/devices/scripts-tab';
import { SoftwareTab } from '@/components/devices/software-tab';
import { RemoteSessionButton } from '@/components/devices/remote-session';
import { TempAdminDialog } from '@/components/devices/temp-admin-dialog';
import {
  ComplianceBadge,
  ExposureBadge,
  RiskBadge,
  HealthBadge,
  formatRelative,
} from '@/components/devices/device-badges';
import type {
  CapabilityResult,
  Device,
  DeviceNetworkInfo,
  DeviceNetworkInterface,
  DeviceSecurityPosture,
  DeviceVulnerability,
  MissingKb,
  VulnerableSoftware,
  VulnerabilitySeverity,
  Job,
  JobStatus,
} from '@zerostress/types';

type Tab = 'overview' | 'security' | 'software' | 'recovery' | 'scripts' | 'jobs';
type DeviceAction = 'sync-device' | 'restart-device' | 'defender-scan';

const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Uebersicht' },
  { id: 'security', label: 'Sicherheit' },
  { id: 'software', label: 'Software' },
  { id: 'recovery', label: 'Wiederherstellung' },
  { id: 'scripts', label: 'Skripte' },
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
  const [tempAdmin, setTempAdmin] = useState<'grant' | 'revoke' | null>(null);

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
          <div className="flex flex-wrap items-center gap-2">
            <RemoteSessionButton base={base} tenantId={activeTenant.id} deviceId={deviceId} />
            <ActionButton onClick={() => setAction('sync-device')}>Synchronisieren</ActionButton>
            <ActionButton onClick={() => setAction('defender-scan')}>Defender-Scan</ActionButton>
            <ActionButton onClick={() => setTempAdmin('grant')}>Admin auf Zeit</ActionButton>
            <ActionButton onClick={() => setTempAdmin('revoke')} tone="destructive">Admin entziehen</ActionButton>
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
        {tab === 'overview' && <OverviewTab base={base} tenantId={activeTenant.id} device={device} />}
        {tab === 'security' && <SecurityTab base={base} tenantId={activeTenant.id} deviceId={deviceId} />}
        {tab === 'recovery' && <RecoveryTab base={base} tenantId={activeTenant.id} deviceId={deviceId} />}
        {tab === 'software' && <SoftwareTab base={base} tenantId={activeTenant.id} device={device} />}
        {tab === 'scripts' && <ScriptsTab tenantId={activeTenant.id} device={device} />}
        {tab === 'jobs' && <JobsTab tenantId={activeTenant.id} managedDeviceId={device.intune?.managedDeviceId ?? null} />}
      </div>

      {tempAdmin && (
        <TempAdminDialog tenantId={activeTenant.id} device={device} mode={tempAdmin} onClose={() => setTempAdmin(null)} onCompleted={refresh} />
      )}

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

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

function StorageBar({ total, free }: { total: number | null; free: number | null }) {
  if (!total || free === null) return <span>—</span>;
  const used = total - free;
  const percent = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
  const tone = percent >= 90 ? 'bg-destructive' : percent >= 75 ? 'bg-warning' : 'bg-primary';
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span>
          {formatBytes(used)} belegt von {formatBytes(total)}
        </span>
        <span className={clsx('tabular-nums', percent >= 90 && 'text-destructive', percent >= 75 && percent < 90 && 'text-warning')}>{percent} %</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Speicherbelegung">
        <div className={clsx('h-full rounded-full', tone)} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{formatBytes(free)} frei · Stand vom letzten Intune-Check-in</p>
    </div>
  );
}

function isNoise(i: DeviceNetworkInterface): boolean {
  const ip = i.ipAddress.toLowerCase();
  return ip === '::1' || ip.startsWith('127.') || ip.startsWith('fe80:') || ip.startsWith('169.254.') || (i.type ?? '').toLowerCase().includes('loopback');
}

interface AdapterRow {
  key: string;
  macAddress: string | null;
  type: string | null;
  status: string | null;
  ipv4: string[];
  ipv6: string[];
}

// Eine Zeile je Adapter (MAC), aktive zuerst; Loopback, Link-Local und APIPA bleiben im Ausklappmenue
function groupAdapters(interfaces: DeviceNetworkInterface[]): AdapterRow[] {
  const rows = new Map<string, AdapterRow>();
  for (const i of interfaces) {
    if (isNoise(i)) continue;
    const key = i.macAddress ?? `${i.type ?? 'unknown'}-${i.status ?? ''}`;
    const row = rows.get(key) ?? { key, macAddress: i.macAddress, type: i.type, status: i.status, ipv4: [], ipv6: [] };
    (i.ipAddress.includes(':') ? row.ipv6 : row.ipv4).push(i.ipAddress);
    if (i.status === 'Up') row.status = 'Up';
    rows.set(key, row);
  }
  return Array.from(rows.values()).sort((a, b) => Number(b.status === 'Up') - Number(a.status === 'Up') || b.ipv4.length - a.ipv4.length);
}

function NetworkSection({ base, tenantId, device }: { base: string; tenantId: string; device: Device }) {
  const query = useQuery({
    queryKey: ['device-network', tenantId, device.id],
    queryFn: () => api.get<CapabilityResult<DeviceNetworkInfo>>(`${base}/network`),
    enabled: !!device.defender,
    staleTime: 5 * 60 * 1000,
  });

  if (!device.defender) {
    return <p className="text-sm text-muted-foreground">Adressen kommen vom Defender-Sensor; dieses Geraet ist nicht in Defender onboarded.</p>;
  }
  if (query.isLoading) return <LoadingTable rows={2} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const result = query.data;
  if (!result) return null;
  if (!result.available) return <CapabilityNotice what="die Netzwerkschnittstellen" reason={result.reason} missingPermission={result.missingPermission} detail={result.detail} compact />;
  const net = result.data;
  const adapters = groupAdapters(net.interfaces);
  const active = adapters.filter((a) => a.status === 'Up');
  const inactive = adapters.filter((a) => a.status !== 'Up');

  return (
    <div className="space-y-3">
      <Fields
        fields={[
          ['Letzte interne IP', <span key="i" className="font-mono text-xs">{net.lastIpAddress ?? '—'}</span>],
          ['Oeffentliche IP (Standort)', <span key="e" className="font-mono text-xs">{net.lastExternalIpAddress ?? '—'}</span>],
        ]}
      />
      {active.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {active.map((a) => (
            <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-mono text-xs">{a.ipv4.join(', ') || '—'}</span>
                {a.ipv6.length > 0 && <span className="ml-2 text-xs text-muted-foreground">+{a.ipv6.length} IPv6</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {a.type ?? '—'} · <span className="font-mono">{a.macAddress ?? '—'}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Der Sensor hat keine aktive Schnittstelle mit Adresse gemeldet.</p>
      )}
      {(inactive.length > 0 || net.interfaces.length > active.length) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Alle Schnittstellen laut Sensor ({net.interfaces.length}), inklusive inaktiver, Loopback und Link-Local
          </summary>
          <div className="mt-2 overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Adresse</th>
                  <th className="px-3 py-1.5 font-medium">MAC</th>
                  <th className="px-3 py-1.5 font-medium">Typ</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {net.interfaces.map((i) => (
                  <tr key={`${i.ipAddress}-${i.macAddress ?? ''}`} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-mono text-xs">{i.ipAddress}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{i.macAddress ?? '—'}</td>
                    <td className="px-3 py-1.5">{i.type ?? '—'}</td>
                    <td className={clsx('px-3 py-1.5', i.status !== 'Up' && 'text-muted-foreground')}>{i.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="text-xs text-muted-foreground">Gateway, DNS und Verbindungsart liefert das Skript Netzwerkinfo im Tab Skripte.</p>
    </div>
  );
}

function OverviewTab({ base, tenantId, device }: { base: string; tenantId: string; device: Device }) {
  const intune = device.intune;
  const defender = device.defender;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Hardware</h2>
        {intune ? (
          <div className="space-y-3">
            <Fields
              fields={[
                ['Hersteller', intune.manufacturer ?? '—'],
                ['Modell', intune.model ?? '—'],
                ['Seriennummer', <span key="s" className="font-mono text-xs">{intune.serialNumber ?? '—'}</span>],
                ['Arbeitsspeicher', formatBytes(intune.physicalMemoryBytes)],
                ['WLAN-MAC', <span key="m" className="font-mono text-xs">{intune.wifiMacAddress ?? '—'}</span>],
                ['Verschluesselt', intune.isEncrypted === null ? '—' : intune.isEncrypted ? 'ja' : 'nein'],
              ]}
            />
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Systemspeicher</p>
              <StorageBar total={intune.totalStorageBytes} free={intune.freeStorageBytes} />
            </div>
            <p className="text-xs text-muted-foreground">Firmware, TPM, Secure Boot und alle Laufwerke liefern die Skripte Systeminfo und Speicherinfo im Tab Skripte.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Hardwaredaten kommen aus Intune; dieses Geraet ist nicht in Intune verwaltet.</p>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Netzwerk</h2>
        <NetworkSection base={base} tenantId={tenantId} device={device} />
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Intune</h2>
        {intune ? (
          <Fields
            fields={[
              ['Compliance', <ComplianceBadge key="c" state={intune.complianceState} />],
              ['Letzter Sync', intune.lastSyncAt ? formatDateTime(intune.lastSyncAt) : '—'],
              ['Registriert', intune.enrolledAt ? formatDateTime(intune.enrolledAt) : '—'],
              ['Besitz', intune.ownerType ?? '—'],
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
        <h2 className="font-medium">Betroffene Software</h2>
        {!posture.software.available ? (
          <CapabilityNotice what="die betroffene Software" {...posture.software} compact />
        ) : posture.software.data.length === 0 ? (
          <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm">Keine Software mit bekannten Schwachstellen.</p>
        ) : (
          <SoftwareTable software={posture.software.data} />
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

function SoftwareTable({ software }: { software: VulnerableSoftware[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Software</th>
            <th className="px-3 py-2 font-medium">Version</th>
            <th className="px-3 py-2 font-medium">Hoechste Schwere</th>
            <th className="px-3 py-2 font-medium">CVEs</th>
            <th className="px-3 py-2 font-medium">Behebende KBs</th>
          </tr>
        </thead>
        <tbody>
          {software.map((s) => (
            <tr key={`${s.vendor}-${s.name}-${s.version}`} className="border-b last:border-0">
              <td className="px-3 py-2">
                <span className="block">{s.name}</span>
                {s.vendor && <span className="block text-xs text-muted-foreground">{s.vendor}</span>}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{s.version ?? '—'}</td>
              <td className="px-3 py-2">
                <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', severityClasses[s.highestSeverity])}>{s.highestSeverity}</span>
              </td>
              <td className="px-3 py-2 tabular-nums">{s.cveCount}</td>
              <td className="px-3 py-2 font-mono text-xs">{s.fixingKbIds.map((kb) => `KB${kb}`).join(', ') || '—'}</td>
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
