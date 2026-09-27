/**
 * Tests fuer die Betriebs-Alerts: veraltete Software, Postfachkontingent,
 * VMs ausserhalb der Arbeitszeit, plus Normalisierung der Einstellungen
 */

import { describe, it, expect } from 'vitest';
import type { AzureVm, MailboxUsage, SoftwareOverviewRow } from '@zerostress/types';
import { evaluateMailboxQuota, evaluateOutdatedSoftware, evaluateVmsOutsideHours, isOutsideWorkingHours, localClock } from '../src/security/operational-rules.js';
import { DEFAULT_MSP_SETTINGS, normalizeMspSettings } from '../src/jobs/approval-policy.js';

const row = (patch: Partial<SoftwareOverviewRow>): SoftwareOverviewRow => ({
  key: 'k',
  displayName: '7-Zip',
  publisher: null,
  platform: null,
  versions: [{ id: 'a', version: '23.01', deviceCount: 7 }],
  deviceCount: 7,
  wingetId: '7zip.7zip',
  packageId: null,
  latestVersion: '24.08',
  status: 'outdated',
  outdatedDevices: 7,
  blockedBy: null,
  ...patch,
});

const mailbox = (patch: Partial<MailboxUsage>): MailboxUsage => ({
  userPrincipalName: 'max@contoso.com',
  displayName: 'Max',
  recipientType: 'UserMailbox',
  isDeleted: false,
  createdAt: null,
  lastActivityAt: null,
  itemCount: null,
  storageUsedBytes: 90,
  warningQuotaBytes: null,
  prohibitSendQuotaBytes: 100,
  prohibitSendReceiveQuotaBytes: null,
  usagePercent: 90,
  hasArchive: false,
  sentCount: null,
  receivedCount: null,
  readCount: null,
  ...patch,
});

const vm = (patch: Partial<AzureVm>): AzureVm => ({
  id: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1',
  name: 'vm1',
  subscriptionId: 's',
  resourceGroup: 'rg',
  location: 'germanywestcentral',
  vmSize: 'Standard_D2s_v5',
  osType: 'Windows',
  powerState: 'running',
  provisioningState: null,
  computerName: null,
  imageReference: null,
  timeCreated: null,
  tags: {},
  isSessionHost: false,
  ...patch,
});

// Dienstag 22:00 in Berlin (Sommerzeit, UTC+2)
const tuesdayNight = new Date('2026-06-16T20:00:00Z');
// Dienstag 10:00 in Berlin
const tuesdayMorning = new Date('2026-06-16T08:00:00Z');
// Samstag 10:00 in Berlin
const saturday = new Date('2026-06-20T08:00:00Z');
const vmSettings = { ...DEFAULT_MSP_SETTINGS.alerts.vmOutsideHours, enabled: true };

