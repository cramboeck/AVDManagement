'use client';

import clsx from 'clsx';
import type { GroupFlag, GroupKind, GroupVisibility } from '@zerostress/types';

export const kindLabels: Record<GroupKind, string> = {
  team: 'Team',
  microsoft365: 'Microsoft 365',
  security: 'Sicherheit',
  distribution: 'Verteiler',
  'mail-enabled-security': 'Sicherheit (E-Mail)',
};

export const visibilityLabels: Record<GroupVisibility, string> = {
  Public: 'Oeffentlich',
  Private: 'Privat',
  HiddenMembership: 'Verborgen',
  unknown: '—',
};

export const flagLabels: Record<GroupFlag, { label: string; className: string; hint: string }> = {
  ownerless: { label: 'Ohne Besitzer', className: 'bg-destructive/10 text-destructive', hint: 'Niemand kann Mitglieder pflegen oder die Gruppe verlaengern.' },
  'single-owner': { label: 'Ein Besitzer', className: 'bg-warning/10 text-warning', hint: 'Faellt der Besitzer aus, ist die Gruppe verwaist. Microsoft empfiehlt zwei.' },
  'public-team': { label: 'Oeffentliches Team', className: 'bg-warning/10 text-warning', hint: 'Jeder im Tenant kann beitreten und alle Inhalte lesen.' },
  'has-guests': { label: 'Gaeste', className: 'bg-primary/10 text-primary', hint: 'Externe Konten sind Mitglied.' },
  dynamic: { label: 'Dynamisch', className: 'bg-muted text-muted-foreground', hint: 'Mitglieder kommen aus einer Regel, nicht aus manueller Pflege.' },
  empty: { label: 'Leer', className: 'bg-muted text-muted-foreground', hint: 'Keine Mitglieder.' },
};

export function KindBadge({ kind }: { kind: GroupKind }) {
  return (
    <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', kind === 'team' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
      {kindLabels[kind]}
    </span>
  );
}

export function FlagBadges({ flags }: { flags: GroupFlag[] }) {
  if (flags.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f} title={flagLabels[f].hint} className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', flagLabels[f].className)}>
          {flagLabels[f].label}
        </span>
      ))}
    </span>
  );
}
