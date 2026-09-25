/**
 * Tests fuer SharePointProvider (Berichte als CSV, gemockt)
 */

import { describe, it, expect, vi } from 'vitest';
import { SharePointProvider, buildSites, buildSharingUsers } from '../src/providers/sharepoint-provider.js';
import { parseCsv } from '../src/providers/mail-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import type { TenantId } from '@zerostress/types';

const ctx = { tenantId: 'tenant-1' as TenantId, correlationId: 'c' };

const sitesCsv = [
  'Report Refresh Date,Site Id,Site URL,Owner Display Name,Is Deleted,Last Activity Date,File Count,Active File Count,Page View Count,Visited Page Count,Storage Used (Byte),Storage Allocated (Byte),Root Web Template,Owner Principal Name,Secure Link For Guest Count,Secure Link For Member Count,Anonymous Link Count,Company Link Count,Report Period',
  '2026-09-23,s1,https://contoso.sharepoint.com/sites/Vertrieb,Max,False,2026-09-20,1200,30,10,5,50000000000,1000000000000,Group,max@contoso.com,3,10,1,4,30',
  '2026-09-23,s2,https://contoso.sharepoint.com/sites/Alt,Eva,False,2025-01-01,10,0,0,0,1000,1000000000000,Team Site,eva@contoso.com,0,0,0,0,30',
  '2026-09-23,s3,https://contoso.sharepoint.com/sites/Weg,Tom,True,2026-09-01,1,0,0,0,1,1,Group,tom@contoso.com,0,0,0,0,30',
].join('\n');
const spUsersCsv = ['Report Refresh Date,User Principal Name,Is Deleted,Deleted Date,Last Activity Date,Viewed Or Edited File Count,Synced File Count,Shared Internally File Count,Shared Externally File Count,Visited Page Count,Assigned Products,Report Period', '2026-09-23,max@contoso.com,False,,2026-09-22,40,5,3,2,10,BP,30', '2026-09-23,eva@contoso.com,False,,2026-09-22,4,0,0,0,1,BP,30'].join('\n');
const odUsersCsv = ['Report Refresh Date,User Principal Name,Is Deleted,Deleted Date,Last Activity Date,Viewed Or Edited File Count,Synced File Count,Shared Internally File Count,Shared Externally File Count,Assigned Products,Report Period', '2026-09-23,max@contoso.com,False,,2026-09-23,10,0,1,5,BP,30', '2026-09-23,lea@contoso.com,False,,2026-09-21,2,0,0,1,BP,30'].join('\n');

describe('SharePointProvider', () => {
  it('builds sites without deleted ones and classifies templates', () => {
    const sites = buildSites(parseCsv(sitesCsv));
    expect(sites.map((s) => s.siteId)).toEqual(['s1', 's2']);
    expect(sites[0]).toMatchObject({ kind: 'team', anonymousLinkCount: 1, secureLinkForGuestCount: 3 });
    expect(sites[1].kind).toBe('classic');
  });

  it('keeps only users who shared and merges SharePoint with OneDrive', async () => {
    expect(buildSharingUsers(parseCsv(spUsersCsv)).map((u) => u.userPrincipalName)).toEqual(['max@contoso.com']);
    const graph = {
      get: vi.fn(async (_t: string, path: string) => (path.includes('SiteUsage') ? sitesCsv : path.includes('OneDrive') ? odUsersCsv : spUsersCsv)),
    };
    const result = await new SharePointProvider(graph as unknown as GraphClient).getOverview(ctx);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.data.sharingUsers.map((u) => [u.userPrincipalName, u.sharedExternallyFileCount])).toEqual([
      ['max@contoso.com', 7],
      ['lea@contoso.com', 1],
    ]);
    expect(result.data.totals).toMatchObject({ sites: 2, teamSites: 1, sitesWithAnonymousLinks: 1, sitesWithGuestLinks: 1, usersSharingExternally: 2, filesSharedExternally: 8 });
    expect(result.data.anonymised).toBe(false);
  });
});
