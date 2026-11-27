/**
 * Tests: ein erledigter Alert geht wieder auf, wenn derselbe Befund danach
 * erneut auftritt; der Schweregrad steigt mit (Datenbank gemockt)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let existing: Record<string, unknown> | undefined;
const updates: Array<Record<string, unknown>> = [];

vi.mock('../src/db/index.js', () => ({
  alerts: { tenantId: 'tenant_id', fingerprint: 'fingerprint', id: 'id' },
  managedTenants: {},
  db: {
    query: { alerts: { findFirst: vi.fn(async () => existing) } },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: () => ({ returning: async () => [{ ...existing, ...values }], then: (resolve: (v: unknown) => void) => resolve(undefined) }) };
      },
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }) }),
  },
}));
vi.mock('../src/services/microsoft-clients.js', () => ({ getIdentityProvider: vi.fn(), getTokenProvider: vi.fn(), rememberMicrosoftTenantId: vi.fn() }));

const { storeFindings, higherSeverity } = await import('../src/services/alerting.js');

const row = (over: Record<string, unknown>) => ({
  id: 'a1', mspId: 'm', tenantId: 't', ruleId: 'impossible-travel', severity: 'medium', status: 'open', fingerprint: 'fp', title: 'x', summary: 's',
  userId: 'u', userPrincipalName: 'max@contoso.com', evidence: {}, firstSeenAt: new Date('2026-11-25T08:00:00Z'), lastSeenAt: new Date('2026-11-25T08:00:00Z'),
  occurrences: 1, notifiedAt: null, acknowledgedBy: null, acknowledgedAt: null, createdAt: new Date('2026-11-25T08:00:00Z'), ...over,
});
const finding = (over: Record<string, unknown> = {}) => ({ ruleId: 'impossible-travel', severity: 'high', fingerprint: 'fp', title: 'x', summary: 'again', userId: 'u', userPrincipalName: 'max@contoso.com', evidence: {}, firstSeenAt: '2026-11-25T08:00:00Z', lastSeenAt: '2026-11-25T12:00:00Z', occurrences: 2, ...over });

describe('storeFindings', () => {
  beforeEach(() => {
    updates.length = 0;
  });

  it('reopens a resolved alert when the finding shows up again later and reports it for notification', async () => {
    existing = row({ status: 'resolved', acknowledgedAt: new Date('2026-11-25T10:00:00Z') });
    const created = await storeFindings('m', 't', [finding() as never]);
    expect(created).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'open', severity: 'high', acknowledgedAt: null, notifiedAt: null });
  });

  it('keeps a resolved alert closed when nothing new happened after resolving', async () => {
    existing = row({ status: 'resolved', acknowledgedAt: new Date('2026-11-25T13:00:00Z') });
    const created = await storeFindings('m', 't', [finding() as never]);
    expect(created).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('raises the severity of an open alert but never lowers it', () => {
    expect(higherSeverity('medium', 'high')).toBe('high');
    expect(higherSeverity('high', 'low')).toBe('high');
  });
});
