/**
 * Mail-Provider (Exchange Online ueber Graph-Nutzungsberichte)
 *
 * Postfachgroessen, Kontingente und Aktivitaet kommen aus den Berichten
 * unter /reports. Graph antwortet dort mit einer Weiterleitung auf eine
 * CSV-Datei; die Werte laufen etwa zwei Tage nach. Braucht nur
 * Reports.Read.All, kein Exchange-PowerShell.
 */

import type {
  CapabilityResult,
  MailActivityDay,
  MailOverviewSet,
  MailStorageDay,
  MailTotals,
  MailboxRecipientType,
  MailboxUsage,
} from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient } from './graph-client.js';
import { GraphApiError } from '../errors.js';

export type ReportPeriod = 'D7' | 'D30' | 'D90' | 'D180';

const RECIPIENT_TYPES: MailboxRecipientType[] = ['UserMailbox', 'SharedMailbox', 'RoomMailbox', 'EquipmentMailbox'];
const INACTIVE_DAYS = 30;

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

function asUnavailable(error: unknown): Unavailable | null {
  if (!(error instanceof GraphApiError)) return null;
  if (error.isAuthError) {
    return { available: false, reason: 'permission-missing', missingPermission: 'Reports.Read.All', detail: error.message };
  }
  // Ohne Exchange Online im Tenant fehlt der Bericht
  if (error.statusCode === 404) {
    return { available: false, reason: 'not-licensed', missingPermission: null, detail: error.message };
  }
  return null;
}

/**
 * CSV wie von Graph geliefert: Kopfzeile, Felder in Anfuehrungszeichen erlaubt,
 * doppelte Anfuehrungszeichen als Escape. Rueckgabe: Zeilen als Objekt je Kopfzeile.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
  if (!header) return [];
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()])));
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bool(value: string | undefined): boolean | null {
  if (!value) return null;
  return /^true$/i.test(value);
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null;
}

// Verborgene Namen erscheinen als Hash ohne @
function looksAnonymised(rows: Record<string, string>[]): boolean {
  const sample = rows.slice(0, 20).map((r) => r['User Principal Name']).filter(Boolean);
  return sample.length > 0 && sample.every((upn) => !upn.includes('@'));
}

export function buildMailboxes(usageRows: Record<string, string>[], activityRows: Record<string, string>[]): MailboxUsage[] {
  const activityByUpn = new Map(activityRows.map((r) => [r['User Principal Name'], r]));
  return usageRows
    .map((r): MailboxUsage => {
      const upn = r['User Principal Name'] ?? '';
      const activity = activityByUpn.get(upn);
      const used = num(r['Storage Used (Byte)']);
      const prohibitSend = num(r['Prohibit Send Quota (Byte)']);
      const type = r['Recipient Type'];
      return {
        userPrincipalName: upn,
        displayName: r['Display Name'] || upn,
        recipientType: RECIPIENT_TYPES.find((t) => t === type) ?? 'unknown',
        isDeleted: bool(r['Is Deleted']) === true,
        createdAt: isoDate(r['Created Date']),
        lastActivityAt: isoDate(r['Last Activity Date']),
        itemCount: num(r['Item Count']),
        storageUsedBytes: used,
        warningQuotaBytes: num(r['Issue Warning Quota (Byte)']),
        prohibitSendQuotaBytes: prohibitSend,
        prohibitSendReceiveQuotaBytes: num(r['Prohibit Send/Receive Quota (Byte)']),
        usagePercent: used !== null && prohibitSend ? Math.round((used / prohibitSend) * 1000) / 10 : null,
        hasArchive: bool(r['Has Archive']),
        sentCount: activity ? num(activity['Send Count']) : null,
        receivedCount: activity ? num(activity['Receive Count']) : null,
        readCount: activity ? num(activity['Read Count']) : null,
      };
    })
    .filter((m) => !m.isDeleted)
    .sort((a, b) => (b.storageUsedBytes ?? 0) - (a.storageUsedBytes ?? 0));
}

export function buildTotals(mailboxes: MailboxUsage[], now: Date): MailTotals {
  const inactiveBefore = now.getTime() - INACTIVE_DAYS * 86400000;
  return {
    mailboxes: mailboxes.length,
    userMailboxes: mailboxes.filter((m) => m.recipientType === 'UserMailbox').length,
    sharedMailboxes: mailboxes.filter((m) => m.recipientType === 'SharedMailbox').length,
    storageUsedBytes: mailboxes.reduce((s, m) => s + (m.storageUsedBytes ?? 0), 0),
    over80Percent: mailboxes.filter((m) => (m.usagePercent ?? 0) >= 80).length,
    over95Percent: mailboxes.filter((m) => (m.usagePercent ?? 0) >= 95).length,
    inactive30Days: mailboxes.filter((m) => m.recipientType === 'UserMailbox' && (!m.lastActivityAt || new Date(m.lastActivityAt).getTime() < inactiveBefore)).length,
    sentInPeriod: mailboxes.reduce((s, m) => s + (m.sentCount ?? 0), 0),
    receivedInPeriod: mailboxes.reduce((s, m) => s + (m.receivedCount ?? 0), 0),
  };
}

export class MailProvider extends BaseResourceProvider {
  readonly name = 'mail';
  readonly requiredScopes = ['Reports.Read.All'];

  constructor(
    private readonly graphClient: GraphClient,
    private readonly now: () => Date = () => new Date()
  ) {
    super();
  }

  private async report(tenantId: string, name: string, period: ReportPeriod): Promise<Record<string, string>[]> {
    const csv = await this.graphClient.get<string>(tenantId, `/reports/${name}(period='${period}')`, this.requiredScopes, {
      responseType: 'text',
      timeoutMs: 60000,
    });
    return parseCsv(csv);
  }

  async getMailOverview(ctx: ProviderContext, period: ReportPeriod = 'D30'): Promise<CapabilityResult<MailOverviewSet>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    let usage: Record<string, string>[];
    let activity: Record<string, string>[];
    let activityCounts: Record<string, string>[];
    let storage: Record<string, string>[];
    try {
      [usage, activity, activityCounts, storage] = await Promise.all([
        this.report(tenantId, 'getMailboxUsageDetail', period),
        this.report(tenantId, 'getEmailActivityUserDetail', period),
        this.report(tenantId, 'getEmailActivityCounts', period),
        this.report(tenantId, 'getMailboxUsageStorage', period),
      ]);
    } catch (error) {
      const unavailable = asUnavailable(error);
      if (unavailable) return unavailable;
      throw error;
    }

    const mailboxes = buildMailboxes(usage, activity);
    const activityByDay: MailActivityDay[] = activityCounts
      .map((r) => ({ date: r['Report Date'], sent: num(r['Send']) ?? 0, received: num(r['Receive']) ?? 0, read: num(r['Read']) ?? 0 }))
      .filter((d) => !!d.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    const storageByDay: MailStorageDay[] = storage
      .map((r) => ({ date: r['Report Date'], storageUsedBytes: num(r['Storage Used (Byte)']) ?? 0 }))
      .filter((d) => !!d.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      available: true,
      data: {
        periodDays: Number(period.slice(1)),
        refreshedAt: isoDate(usage[0]?.['Report Refresh Date'] ?? activityCounts[0]?.['Report Refresh Date']),
        anonymised: looksAnonymised(usage),
        totals: buildTotals(mailboxes, this.now()),
        mailboxes,
        activityByDay,
        storageByDay,
      },
    };
  }
}
