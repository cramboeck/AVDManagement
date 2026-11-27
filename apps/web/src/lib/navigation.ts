/**
 * Ziele der Befehlspalette mit Suchbegriffen. Die Seitenleiste hat ihre
 * eigenen Icons; Pfade und Namen sollen mit ihr uebereinstimmen.
 */
export interface PaletteTarget {
  href: string;
  label: string;
  keywords: string;
}

export const PALETTE_TARGETS: PaletteTarget[] = [
  { href: '/', label: 'Dashboard', keywords: 'start uebersicht' },
  { href: '/tenants', label: 'Tenants', keywords: 'kunden consent nur-lesen' },
  { href: '/avd', label: 'Virtual Desktop', keywords: 'avd hostpool session host' },
  { href: '/vms', label: 'Azure VMs', keywords: 'vm server azure' },
  { href: '/users', label: 'Benutzer', keywords: 'user konto passwort lizenz' },
  { href: '/groups', label: 'Gruppen', keywords: 'group mitglieder' },
  { href: '/mail', label: 'Exchange', keywords: 'postfach mailbox weiterleitung' },
  { href: '/sharepoint', label: 'SharePoint', keywords: 'onedrive freigabe' },
  { href: '/devices', label: 'Geraete', keywords: 'intune device client' },
  { href: '/apps', label: 'Apps', keywords: 'intune app zuweisung paket' },
  { href: '/software', label: 'Software', keywords: 'winget inventar update' },
  { href: '/network', label: 'Netzwerk', keywords: 'verbindungen hunting' },
  { href: '/security', label: 'Sicherheit', keywords: 'secure score best practices baselines haertung cis' },
  { href: '/security/vulnerabilities', label: 'Schwachstellen', keywords: 'cve vulnerability' },
  { href: '/alerts', label: 'Alerts', keywords: 'anomalie monitor' },
  { href: '/jobs', label: 'Jobs', keywords: 'freigabe vorschau' },
  { href: '/audit', label: 'Audit-Log', keywords: 'protokoll wer wann' },
  { href: '/settings', label: 'Einstellungen', keywords: 'team vier-augen worker token schwellen' },
];
