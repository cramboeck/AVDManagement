'use client';

import clsx from 'clsx';
import type { DeviceComplianceState, DeviceExposureLevel, DeviceRiskScore, DeviceHealthStatus } from '@zerostress/types';

export const complianceLabels: Record<DeviceComplianceState, string> = {
  compliant: 'Konform',
  noncompliant: 'Nicht konform',
  inGracePeriod: 'Kulanzfrist',
  conflict: 'Konflikt',
  error: 'Fehler',
  notApplicable: 'Nicht anwendbar',
  unknown: 'Unbekannt',
};

const complianceClasses: Record<DeviceComplianceState, string> = {
  compliant: 'bg-success/10 text-success',
  noncompliant: 'bg-destructive/10 text-destructive',
  inGracePeriod: 'bg-warning/10 text-warning',
  conflict: 'bg-warning/10 text-warning',
  error: 'bg-destructive/10 text-destructive',
  notApplicable: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

const levelClasses: Record<string, string> = {
  None: 'bg-success/10 text-success',
  Informational: 'bg-muted text-muted-foreground',
  Low: 'bg-success/10 text-success',
  Medium: 'bg-warning/10 text-warning',
  High: 'bg-destructive/10 text-destructive',
  Unknown: 'bg-muted text-muted-foreground',
};

export const healthLabels: Record<DeviceHealthStatus, string> = {
  Active: 'Aktiv',
  Inactive: 'Inaktiv',
  ImpairedCommunication: 'Kommunikation gestoert',
  NoSensorData: 'Keine Sensordaten',
  NoSensorDataImpairedCommunication: 'Keine Sensordaten, Kommunikation gestoert',
  Unknown: 'Unbekannt',
};

function Pill({ className, children, title }: { className: string; children: React.ReactNode; title?: string }) {
  return (
    <span className={clsx('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', className)} title={title}>
      {children}
    </span>
  );
}

export function ComplianceBadge({ state }: { state: DeviceComplianceState }) {
  return <Pill className={complianceClasses[state]}>{complianceLabels[state]}</Pill>;
}

export function ExposureBadge({ level }: { level: DeviceExposureLevel }) {
  return (
    <Pill className={levelClasses[level]} title="Exposure Level (Defender)">
      Exposure {level === 'Unknown' ? '?' : level}
    </Pill>
  );
}

export function RiskBadge({ score }: { score: DeviceRiskScore }) {
  return (
    <Pill className={levelClasses[score]} title="Risk Score (Defender)">
      Risiko {score === 'Unknown' ? '?' : score}
    </Pill>
  );
}

export function HealthBadge({ status }: { status: DeviceHealthStatus }) {
  const tone = status === 'Active' ? 'bg-success/10 text-success' : status === 'Unknown' ? 'bg-muted text-muted-foreground' : 'bg-warning/10 text-warning';
  return <Pill className={tone}>{healthLabels[status]}</Pill>;
}

export function SourceChips({ intune, defender }: { intune: boolean; defender: boolean }) {
  return (
    <span className="inline-flex gap-1">
      <span className={clsx('rounded px-1.5 py-0.5 font-mono text-xs', intune ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground line-through')} title="Intune">
        I
      </span>
      <span className={clsx('rounded px-1.5 py-0.5 font-mono text-xs', defender ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground line-through')} title="Defender">
        D
      </span>
    </span>
  );
}

export function formatRelative(value: string | null): string {
  if (!value) return '—';
  const diffMs = Date.now() - new Date(value).getTime();
  const hours = Math.round(diffMs / 3600000);
  if (hours < 1) return 'gerade eben';
  if (hours < 48) return `vor ${hours} h`;
  const days = Math.round(hours / 24);
  return `vor ${days} Tagen`;
}