describe('evaluateOutdatedSoftware', () => {
  it('reports outdated rows at or above the device threshold', () => {
    const findings = evaluateOutdatedSoftware('t1', [row({}), row({ key: 'few', outdatedDevices: 2 }), row({ key: 'cur', status: 'current' })], { enabled: true, minDevices: 5 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'outdated-software', severity: 'low', occurrences: 7 });
    expect(findings[0].evidence.installedVersions).toEqual(['23.01 (7)']);
  });

  it('changes the fingerprint when the catalogue version moves on', () => {
    const [a] = evaluateOutdatedSoftware('t1', [row({})], { enabled: true, minDevices: 1 });
    const [b] = evaluateOutdatedSoftware('t1', [row({ latestVersion: '24.09' })], { enabled: true, minDevices: 1 });
    const [c] = evaluateOutdatedSoftware('t2', [row({})], { enabled: true, minDevices: 1 });
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it('is silent when disabled', () => {
    expect(evaluateOutdatedSoftware('t1', [row({})], { enabled: false, minDevices: 1 })).toEqual([]);
  });
});

describe('evaluateMailboxQuota', () => {
  it('flags mailboxes at the threshold, full ones as high', () => {
    const findings = evaluateMailboxQuota('t1', [mailbox({}), mailbox({ userPrincipalName: 'voll@contoso.com', usagePercent: 100 }), mailbox({ userPrincipalName: 'ok@contoso.com', usagePercent: 40 }), mailbox({ userPrincipalName: 'weg@contoso.com', isDeleted: true }), mailbox({ userPrincipalName: 'na@contoso.com', usagePercent: null })], { enabled: true, percent: 90 });
    expect(findings.map((f) => [f.userPrincipalName, f.severity])).toEqual([
      ['max@contoso.com', 'medium'],
      ['voll@contoso.com', 'high'],
    ]);
  });

  it('uses one fingerprint per mailbox and month', () => {
    const [june] = evaluateMailboxQuota('t1', [mailbox({})], { enabled: true, percent: 90 }, new Date('2026-06-10T00:00:00Z'));
    const [juneAgain] = evaluateMailboxQuota('t1', [mailbox({})], { enabled: true, percent: 90 }, new Date('2026-06-25T00:00:00Z'));
    const [july] = evaluateMailboxQuota('t1', [mailbox({})], { enabled: true, percent: 90 }, new Date('2026-07-01T00:00:00Z'));
    expect(june.fingerprint).toBe(juneAgain.fingerprint);
    expect(june.fingerprint).not.toBe(july.fingerprint);
  });
});

describe('working hours', () => {
  it('converts to the configured time zone', () => {
    expect(localClock(tuesdayNight, 'Europe/Berlin')).toEqual({ hour: 22, weekday: 2 });
    expect(localClock(tuesdayNight, 'UTC')).toEqual({ hour: 20, weekday: 2 });
    expect(localClock(saturday, 'Europe/Berlin').weekday).toBe(6);
  });

  it('treats the end hour as exclusive and weekends as outside when configured', () => {
    expect(isOutsideWorkingHours(tuesdayMorning, vmSettings)).toBe(false);
    expect(isOutsideWorkingHours(tuesdayNight, vmSettings)).toBe(true);
    expect(isOutsideWorkingHours(new Date('2026-06-16T17:30:00Z'), vmSettings)).toBe(true); // 19:30 Berlin
    expect(isOutsideWorkingHours(saturday, vmSettings)).toBe(true);
    expect(isOutsideWorkingHours(saturday, { ...vmSettings, weekdaysOnly: false })).toBe(false);
  });
});

describe('evaluateVmsOutsideHours', () => {
  it('reports running VMs at night and skips session hosts, tagged and stopped VMs', () => {
    const vms = [vm({}), vm({ id: 'sh', name: 'avd-1', isSessionHost: true }), vm({ id: 'tagged', name: 'dc01', tags: { 'ZSC-Always-On': 'true' } }), vm({ id: 'off', name: 'off', powerState: 'deallocated' })];
    const findings = evaluateVmsOutsideHours('t1', vms, vmSettings, tuesdayNight);
    expect(findings.map((f) => f.title)).toEqual(['VM laeuft ausserhalb der Arbeitszeit: vm1']);
    expect(findings[0].summary).toContain('22:00 Europe/Berlin');
  });

  it('includes session hosts when the exclusion is off', () => {
    const findings = evaluateVmsOutsideHours('t1', [vm({ isSessionHost: true })], { ...vmSettings, excludeSessionHosts: false }, tuesdayNight);
    expect(findings).toHaveLength(1);
  });

  it('is silent during working hours and when disabled', () => {
    expect(evaluateVmsOutsideHours('t1', [vm({})], vmSettings, tuesdayMorning)).toEqual([]);
    expect(evaluateVmsOutsideHours('t1', [vm({})], { ...vmSettings, enabled: false }, tuesdayNight)).toEqual([]);
  });

  it('uses one fingerprint per VM and day', () => {
    const [a] = evaluateVmsOutsideHours('t1', [vm({})], vmSettings, tuesdayNight);
    const [b] = evaluateVmsOutsideHours('t1', [vm({})], vmSettings, new Date('2026-06-16T21:00:00Z'));
    const [c] = evaluateVmsOutsideHours('t1', [vm({})], vmSettings, new Date('2026-06-17T20:00:00Z'));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
});

describe('normalizeMspSettings alerts', () => {
  it('fills defaults and rejects bad values', () => {
    expect(normalizeMspSettings(null).alerts).toEqual(DEFAULT_MSP_SETTINGS.alerts);
    const s = normalizeMspSettings({
      alerts: {
        outdatedSoftware: { enabled: true, minDevices: 0 },
        mailboxQuota: { enabled: true, percent: 120 },
        vmOutsideHours: { enabled: true, startHour: 8, endHour: 25, timeZone: 'Mars/Olympus', weekdaysOnly: false, excludeTag: '  keep-on  ' },
      },
    }).alerts;
    expect(s.outdatedSoftware).toEqual({ enabled: true, minDevices: 5 });
    expect(s.mailboxQuota).toEqual({ enabled: true, percent: 90 });
    expect(s.vmOutsideHours).toEqual({ enabled: true, startHour: 8, endHour: 19, timeZone: 'Europe/Berlin', weekdaysOnly: false, excludeSessionHosts: true, excludeTag: 'keep-on' });
  });
});
