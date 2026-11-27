/**
 * Tests: Worker-Daten zu Postfachrechten richtig einlesen
 * (PowerShell 5.1 liefert Ein-Element-Listen als String, null = nicht gelesen)
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/index.js', () => ({ db: {}, exchangeJobs: {}, exchangeFacts: {}, managedTenants: {} }));
vi.mock('../src/services/microsoft-clients.js', () => ({ getMailboxProvider: vi.fn() }));

const { normalizeFacts } = await import('../src/services/exchange.js');

function mailbox(over: Record<string, unknown>) {
  return { userPrincipalName: 'shared@contoso.com', displayName: 'Shared', primarySmtpAddress: 'shared@contoso.com', recipientTypeDetails: 'SharedMailbox', ...over };
}

describe('normalizeFacts', () => {
  it('reads a single delegate sent as string instead of reporting nobody', () => {
    const facts = normalizeFacts({ mailboxes: [mailbox({ fullAccess: 'Max@Contoso.com', sendAs: [] })] }, 'EXO01', new Date());
    expect(facts?.mailboxes[0].fullAccess).toEqual(['max@contoso.com']);
    expect(facts?.mailboxes[0].sendAs).toEqual([]);
  });

  it('keeps null for permissions the worker did not read', () => {
    const facts = normalizeFacts({ mailboxes: [mailbox({ fullAccess: null, sendAs: null })] }, 'EXO01', new Date());
    expect(facts?.mailboxes[0].fullAccess).toBeNull();
    expect(facts?.mailboxes[0].sendAs).toBeNull();
  });
});
