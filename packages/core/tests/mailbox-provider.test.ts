/**
 * Tests fuer MailboxProvider (Graph mailboxSettings, messageRules, $batch) und die Postfach-Jobs
 */

import { describe, it, expect, vi } from 'vitest';
import { MailboxProvider, toInboxRule, describeConditions, type GraphMessageRule } from '../src/providers/mailbox-provider.js';
import { registerMailboxJobs, type MailboxOperations } from '../src/jobs/mailbox-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { CorrelationId, InboxRule, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const ctx = { tenantId: 'tenant-1' as TenantId, correlationId: 'corr-1' };
const NOW = new Date('2026-09-26T08:00:00Z');

const forwardRule: GraphMessageRule = {
  id: 'r1',
  displayName: 'Alles an privat',
  sequence: 1,
  isEnabled: true,
  conditions: null,
  actions: { forwardTo: [{ emailAddress: { address: 'Someone@Gmail.com' } }], stopProcessingRules: true },
};
const moveRule: GraphMessageRule = {
  id: 'r2',
  displayName: 'Newsletter',
  sequence: 2,
  isEnabled: false,
  conditions: { subjectContains: ['Newsletter'], hasAttachments: true },
  actions: { moveToFolder: 'AAMk', markAsRead: true },
};

describe('toInboxRule / describeConditions', () => {
  it('flags external forwarding and summarises conditions', () => {
    const r = toInboxRule(forwardRule, ['contoso.com']);
    expect(r).toMatchObject({ forwardsTo: ['someone@gmail.com'], forwardsExternally: true, isEnabled: true, conditions: ['alle Nachrichten'] });
    const internal = toInboxRule({ ...forwardRule, actions: { redirectTo: [{ emailAddress: { address: 'chef@contoso.com' } }] } }, ['contoso.com']);
    expect(internal.forwardsExternally).toBe(false);
    expect(internal.actions[0].kind).toBe('redirect');
    expect(describeConditions(moveRule.conditions)).toEqual(['Betreff enthaelt: Newsletter', 'mit Anlage']);
    expect(toInboxRule(moveRule, []).actions.map((a) => a.kind)).toEqual(['move', 'markAsRead']);
  });
});

function graphMock(over: Partial<Record<'get' | 'post' | 'patch' | 'delete', unknown>> = {}) {
  return {
    get: vi.fn(async (_t: string, path: string) => {
      if (path.startsWith('/organization')) return { value: [{ verifiedDomains: [{ name: 'contoso.com' }, { name: 'contoso.onmicrosoft.com' }] }] };
      if (path.startsWith('/users/') && path.includes('mailboxSettings')) return { automaticRepliesSetting: { status: 'scheduled', externalAudience: 'contactsOnly', scheduledStartDateTime: { dateTime: '2026-10-01T00:00:00', timeZone: 'W. Europe Standard Time' }, scheduledEndDateTime: { dateTime: '2026-10-10T00:00:00', timeZone: 'W. Europe Standard Time' }, internalReplyMessage: '<p>Bin weg</p>', externalReplyMessage: 'Out' }, timeZone: 'W. Europe Standard Time', language: { locale: 'de-DE', displayName: 'Deutsch' }, userPurpose: 'user' };
      if (path.includes('/messageRules/r1')) return forwardRule;
      if (path.includes('/messageRules')) return { value: [moveRule, forwardRule] };
      if (path.startsWith('/users/')) return { id: 'u1', displayName: 'Max', userPrincipalName: 'max@contoso.com', mail: 'max@contoso.com', proxyAddresses: ['SMTP:max@contoso.com', 'smtp:m.mustermann@contoso.com', 'X500:/o=x'], accountEnabled: true };
      throw new Error(`unexpected get ${path}`);
    }),
    post: vi.fn(async () => ({ id: 'new-rule' })),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    ...over,
  };
}

