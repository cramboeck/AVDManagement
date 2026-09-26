'use client';

import clsx from 'clsx';
import type { DeploymentStatus, PackageInstallerType, PackageStatus } from '@zerostress/types';

export const installerTypeLabels: Record<PackageInstallerType, string> = {
  msi: 'MSI',
  exe: 'EXE',
  psadt: 'PSADT',
  intunewin: 'Fertiges .intunewin',
  winget: 'winget-Katalog',
  store: 'Microsoft Store',
};

export const packageStatusMeta: Record<PackageStatus, { label: string; className: string }> = {
  draft: { label: 'Entwurf', className: 'bg-muted text-muted-foreground' },
  'installer-uploaded': { label: 'Installer vorhanden', className: 'bg-primary/10 text-primary' },
  queued: { label: 'Build wartet', className: 'bg-warning/10 text-warning' },
  building: { label: 'Wird gebaut', className: 'bg-warning/10 text-warning' },
  ready: { label: 'Bereit', className: 'bg-success/10 text-success' },
  failed: { label: 'Build fehlgeschlagen', className: 'bg-destructive/10 text-destructive' },
};

export const deploymentStatusMeta: Record<DeploymentStatus, { label: string; className: string }> = {
  pending: { label: 'Geplant', className: 'bg-muted text-muted-foreground' },
  publishing: { label: 'Wird veroeffentlicht', className: 'bg-warning/10 text-warning' },
  published: { label: 'Veroeffentlicht', className: 'bg-success/10 text-success' },
  failed: { label: 'Fehlgeschlagen', className: 'bg-destructive/10 text-destructive' },
  superseded: { label: 'Ersetzt', className: 'bg-muted text-muted-foreground' },
};

export function PackageStatusBadge({ status }: { status: PackageStatus }) {
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', packageStatusMeta[status].className)}>{packageStatusMeta[status].label}</span>;
}

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }) {
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', deploymentStatusMeta[status].className)}>{deploymentStatusMeta[status].label}</span>;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
