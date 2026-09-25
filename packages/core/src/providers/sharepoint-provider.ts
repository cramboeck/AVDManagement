/**
 * SharePoint- und OneDrive-Provider (Graph-Nutzungsberichte)
 *
 * Websites mit Speicher und Aktivitaet sowie je Benutzer die Zahl der
 * extern geteilten Dateien im Zeitraum. Braucht nur Reports.Read.All;
 * eine Freigabeliste je Datei braucht Sites.Read.All und eine Suche ueber
 * alle Bibliotheken und bleibt der naechsten Stufe vorbehalten.
 */

import type { CapabilityResult, SharePointOverviewSet, SharePointSite, SharingUser } from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient } from './graph-client.js';
import { GraphApiError } from '../errors.js';
import { parseCsv, type ReportPeriod } from './mail-provider.js';

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

function asUnavailable(error: unknown): Unavailable | null {
  if (!(error instanceof GraphApiError)) return null;
  if (error.isAuthError) {
    return { available: false, reason: 'permission-missing', missingPermission: 'Reports.Read.All', detail: error.message };
  }
  if (error.statusCode === 404) {
    return { available: false, reason: 'not-licensed', missingPermission: null, detail: error.message };
  }
  return null;
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoDate(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null;
}

const TEMPLATE_LABELS: Record<string, SharePointSite['kind']> = {
  'Group': 'team',
  'Team Channel': 'team',
  'Communication Site': 'communication',
  'Team Site': 'classic',
  'Project Site': 'classic',
  'OneDrive': 'onedrive',
};

export function buildSites(rows: Record<string, string>[]): SharePointSite[] {
  return rows
    .filter((r) => !/^true$/i.test(r['Is Deleted'] ?? ''))
    .map((r) => {
      const template = r['Root Web Template'] ?? '';
      const kind = TEMPLATE_LABELS[template] ?? (/OneDrive|SPSPERS/i.test(template) ? 'onedrive' : 'other');
      return {
        siteId: r['Site Id'] || r['Site URL'] || '',
        url: r['Site URL'] || null,
        kind,
        template: template || null,
        ownerPrincipalName: r['Owner Principal Name'] || null,
        ownerDisplayName: r['Owner Display Name'] || null,
        lastActivityAt: isoDate(r['Last Activity Date']),
        fileCount: num(r['File Count']),
        activeFileCount: num(r['Active File Count']),
        storageUsedBytes: num(r['Storage Used (Byte)']),
        storageAllocatedBytes: num(r['Storage Allocated (Byte)']),
        secureLinkForGuestCount: num(r['Secure Link For Guest Count']),
        secureLinkForMemberCount: num(r['Secure Link For Member Count']),
        anonymousLinkCount: num(r['Anonymous Link Count']),
        companyLinkCount: num(r['Company Link Count']),
      };
    })
    .sort((a, b) => (b.storageUsedBytes ?? 0) - (a.storageUsedBytes ?? 0));
}

export function buildSharingUsers(rows: Record<string, string>[]): SharingUser[] {
  return rows
    .filter((r) => !/^true$/i.test(r['Is Deleted'] ?? ''))
    .map((r) => ({
      userPrincipalName: r['User Principal Name'] ?? '',
      lastActivityAt: isoDate(r['Last Activity Date']),
      sharedExternallyFileCount: num(r['Shared Externally File Count']) ?? 0,
      sharedInternallyFileCount: num(r['Shared Internally File Count']) ?? 0,
      viewedOrEditedFileCount: num(r['Viewed Or Edited File Count']) ?? 0,
    }))
    .filter((u) => u.sharedExternallyFileCount > 0 || u.sharedInternallyFileCount > 0)
    .sort((a, b) => b.sharedExternallyFileCount - a.sharedExternallyFileCount || b.sharedInternallyFileCount - a.sharedInternallyFileCount);
}

export class SharePointProvider extends BaseResourceProvider {
  readonly name = 'sharepoint';
  readonly requiredScopes = ['Reports.Read.All'];

  constructor(private readonly graphClient: GraphClient) {
    super();
  }

  private async report(tenantId: string, name: string, period: ReportPeriod): Promise<Record<string, string>[]> {
    const csv = await this.graphClient.get<string>(tenantId, `/reports/${name}(period='${period}')`, this.requiredScopes, { responseType: 'text', timeoutMs: 60000 });
    return parseCsv(csv);
  }

  async getOverview(ctx: ProviderContext, period: ReportPeriod = 'D30'): Promise<CapabilityResult<SharePointOverviewSet>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    let siteRows: Record<string, string>[];
    let activityRows: Record<string, string>[];
    let oneDriveRows: Record<string, string>[];
    try {
      [siteRows, activityRows, oneDriveRows] = await Promise.all([
        this.report(tenantId, 'getSharePointSiteUsageDetail', period),
        this.report(tenantId, 'getSharePointActivityUserDetail', period),
        this.report(tenantId, 'getOneDriveActivityUserDetail', period),
      ]);
    } catch (error) {
      const unavailable = asUnavailable(error);
      if (unavailable) return unavailable;
      throw error;
    }

    const sites = buildSites(siteRows);
    const spUsers = buildSharingUsers(activityRows);
    const odUsers = buildSharingUsers(oneDriveRows);
    const byUpn = new Map<string, SharingUser>();
    for (const u of [...spUsers, ...odUsers]) {
      const existing = byUpn.get(u.userPrincipalName);
      if (!existing) {
        byUpn.set(u.userPrincipalName, { ...u });
        continue;
      }
      existing.sharedExternallyFileCount += u.sharedExternallyFileCount;
      existing.sharedInternallyFileCount += u.sharedInternallyFileCount;
      existing.viewedOrEditedFileCount += u.viewedOrEditedFileCount;
      if (!existing.lastActivityAt || (u.lastActivityAt && u.lastActivityAt > existing.lastActivityAt)) existing.lastActivityAt = u.lastActivityAt;
    }
    const sharingUsers = Array.from(byUpn.values()).sort((a, b) => b.sharedExternallyFileCount - a.sharedExternallyFileCount);
    const anonymised = sites.slice(0, 20).some((s) => s.ownerPrincipalName && !s.ownerPrincipalName.includes('@')) || sharingUsers.slice(0, 20).every((u) => u.userPrincipalName && !u.userPrincipalName.includes('@'));

    return {
      available: true,
      data: {
        periodDays: Number(period.slice(1)),
        refreshedAt: isoDate(siteRows[0]?.['Report Refresh Date'] ?? activityRows[0]?.['Report Refresh Date']),
        anonymised,
        sites,
        sharingUsers,
        totals: {
          sites: sites.length,
          teamSites: sites.filter((s) => s.kind === 'team').length,
          storageUsedBytes: sites.reduce((s, x) => s + (x.storageUsedBytes ?? 0), 0),
          sitesWithAnonymousLinks: sites.filter((s) => (s.anonymousLinkCount ?? 0) > 0).length,
          sitesWithGuestLinks: sites.filter((s) => (s.secureLinkForGuestCount ?? 0) > 0).length,
          usersSharingExternally: sharingUsers.filter((u) => u.sharedExternallyFileCount > 0).length,
          filesSharedExternally: sharingUsers.reduce((s, u) => s + u.sharedExternallyFileCount, 0),
          inactiveSites90Days: sites.filter((s) => !s.lastActivityAt || Date.now() - new Date(s.lastActivityAt).getTime() > 90 * 86400000).length,
        },
      },
    };
  }
}
