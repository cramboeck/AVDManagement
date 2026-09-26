/**
 * Tests fuer die Exchange-Worker-Jobs (Parameterpruefung, Vorschau, Warten)
 */

import { describe, it, expect, vi } from 'vitest';
import { registerExchangeJobs, validateExchangeParameters, type ExchangeOperations } from '../src/jobs/exchange-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { CorrelationId, ExchangeJobRecord, ExchangeMailboxFacts, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const base = { jobId: 'j' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
const facts: ExchangeMailboxFacts = {
  userPrincipalName: 'max@contoso.com', displayName: 'Max', primarySmtpAddress: 'max@contoso.com', recipientTypeDetails: 'UserMailbox',
  forwardingSmtpAddress: null, forwardingAddress: null, deliverToMailboxAndForward: false,
  issueWarningQuota: '49 GB', prohibitSendQuota: '49.5 GB', prohibitSendReceiveQuota: '50 GB',
  archiveStatus: 'None', litigationHoldEnabled: false, litigationHoldDuration: null, retentionPolicy: 'Default MRM Policy', hiddenFromAddressLists: false, auditEnabled: true,
  fullAccess: ['assistenz@contoso.com'], sendAs: [], sendOnBehalf: [],
};

function record(status: ExchangeJobRecord['status'], over: Partial<ExchangeJobRecord> = {}): ExchangeJobRecord {
  return { id: 'x1', tenantId: 't', operation: 'set-quota', parameters: {}, status, workerId: 'EXO01', log: null, error: null, result: { ok: true }, createdAt: 'c', finishedAt: 'f', ...over };
}

function ops(over: Partial<ExchangeOperations> = {}): ExchangeOperations {
  return {
    enqueue: vi.fn(async () => 'x1'),
    wait: vi.fn(async () => record('succeeded')),
    factsFor: vi.fn(async () => ({ facts, collectedAt: '2026-09-26T08:00:00Z', autoForwardingMode: 'Off' })),
    tenantDomains: vi.fn(async () => ['contoso.com']),
    ...over,
  };
}

describe('validateExchangeParameters', () => {
  it('normalises and rejects bad input per operation', () => {
    expect(validateExchangeParameters('set-quota', { userPrincipalName: 'Max@Contoso.com', issueWarningGb: 45, prohibitSendGb: 49, prohibitSendReceiveGb: 50 })).toEqual({ identity: 'max@contoso.com', issueWarningQuota: '45GB', prohibitSendQuota: '49GB', prohibitSendReceiveQuota: '50GB' });
    expect(() => validateExchangeParameters('set-quota', { userPrincipalName: 'max@contoso.com', issueWarningGb: 60, prohibitSendGb: 50, prohibitSendReceiveGb: 50 })).toThrow(/Reihenfolge/);
    expect(() => validateExchangeParameters('set-quota', { userPrincipalName: 'max@contoso.com', issueWarningGb: 1, prohibitSendGb: 2, prohibitSendReceiveGb: 500 })).toThrow(/zwischen/);
    expect(validateExchangeParameters('set-forwarding', { userPrincipalName: 'max@contoso.com', forwardingSmtpAddress: 'Ext@Gmail.com', deliverToMailboxAndForward: true })).toEqual({ identity: 'max@contoso.com', forwardingSmtpAddress: 'ext@gmail.com', deliverToMailboxAndForward: true });
    expect(validateExchangeParameters('set-forwarding', { userPrincipalName: 'max@contoso.com', forwardingSmtpAddress: null, deliverToMailboxAndForward: true })).toEqual({ identity: 'max@contoso.com', forwardingSmtpAddress: null, deliverToMailboxAndForward: false });
    expect(() => validateExchangeParameters('set-full-access', { userPrincipalName: 'max@contoso.com', trustee: 'max@contoso.com', grant: true })).toThrow(/identisch/);
    expect(validateExchangeParameters('set-send-as', { userPrincipalName: 'max@contoso.com', trustee: 'erika@contoso.com', grant: false })).toEqual({ identity: 'max@contoso.com', trustee: 'erika@contoso.com', grant: false });
    expect(validateExchangeParameters('convert-mailbox', { userPrincipalName: 'max@contoso.com', toShared: true })).toEqual({ identity: 'max@contoso.com', type: 'Shared' });
    expect(validateExchangeParameters('set-litigation-hold', { userPrincipalName: 'max@contoso.com', enabled: true, durationDays: 365 })).toEqual({ identity: 'max@contoso.com', enabled: true, durationDays: 365 });
    expect(() => validateExchangeParameters('set-litigation-hold', { userPrincipalName: 'max@contoso.com', enabled: true, durationDays: 0 })).toThrow(/Dauer/);
    expect(() => validateExchangeParameters('enable-archive', { userPrincipalName: 'not a upn' })).toThrow(/ungueltig/);
  });
});

describe('exchange jobs', () => {
  it('previews from worker facts and warns on external forwarding', async () => {
    const o = ops();
    registerExchangeJobs(o);
    const job = getRegisteredJob('mailbox.set-forwarding')!;
    const payload = { userPrincipalName: 'max@contoso.com', displayName: 'Max', forwardingSmtpAddress: 'ext@gmail.com', deliverToMailboxAndForward: true, reason: null };
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes[0]).toMatchObject({ before: { weiterleitung: 'keine' }, after: { weiterleitung: 'ext@gmail.com', kopieBehalten: 'ja' } });
    expect(preview.warnings.some((w) => w.includes('ausserhalb des Tenants') && w.includes('Off'))).toBe(true);
  });

  it('enqueues, waits and maps worker outcome to the job result', async () => {
    const o = ops();
    registerExchangeJobs(o);
    const job = getRegisteredJob('mailbox.set-quota')!;
    const payload = { userPrincipalName: 'max@contoso.com', displayName: 'Max', issueWarningGb: 45, prohibitSendGb: 49, prohibitSendReceiveGb: 50, reason: null };
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(o.enqueue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'set-quota', parameters: expect.objectContaining({ prohibitSendQuota: '49GB' }) }));

    registerExchangeJobs(ops({ wait: vi.fn(async () => record('failed', { error: 'The operation could not be performed' })) }));
    const failed = await getRegisteredJob('mailbox.set-quota')!.handler({ ...base, payload });
    expect(failed.error?.code).toBe('EXCHANGE_FAILED');
    registerExchangeJobs(ops({ wait: vi.fn(async () => null) }));
    const timeout = await getRegisteredJob('mailbox.set-quota')!.handler({ ...base, payload });
    expect(timeout.error?.code).toBe('EXCHANGE_TIMEOUT');
    const invalid = await getRegisteredJob('mailbox.set-quota')!.handler({ ...base, payload: { ...payload, prohibitSendReceiveGb: 1 } });
    expect(invalid.error?.code).toBe('EXCHANGE_INVALID');
  });

  it('collects facts without preview', async () => {
    const o = ops({ wait: vi.fn(async () => record('succeeded', { operation: 'collect-facts', result: { mailboxes: 42 } })) });
    registerExchangeJobs(o);
    const job = getRegisteredJob('exchange.collect-facts')!;
    expect(job.definition.requiresPreview).toBe(false);
    const result = await job.handler({ ...base, payload: {} });
    expect(result.data).toMatchObject({ mailboxes: 42 });
  });
});
