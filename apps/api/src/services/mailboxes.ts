/**
 * Postfachdetail und Weiterleitungs-Scan: verbindet Snapshot (Nutzung) mit
 * dem MailboxProvider (live) und liefert die Operationen fuer die Jobs.
 */

import { randomUUID } from 'node:crypto';
import type { MailboxOperations } from '@zerostress/core';
import type { CapabilityResult, ForwardingScan, MailboxDetail, MailboxUsage, ManagedTenant, TenantId } from '@zerostress/types';
import { getMailboxProvider } from './microsoft-clients.js';
import { getMailOverview } from './inventory.js';
import { getExchangeFacts, mailboxExchangeInfo } from './exchange.js';

function ctxFor(tenantId: TenantId, correlationId?: string) {
  return { tenantId, correlationId: correlationId ?? randomUUID() };
}

async function usageFor(tenant: ManagedTenant, upn: string): Promise<{ usage: MailboxUsage | null; all: MailboxUsage[] }> {
  const overview = await getMailOverview(tenant).catch(() => null);
  const all = overview?.available ? overview.data.mailboxes : [];
  const lower = upn.toLowerCase();
  return { usage: all.find((m) => m.userPrincipalName.toLowerCase() === lower) ?? null, all };
}

export async function getMailboxDetail(tenant: ManagedTenant, upn: string, correlationId?: string): Promise<MailboxDetail | null> {
  const provider = getMailboxProvider();
  const ctx = ctxFor(tenant.id, correlationId);
  const { usage, all } = await usageFor(tenant, upn);
  const [domains, exchange] = await Promise.all([provider.getTenantDomains(ctx, all.map((m) => m.userPrincipalName)), mailboxExchangeInfo(tenant.id, upn)]);
  return provider.getMailboxDetail(ctx, upn, usage, domains, exchange);
}

/**
 * Alle Postfaecher aus dem Nutzungsbericht auf Weiterleitungsregeln pruefen.
 */
export async function scanForwarding(tenant: ManagedTenant, correlationId?: string): Promise<CapabilityResult<ForwardingScan>> {
  const ctx = ctxFor(tenant.id, correlationId);
  const provider = getMailboxProvider();
  // Quelle 1: Nutzungsbericht, solange der Tenant dort Namen zeigt
  const overview = await getMailOverview(tenant);
  if (overview.available && !overview.data.anonymised) {
    const mailboxes = overview.data.mailboxes.filter((m) => (m.recipientType === 'UserMailbox' || m.recipientType === 'SharedMailbox') && m.userPrincipalName.includes('@'));
    if (mailboxes.length > 0) return provider.scanForwarding(ctx, mailboxes, 'report');
  }
  // Quelle 2: Postfachdaten des Exchange-Workers, falls gesammelt
  const facts = await getExchangeFacts(tenant.id);
  if (facts && facts.mailboxes.length > 0) {
    const mailboxes = facts.mailboxes.filter((m) => /UserMailbox|SharedMailbox/i.test(m.recipientTypeDetails)).map((m) => ({ userPrincipalName: m.userPrincipalName, displayName: m.displayName }));
    if (mailboxes.length > 0) return provider.scanForwarding(ctx, mailboxes, 'exchange-facts');
  }
  // Quelle 3: Verzeichnis (Mitglieder mit Exchange-Plan); ohne Bericht und ohne Worker
  if (!overview.available && !facts) return overview;
  return provider.scanForwarding(ctx, await provider.listMailboxUsers(ctx), 'directory');
}

export const mailboxOperations: MailboxOperations = {
  async resolveUserId(ctx, upn) {
    const user = await getMailboxProvider().findUser(ctx, upn);
    return user?.id ?? null;
  },
  getTenantDomains: (ctx, upn) => getMailboxProvider().getTenantDomains(ctx, [upn]),
  getSettings: (ctx, userId) => getMailboxProvider().getSettings(ctx, userId),
  getRule: (ctx, userId, ruleId, domains) => getMailboxProvider().getRule(ctx, userId, ruleId, domains),
  listRules: (ctx, userId, domains) => getMailboxProvider().listRules(ctx, userId, domains),
  setAutoReply: (ctx, userId, input) => getMailboxProvider().setAutoReply(ctx, userId, input),
  createForwardRule: (ctx, userId, input) => getMailboxProvider().createForwardRule(ctx, userId, input),
  setRuleEnabled: (ctx, userId, ruleId, enabled) => getMailboxProvider().setRuleEnabled(ctx, userId, ruleId, enabled),
  deleteRule: (ctx, userId, ruleId) => getMailboxProvider().deleteRule(ctx, userId, ruleId),
};
