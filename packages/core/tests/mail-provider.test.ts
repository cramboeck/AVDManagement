/**
 * Tests fuer MailProvider (Graph-Berichte als CSV, gemockt)
 */

import { describe, it, expect, vi } from 'vitest';
import { MailProvider, parseCsv, buildMailboxes, buildTotals } from '../src/providers/mail-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { TenantId } from '@zerostress/types';

const ctx = { tenantId: 'tenant-1' as TenantId, correlationId: 'corr-1' };
const NOW = new Date('2026-09-25T12:00:00Z');

const usageCsv = [
  '﻿Report Refresh Date,User Principal Name,Display Name,Is Deleted,Deleted Date,Created Date,Last Activity Date,Item Count,Storage Used (Byte),Issue Warning Quota (Byte),Prohibit Send Quota (Byte),Prohibit Send/Receive Quota (Byte),Deleted Item Count,Deleted Item Size (Byte),Deleted Item Quota (Byte),Has Archive,Recipient Type,Report Period',
  '2026-09-23,max@contoso.com,"Mustermann, Max",False,,2024-01-05,2026-09-22,12000,51000000000,52000000000,53000000000,55000000000,10,1000,30000000000,True,UserMailbox,30',
  '2026-09-23,info@contoso.com,Info,False,,2023-05-01,2026-06-01,300,1000000000,52000000000,53000000000,55000000000,0,0,30000000000,False,SharedMailbox,30',
  '2026-09-23,old@contoso.com,Alt,True,2026-01-01,2020-01-01,2025-12-31,1,1,52000000000,53000000000,55000000000,0,0,30000000000,False,UserMailbox,30',
  '2026-09-23,quiet@contoso.com,Ruhig,False,,2024-01-05,,5,2000,52000000000,53000000000,55000000000,0,0,30000000000,False,UserMailbox,30',
  '',
].join('\r\n');

const activityCsv = [
  'Report Refresh Date,User Principal Name,Display Name,Is Deleted,Deleted Date,Last Activity Date,Send Count,Receive Count,Read Count,Meeting Created Count,Meeting Interacted Count,Assigned Products,Report Period',
  '2026-09-23,max@contoso.com,Max,False,,2026-09-22,120,900,700,3,5,MICROSOFT 365 BUSINESS PREMIUM,30',
].join('\n');

const countsCsv = ['Report Refresh Date,Send,Receive,Read,Meeting Created,Meeting Interacted,Report Date,Report Period', '2026-09-23,10,50,40,1,1,2026-09-22,30', '2026-09-23,8,45,30,0,0,2026-09-21,30'].join('\n');
const storageCsv = ['Report Refresh Date,Storage Used (Byte),Report Date,Report Period', '2026-09-23,52000002000,2026-09-22,30'].join('\n');

describe('parseCsv', () => {
  it('handles BOM, quoted commas and CRLF', () => {
    const rows = parseCsv(usageCsv);
    expect(rows).toHaveLength(4);
    expect(rows[0]['Display Name']).toBe('Mustermann, Max');
    expect(rows[0]['Report Refresh Date']).toBe('2026-09-23');
  });
});

describe('buildMailboxes / buildTotals', () => {
  it('joins usage with activity, drops deleted mailboxes and computes quota usage', () => {
    const mailboxes = buildMailboxes(parseCsv(usageCsv), parseCsv(activityCsv));
    expect(mailboxes.map((m) => m.userPrincipalName)).toEqual(['max@contoso.com', 'info@contoso.com', 'quiet@contoso.com']);
    expect(mailboxes[0]).toMatchObject({ recipientType: 'UserMailbox', usagePercent: 96.2, hasArchive: true, sentCount: 120, receivedCount: 900 });
    expect(mailboxes[1]).toMatchObject({ recipientType: 'SharedMailbox', sentCount: null });
    expect(mailboxes[2].lastActivityAt).toBeNull();

    const totals = buildTotals(mailboxes, NOW);
    expect(totals).toMatchObject({ mailboxes: 3, userMailboxes: 2, sharedMailboxes: 1, over80Percent: 1, over95Percent: 1, inactive30Days: 1, sentInPeriod: 120, receivedInPeriod: 900 });
  });
});

describe('MailProvider', () => {
  it('loads the four reports as text and builds the overview', async () => {
    const graph = {
      get: vi.fn(async (_t: string, path: string, _s: string[], options: { responseType?: string }) => {
        expect(options.responseType).toBe('text');
        if (path.includes('getMailboxUsageDetail')) return usageCsv;
        if (path.includes('getEmailActivityUserDetail')) return activityCsv;
        if (path.includes('getEmailActivityCounts')) return countsCsv;
        if (path.includes('getMailboxUsageStorage')) return storageCsv;
        throw new Error(`unexpected ${path}`);
      }),
    };
    const provider = new MailProvider(graph as unknown as GraphClient, () => NOW);

    const result = await provider.getMailOverview(ctx, 'D30');

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.data.refreshedAt).toBe('2026-09-23');
    expect(result.data.anonymised).toBe(false);
    expect(result.data.activityByDay.map((d) => d.date)).toEqual(['2026-09-21', '2026-09-22']);
    expect(result.data.storageByDay[0].storageUsedBytes).toBe(52000002000);
    expect(graph.get.mock.calls[0][1]).toBe("/reports/getMailboxUsageDetail(period='D30')");
  });

  it('recognises anonymised reports', () => {
    const rows = parseCsv('Report Refresh Date,User Principal Name,Display Name,Is Deleted,Recipient Type\n2026-09-23,7F2A9C,7F2A9C,False,UserMailbox');
    const mailboxes = buildMailboxes(rows, []);
    expect(mailboxes[0].userPrincipalName).toBe('7F2A9C');
  });

  it('maps 403 and 404 to capability states', async () => {
    const forbidden = { get: vi.fn().mockRejectedValue(new GraphApiError(403, 'Forbidden', 'no')) };
    expect(await new MailProvider(forbidden as unknown as GraphClient).getMailOverview(ctx)).toMatchObject({ available: false, reason: 'permission-missing', missingPermission: 'Reports.Read.All' });
    const missing = { get: vi.fn().mockRejectedValue(new GraphApiError(404, 'NotFound', 'no exchange')) };
    expect(await new MailProvider(missing as unknown as GraphClient).getMailOverview(ctx)).toMatchObject({ available: false, reason: 'not-licensed' });
  });
});
