/**
 * Betriebs-Alerts: Regeln ueber Bestandsdaten statt ueber Anmeldungen
 *
 * Reine Funktionen ohne Netzwerkzugriff, damit sie sich gegen feste Daten
 * testen lassen. Jede Regel liefert Befunde im selben Format wie die
 * Anmelde-Regeln; die Ablage je Fingerabdruck verhindert Wiederholungen.
 *
 * Fingerabdruecke sind so gewaehlt, dass ein geschlossener Alert nicht
 * sofort wiederkommt, ein echter neuer Zustand aber schon: veraltete
 * Software je Katalogversion, Postfach je Monat, VM je Tag.
 */

import { createHash } from 'node:crypto';
import type { AnomalyFinding, AzureVm, MailboxUsage, MspAlertSettings, SoftwareOverviewRow } from '@zerostress/types';

function fingerprint(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/** Veraltete Software laut winget-Katalog auf mindestens minDevices Geraeten. */
export function evaluateOutdatedSoftware(tenantId: string, rows: SoftwareOverviewRow[], settings: MspAlertSettings['outdatedSoftware'], now = new Date()): AnomalyFinding[] {
  if (!settings.enabled) return [];
  const at = now.toISOString();
  const findings: AnomalyFinding[] = [];
  for (const row of rows) {
    if (row.status !== 'outdated' || row.outdatedDevices < settings.minDevices || !row.latestVersion) continue;
    const installed = row.versions
      .filter((v) => v.version)
      .sort((a, b) => b.deviceCount - a.deviceCount)
      .slice(0, 5)
      .map((v) => `${v.version} (${v.deviceCount})`);
    findings.push({
      ruleId: 'outdated-software',
      severity: 'low',
      fingerprint: fingerprint(['outdated-software', tenantId, row.key, row.latestVersion]),
      title: `Veraltete Software: ${row.displayName}`,
      summary: `${row.displayName} ist auf ${row.outdatedDevices} von ${row.deviceCount} Geraet${row.deviceCount === 1 ? '' : 'en'} aelter als ${row.latestVersion} (Schwelle ${settings.minDevices}).`,
      userId: null,
      userPrincipalName: null,
      firstSeenAt: at,
      lastSeenAt: at,
      occurrences: row.outdatedDevices,
      evidence: { software: row.displayName, wingetId: row.wingetId, latestVersion: row.latestVersion, outdatedDevices: row.outdatedDevices, devices: row.deviceCount, installedVersions: installed },
    });
  }
  return findings;
}

/** Postfaecher, deren Belegung die Prozentschwelle der Sendesperre erreicht. */
export function evaluateMailboxQuota(tenantId: string, mailboxes: MailboxUsage[], settings: MspAlertSettings['mailboxQuota'], now = new Date()): AnomalyFinding[] {
  if (!settings.enabled) return [];
  const at = now.toISOString();
  const month = at.slice(0, 7);
  const findings: AnomalyFinding[] = [];
  for (const m of mailboxes) {
    if (m.isDeleted || m.usagePercent === null || m.usagePercent < settings.percent) continue;
    const full = m.usagePercent >= 100;
    findings.push({
      ruleId: 'mailbox-quota',
      severity: full ? 'high' : 'medium',
      fingerprint: fingerprint(['mailbox-quota', tenantId, m.userPrincipalName.toLowerCase(), month]),
      title: full ? `Postfach voll: ${m.displayName}` : `Postfach fast voll: ${m.displayName}`,
      summary: `${m.userPrincipalName} belegt ${m.usagePercent} % der Sendesperre${full ? ' und kann keine Mails mehr senden' : ''} (Schwelle ${settings.percent} %).`,
      userId: null,
      userPrincipalName: m.userPrincipalName,
      firstSeenAt: at,
      lastSeenAt: at,
      occurrences: 1,
      evidence: { usagePercent: m.usagePercent, storageUsedBytes: m.storageUsedBytes, prohibitSendQuotaBytes: m.prohibitSendQuotaBytes, recipientType: m.recipientType, hasArchive: m.hasArchive === null ? null : m.hasArchive ? 'yes' : 'no' },
    });
  }
  return findings;
}

/** Wochentag (0 = Sonntag) und Stunde eines Zeitpunkts in der Zeitzone. */
export function localClock(now: Date, timeZone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hour = Number(hourPart) % 24;
  return { hour, weekday: Math.max(0, weekdays.indexOf(weekdayPart)) };
}

/** Liegt der Zeitpunkt ausserhalb der Arbeitszeit? Ende ist exklusiv (19 = bis 18:59). */
export function isOutsideWorkingHours(now: Date, settings: Pick<MspAlertSettings['vmOutsideHours'], 'startHour' | 'endHour' | 'timeZone' | 'weekdaysOnly'>): boolean {
  const { hour, weekday } = localClock(now, settings.timeZone);
  if (settings.weekdaysOnly && (weekday === 0 || weekday === 6)) return true;
  return hour < settings.startHour || hour >= settings.endHour;
}

/** Laufende VMs ausserhalb der Arbeitszeit, ohne Sitzungshosts und ohne Ausnahme-Tag. */
export function evaluateVmsOutsideHours(tenantId: string, vms: AzureVm[], settings: MspAlertSettings['vmOutsideHours'], now = new Date()): AnomalyFinding[] {
  if (!settings.enabled || !isOutsideWorkingHours(now, settings)) return [];
  const at = now.toISOString();
  const day = at.slice(0, 10);
  const tag = settings.excludeTag.toLowerCase();
  const findings: AnomalyFinding[] = [];
  for (const vm of vms) {
    if (vm.powerState !== 'running') continue;
    if (settings.excludeSessionHosts && vm.isSessionHost) continue;
    if (tag && Object.keys(vm.tags).some((k) => k.toLowerCase() === tag)) continue;
    findings.push({
      ruleId: 'vm-outside-hours',
      severity: 'low',
      fingerprint: fingerprint(['vm-outside-hours', tenantId, vm.id.toLowerCase(), day]),
      title: `VM laeuft ausserhalb der Arbeitszeit: ${vm.name}`,
      summary: `${vm.name} (${vm.vmSize}, ${vm.resourceGroup}) laeuft um ${localClock(now, settings.timeZone).hour}:00 ${settings.timeZone}, ausserhalb ${settings.startHour}-${settings.endHour} Uhr. Kosten laufen weiter; Tag "${settings.excludeTag}" setzen, wenn das so gewollt ist.`,
      userId: null,
      userPrincipalName: null,
      firstSeenAt: at,
      lastSeenAt: at,
      occurrences: 1,
      evidence: { vmId: vm.id, vmSize: vm.vmSize, resourceGroup: vm.resourceGroup, subscriptionId: vm.subscriptionId, location: vm.location },
    });
  }
  return findings;
}
