'use client';

import clsx from 'clsx';
import type { AppAssignment, AppAssignmentIntent, AppInstallState, IntuneAppType } from '@zerostress/types';

export const appTypeLabels: Record<IntuneAppType, string> = {
  win32LobApp: 'Win32',
  winGetApp: 'winget',
  windowsMobileMSI: 'MSI',
  officeSuiteApp: 'Microsoft 365 Apps',
  windowsMicrosoftEdgeApp: 'Edge',
  microsoftStoreForBusinessApp: 'Store',
  webApp: 'Web-Link',
  windowsUniversalAppX: 'AppX',
  other: 'Sonstige',
};

export const intentLabels: Record<AppAssignmentIntent, string> = {
  required: 'Erforderlich',
  available: 'Verfuegbar',
  uninstall: 'Deinstallieren',
  availableWithoutEnrollment: 'Verfuegbar ohne Registrierung',
};

export const intentClasses: Record<AppAssignmentIntent, string> = {
  required: 'bg-primary/10 text-primary',
  available: 'bg-muted text-muted-foreground',
  uninstall: 'bg-destructive/10 text-destructive',
  availableWithoutEnrollment: 'bg-muted text-muted-foreground',
};

export const installStateLabels: Record<AppInstallState, string> = {
  installed: 'Installiert',
  failed: 'Fehlgeschlagen',
  pending: 'Ausstehend',
  notInstalled: 'Nicht installiert',
  notApplicable: 'Nicht anwendbar',
  uninstallFailed: 'Deinstallation fehlgeschlagen',
  unknown: 'Unbekannt',
};

export function describeTarget(a: AppAssignment): string {
  if (a.targetType === 'allUsers') return 'Alle Benutzer';
  if (a.targetType === 'allDevices') return 'Alle Geraete';
  const name = a.groupName ?? a.groupId ?? 'Gruppe';
  return a.targetType === 'exclusionGroup' ? `Ausschluss: ${name}` : name;
}

export function IntentBadge({ intent }: { intent: AppAssignmentIntent }) {
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', intentClasses[intent])}>{intentLabels[intent]}</span>;
}

export function InstallStateBadge({ state }: { state: AppInstallState }) {
  const className =
    state === 'installed' ? 'bg-success/10 text-success' : state === 'failed' || state === 'uninstallFailed' ? 'bg-destructive/10 text-destructive' : state === 'pending' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground';
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', className)}>{installStateLabels[state]}</span>;
}