describe('MailboxProvider', () => {
  it('builds the mailbox detail with settings, aliases and sorted rules', async () => {
    const graph = graphMock();
    const provider = new MailboxProvider(graph as unknown as GraphClient, () => NOW);
    const domains = await provider.getTenantDomains(ctx, []);
    expect(domains).toEqual(['contoso.com', 'contoso.onmicrosoft.com']);
    const detail = await provider.getMailboxDetail(ctx, 'max@contoso.com', null, domains);
    expect(detail).toMatchObject({ userId: 'u1', aliases: ['m.mustermann@contoso.com'], accountEnabled: true });
    expect(detail!.settings).toMatchObject({ available: true, data: { autoReply: { status: 'scheduled', scheduledStart: '2026-10-01T00:00:00', internalMessage: '<p>Bin weg</p>' }, timeZone: 'W. Europe Standard Time', language: 'Deutsch' } });
    expect(detail!.rules.available && detail!.rules.data.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('reports missing MailboxSettings.Read and missing mailbox distinctly', async () => {
    const forbidden = graphMock({ get: vi.fn(async (_t: string, path: string) => { if (path.includes('mailboxSettings')) throw new GraphApiError(403, 'ErrorAccessDenied', 'Forbidden'); return { value: [] }; }) });
    const p1 = new MailboxProvider(forbidden as unknown as GraphClient);
    expect(await p1.getSettings(ctx, 'u1')).toMatchObject({ available: false, reason: 'permission-missing', missingPermission: 'MailboxSettings.Read' });
    const noMailbox = graphMock({ get: vi.fn(async () => { throw new GraphApiError(404, 'MailboxNotEnabledForRESTAPI', 'Not found'); }) });
    const p2 = new MailboxProvider(noMailbox as unknown as GraphClient);
    expect(await p2.listRules(ctx, 'u1', [])).toMatchObject({ available: false, reason: 'not-licensed' });
  });

  it('writes auto reply, forward rule, rule state and deletion through Graph', async () => {
    const graph = graphMock();
    const provider = new MailboxProvider(graph as unknown as GraphClient);
    await provider.setAutoReply(ctx, 'u1', { status: 'alwaysEnabled', externalAudience: 'none', scheduledStart: null, scheduledEnd: null, internalMessage: 'Weg', externalMessage: '', timeZone: 'W. Europe Standard Time' });
    expect(graph.patch.mock.calls[0][1]).toBe('/users/u1/mailboxSettings');
    expect(graph.patch.mock.calls[0][3]).toEqual({ automaticRepliesSetting: { status: 'alwaysEnabled', externalAudience: 'none', internalReplyMessage: 'Weg', externalReplyMessage: '' } });
    const id = await provider.createForwardRule(ctx, 'u1', { displayName: 'Vertretung', addresses: ['chef@contoso.com'], keepCopy: true });
    expect(id).toBe('new-rule');
    expect(graph.post.mock.calls[0][3]).toMatchObject({ isEnabled: true, actions: { forwardTo: [{ emailAddress: { address: 'chef@contoso.com' } }] } });
    await provider.setRuleEnabled(ctx, 'u1', 'r1', false);
    expect(graph.patch.mock.calls[1][3]).toEqual({ isEnabled: false });
    await provider.deleteRule(ctx, 'u1', 'r1');
    expect(graph.delete.mock.calls[0][1]).toBe('/users/u1/mailFolders/inbox/messageRules/r1');
  });

  it('scans forwarding rules per $batch and counts failures per mailbox', async () => {
    const graph = graphMock({
      post: vi.fn(async (_t: string, _p: string, _s: string[], body: { requests: { id: string }[] }) => ({
        responses: body.requests.map((r, i) => (i === 1 ? { id: r.id, status: 404, body: {} } : { id: r.id, status: 200, body: { value: i === 0 ? [forwardRule] : [moveRule] } })),
      })),
    });
    const provider = new MailboxProvider(graph as unknown as GraphClient, () => NOW);
    const scan = await provider.scanForwarding(ctx, [
      { userPrincipalName: 'max@contoso.com', displayName: 'Max' },
      { userPrincipalName: 'gone@contoso.com', displayName: 'Weg' },
      { userPrincipalName: 'erika@contoso.com', displayName: 'Erika' },
    ]);
    expect(scan.available && scan.data).toMatchObject({ scannedMailboxes: 2, failedMailboxes: 1, externalCount: 1, tenantDomains: ['contoso.com', 'contoso.onmicrosoft.com'] });
    expect(scan.available && scan.data.findings[0]).toMatchObject({ userPrincipalName: 'max@contoso.com', rule: { forwardsExternally: true } });

    const denied = graphMock({ post: vi.fn(async () => { throw new GraphApiError(403, 'ErrorAccessDenied', 'Forbidden'); }) });
    const p2 = new MailboxProvider(denied as unknown as GraphClient);
    expect(await p2.scanForwarding(ctx, [{ userPrincipalName: 'a@contoso.com', displayName: 'A' }])).toMatchObject({ available: false, reason: 'permission-missing' });
  });
});

describe('mailbox jobs', () => {
  const base = { jobId: 'j' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
  const rule: InboxRule = toInboxRule(forwardRule, ['contoso.com']);

  function ops(over: Partial<MailboxOperations> = {}): MailboxOperations {
    return {
      resolveUserId: vi.fn(async () => 'u1'),
      getTenantDomains: vi.fn(async () => ['contoso.com']),
      getSettings: vi.fn(async () => ({ available: true as const, data: { autoReply: { status: 'disabled' as const, externalAudience: 'none' as const, scheduledStart: null, scheduledEnd: null, internalMessage: '', externalMessage: '' }, timeZone: null, language: null, userPurpose: 'user' } })),
      getRule: vi.fn(async () => rule),
      listRules: vi.fn(async () => ({ available: true as const, data: [rule] })),
      setAutoReply: vi.fn(async () => undefined),
      createForwardRule: vi.fn(async () => 'new'),
      setRuleEnabled: vi.fn(async () => undefined),
      deleteRule: vi.fn(async () => undefined),
      ...over,
    };
  }

  it('sets an auto reply with a before/after preview and warns about external audience', async () => {
    const o = ops();
    registerMailboxJobs(o);
    const job = getRegisteredJob('mailbox.set-auto-reply')!;
    const payload = { userPrincipalName: 'max@contoso.com', displayName: 'Max', status: 'alwaysEnabled', externalAudience: 'all', scheduledStart: null, scheduledEnd: null, internalMessage: 'Bin weg', externalMessage: 'Out', timeZone: 'W. Europe Standard Time' };
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes[0].before).toMatchObject({ status: 'aus' });
    expect(preview.changes[0].after).toMatchObject({ status: 'an', externeAntwort: 'alle externen Absender' });
    expect(preview.warnings.some((w) => w.includes('Spam'))).toBe(true);
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(o.setAutoReply).toHaveBeenCalledWith(expect.anything(), 'u1', expect.objectContaining({ status: 'alwaysEnabled' }));
  });

  it('creates a forward rule and warns about external domains', async () => {
    const o = ops();
    registerMailboxJobs(o);
    const job = getRegisteredJob('mailbox.create-forward-rule')!;
    const payload = { userPrincipalName: 'max@contoso.com', displayName: 'Max', ruleName: 'Vertretung', addresses: ['Ext@Gmail.com'], keepCopy: false };
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.warnings.some((w) => w.includes('fremde Domaene'))).toBe(true);
    expect(preview.warnings.some((w) => w.includes('Umleitung'))).toBe(true);
    const result = await job.handler({ ...base, payload });
    expect(result.data).toMatchObject({ ruleId: 'new', addresses: ['ext@gmail.com'] });
    expect(o.createForwardRule).toHaveBeenCalledWith(expect.anything(), 'u1', { displayName: 'Vertretung', addresses: ['ext@gmail.com'], keepCopy: false });
  });

  it('disables, deletes and refuses read-only rules', async () => {
    const o = ops();
    registerMailboxJobs(o);
    const payload = { userPrincipalName: 'max@contoso.com', displayName: 'Max', ruleId: 'r1', ruleName: 'Alles an privat' };
    const disable = await getRegisteredJob('mailbox.disable-rule')!.handler({ ...base, payload });
    expect(disable.success).toBe(true);
    expect(o.setRuleEnabled).toHaveBeenCalledWith(expect.anything(), 'u1', 'r1', false);
    const preview = await getRegisteredJob('mailbox.delete-rule')!.previewGenerator!({ ...base, payload });
    expect(preview.changes[0]).toMatchObject({ action: 'delete', after: { regel: '(geloescht)' } });
    const del = await getRegisteredJob('mailbox.delete-rule')!.handler({ ...base, payload });
    expect(del.success).toBe(true);
    expect(o.deleteRule).toHaveBeenCalledWith(expect.anything(), 'u1', 'r1');

    registerMailboxJobs(ops({ getRule: vi.fn(async () => ({ ...rule, isReadOnly: true })) }));
    const refused = await getRegisteredJob('mailbox.delete-rule')!.handler({ ...base, payload });
    expect(refused.error?.code).toBe('MAILBOX_RULE_READONLY');

    registerMailboxJobs(ops({ getRule: vi.fn(async () => null) }));
    const gone = await getRegisteredJob('mailbox.enable-rule')!.handler({ ...base, payload });
    expect(gone.data).toMatchObject({ changed: false });
  });
});
