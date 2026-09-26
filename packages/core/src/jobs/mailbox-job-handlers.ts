/**
 * Job-Handler fuer Postfaecher: Abwesenheit, Weiterleitungsregeln, Regeln
 * aktivieren/deaktivieren/loeschen
 *
 * Jede Aenderung ist ein Job mit Preview (Ist-Zustand live), Freigabe durch
 * Engineer und Audit. Weiterleitungen an fremde Domaenen sind der klassische
 * Abflussweg nach einer Kontouebernahme; die Preview sagt das deutlich.
 */

import type { AutoReplyAudience, AutoReplyStatus, InboxRule, MailboxSettingsInfo, CapabilityResult } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import type { ProviderContext } from '../providers/resource-provider.js';
import type { AutoReplyInput, ForwardRuleInput } from '../providers/mailbox-provider.js';
import { domainOf } from '../providers/mailbox-provider.js';

export interface MailboxOperations {
  resolveUserId(ctx: ProviderContext, upn: string): Promise<string | null>;
  getTenantDomains(ctx: ProviderContext, upn: string): Promise<string[]>;
  getSettings(ctx: ProviderContext, userId: string): Promise<CapabilityResult<MailboxSettingsInfo>>;
  getRule(ctx: ProviderContext, userId: string, ruleId: string, tenantDomains: string[]): Promise<InboxRule | null>;
  listRules(ctx: ProviderContext, userId: string, tenantDomains: string[]): Promise<CapabilityResult<InboxRule[]>>;
  setAutoReply(ctx: ProviderContext, userId: string, input: AutoReplyInput): Promise<void>;
  createForwardRule(ctx: ProviderContext, userId: string, input: ForwardRuleInput): Promise<string>;
  setRuleEnabled(ctx: ProviderContext, userId: string, ruleId: string, enabled: boolean): Promise<void>;
  deleteRule(ctx: ProviderContext, userId: string, ruleId: string): Promise<void>;
}

interface BasePayload {
  userPrincipalName: string;
  displayName: string;
}

export interface AutoReplyPayload extends BasePayload {
  status: AutoReplyStatus;
  externalAudience: AutoReplyAudience;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  internalMessage: string;
  externalMessage: string;
  timeZone: string;
}

export interface ForwardRulePayload extends BasePayload {
  ruleName: string;
  addresses: string[];
  keepCopy: boolean;
}

export interface RulePayload extends BasePayload {
  ruleId: string;
  ruleName: string;
}

const statusLabel: Record<AutoReplyStatus, string> = { disabled: 'aus', alwaysEnabled: 'an', scheduled: 'geplant' };
const audienceLabel: Record<AutoReplyAudience, string> = { none: 'niemand extern', contactsOnly: 'nur Kontakte', all: 'alle externen Absender' };

function failure(code: string, error: unknown): JobResult {
  return { success: false, error: { code, message: error instanceof Error ? error.message : String(error), retryable: false } };
}

async function requireUser(ops: MailboxOperations, ctx: ProviderContext, upn: string): Promise<string> {
  const userId = await ops.resolveUserId(ctx, upn);
  if (!userId) throw new Error(`Kein Benutzer zu ${upn} gefunden`);
  return userId;
}

function describeAutoReply(a: { status: AutoReplyStatus; externalAudience: AutoReplyAudience; scheduledStart: string | null; scheduledEnd: string | null; internalMessage: string; externalMessage: string }): Record<string, unknown> {
  return {
    status: statusLabel[a.status],
    ...(a.status === 'scheduled' ? { von: a.scheduledStart, bis: a.scheduledEnd } : {}),
    ...(a.status !== 'disabled'
      ? {
          externeAntwort: audienceLabel[a.externalAudience],
          interneNachricht: a.internalMessage ? `${a.internalMessage.replace(/<[^>]+>/g, '').slice(0, 120)}${a.internalMessage.length > 120 ? '...' : ''}` : '(leer)',
        }
      : {}),
  };
}

function describeRule(r: InboxRule): Record<string, unknown> {
  return {
    name: r.displayName,
    aktiv: r.isEnabled ? 'ja' : 'nein',
    aktionen: r.actions.map((a) => (a.recipients.length > 0 ? `${a.kind} -> ${a.recipients.join(', ')}` : a.kind)).join('; '),
    bedingungen: r.conditions.join('; '),
  };
}

export function registerMailboxJobs(ops: MailboxOperations): void {
  registerJob(
    { type: 'mailbox.set-auto-reply', displayName: 'Abwesenheitsnotiz setzen', maxRetries: 0, timeoutSeconds: 60, concurrencyPerTenant: 3, requiresPreview: true },
    async (ctx: JobContext): Promise<JobResult> => {
      const p = ctx.payload as unknown as AutoReplyPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const userId = await requireUser(ops, providerCtx, p.userPrincipalName);
        await ops.setAutoReply(providerCtx, userId, p);
        return { success: true, data: { userPrincipalName: p.userPrincipalName, status: p.status, changed: true } };
      } catch (error) {
        return failure('MAILBOX_AUTO_REPLY_FAILED', error);
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const p = ctx.payload as unknown as AutoReplyPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: `preview-${ctx.tenantId}` };
      const userId = await requireUser(ops, providerCtx, p.userPrincipalName);
      const settings = await ops.getSettings(providerCtx, userId);
      if (!settings.available) throw new Error(`Postfacheinstellungen nicht lesbar: ${settings.detail ?? settings.reason}`);
      const warnings: string[] = [];
      if (p.status === 'scheduled' && (!p.scheduledStart || !p.scheduledEnd)) warnings.push('Geplante Abwesenheit braucht Start und Ende; der Job wird abgelehnt.');
      if (p.status === 'scheduled' && p.scheduledStart && p.scheduledEnd && p.scheduledEnd <= p.scheduledStart) warnings.push('Ende liegt vor dem Start.');
      if (p.status !== 'disabled' && p.externalAudience === 'all') warnings.push('Die externe Nachricht geht an jeden Absender, auch an Spam-Versender. Keine internen Details hineinschreiben.');
      if (p.status !== 'disabled' && !p.internalMessage.trim()) warnings.push('Interne Nachricht ist leer.');
      return {
        changes: [
          {
            objectType: 'mailbox',
            objectId: p.userPrincipalName,
            objectDisplayName: p.displayName,
            action: 'update',
            before: describeAutoReply(settings.data.autoReply),
            after: describeAutoReply(p),
          },
        ],
        warnings,
        estimatedDurationSeconds: 5,
      };
    }
  );

  registerJob(
    { type: 'mailbox.create-forward-rule', displayName: 'Weiterleitungsregel anlegen', maxRetries: 0, timeoutSeconds: 60, concurrencyPerTenant: 3, requiresPreview: true },
    async (ctx: JobContext): Promise<JobResult> => {
      const p = ctx.payload as unknown as ForwardRulePayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const userId = await requireUser(ops, providerCtx, p.userPrincipalName);
        const addresses = p.addresses.map((a) => a.trim().toLowerCase()).filter(Boolean);
        if (addresses.length === 0) return failure('MAILBOX_RULE_INVALID', new Error('Keine Zieladresse'));
        const ruleId = await ops.createForwardRule(providerCtx, userId, { displayName: p.ruleName, addresses, keepCopy: p.keepCopy });
        return { success: true, data: { userPrincipalName: p.userPrincipalName, ruleId, addresses, keepCopy: p.keepCopy, changed: true } };
      } catch (error) {
        return failure('MAILBOX_RULE_FAILED', error);
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const p = ctx.payload as unknown as ForwardRulePayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: `preview-${ctx.tenantId}` };
      const userId = await requireUser(ops, providerCtx, p.userPrincipalName);
      const domains = await ops.getTenantDomains(providerCtx, p.userPrincipalName);
      const rules = await ops.listRules(providerCtx, userId, domains);
      if (!rules.available) throw new Error(`Posteingangsregeln nicht lesbar: ${rules.detail ?? rules.reason}`);
      const addresses = p.addresses.map((a) => a.trim().toLowerCase()).filter(Boolean);
      const external = addresses.filter((a) => !domains.includes(domainOf(a)));
      const warnings: string[] = [];
      if (external.length > 0) warnings.push(`Weiterleitung an fremde Domaene (${external.join(', ')}): Mails verlassen den Tenant. Nur mit dokumentierter Freigabe des Kunden.`);
      if (!p.keepCopy) warnings.push('Umleitung: die Nachrichten bleiben nicht im Postfach.');
      if (rules.data.some((r) => r.displayName.toLowerCase() === p.ruleName.toLowerCase())) warnings.push('Eine Regel mit diesem Namen existiert bereits; es entsteht eine zweite.');
      if (rules.data.some((r) => r.forwardsTo.length > 0)) warnings.push('Das Postfach hat bereits Regeln mit Weiterleitung.');
      if (external.length > 0) warnings.push('Hinweis: Exchange blockiert externe Weiterleitung, wenn die Outbound-Spam-Richtlinie "automatische Weiterleitung" verbietet (Standard: aus). Die Regel greift dann nicht.');
      return {
        changes: [
          {
            objectType: 'mailbox',
            objectId: p.userPrincipalName,
            objectDisplayName: p.displayName,
            action: 'create',
            before: { regeln: rules.data.length },
            after: { regel: p.ruleName, ziel: addresses.join(', '), art: p.keepCopy ? 'weiterleiten (Kopie bleibt)' : 'umleiten', extern: external.length > 0 ? 'ja' : 'nein' },
          },
        ],
        warnings,
        estimatedDurationSeconds: 5,
      };
    }
  );

  const defineRuleJob = (type: string, displayName: string, verb: 'enable' | 'disable' | 'delete') => {
    registerJob(
      { type, displayName, maxRetries: 0, timeoutSeconds: 60, concurrencyPerTenant: 3, requiresPreview: true },
      async (ctx: JobContext): Promise<JobResult> => {
        const p = ctx.payload as unknown as RulePayload;
        const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
        try {
          const userId = await requireUser(ops, providerCtx, p.userPrincipalName);
          const rule = await ops.getRule(providerCtx, userId, p.ruleId, []);
          if (!rule) return { success: true, data: { userPrincipalName: p.userPrincipalName, ruleId: p.ruleId, changed: false, note: 'Regel existiert nicht mehr' } };
          if (rule.isReadOnly) return failure('MAILBOX_RULE_READONLY', new Error('Regel ist schreibgeschuetzt (vom Client oder Exchange verwaltet)'));
          if (verb === 'delete') await ops.deleteRule(providerCtx, userId, p.ruleId);
          else {
            if (rule.isEnabled === (verb === 'enable')) return { success: true, data: { userPrincipalName: p.userPrincipalName, ruleId: p.ruleId, changed: false, note: 'Zustand war bereits so' } };
            await ops.setRuleEnabled(providerCtx, userId, p.ruleId, verb === 'enable');
          }
          return { success: true, data: { userPrincipalName: p.userPrincipalName, ruleId: p.ruleId, ruleName: rule.displayName, verb, changed: true } };
        } catch (error) {
          return failure('MAILBOX_RULE_FAILED', error);
        }
      },
      async (ctx: PreviewContext): Promise<PreviewResult> => {
        const p = ctx.payload as unknown as RulePayload;
        const providerCtx = { tenantId: ctx.tenantId, correlationId: `preview-${ctx.tenantId}` };
        const userId = await requireUser(ops, providerCtx, p.userPrincipalName);
        const domains = await ops.getTenantDomains(providerCtx, p.userPrincipalName);
        const rule = await ops.getRule(providerCtx, userId, p.ruleId, domains);
        if (!rule) throw new Error('Regel nicht gefunden; sie wurde inzwischen entfernt');
        const warnings: string[] = [];
        if (rule.isReadOnly) warnings.push('Regel ist schreibgeschuetzt; der Job wird abgelehnt.');
        if (verb === 'enable' && rule.forwardsExternally) warnings.push(`Aktiviert eine Weiterleitung an fremde Domaene (${rule.forwardsTo.join(', ')}).`);
        if (verb === 'delete' && rule.forwardsTo.length > 0) warnings.push('Loeschen ist endgueltig; bei Verdacht auf Kontouebernahme vorher die Regel als Beleg sichern (Screenshot oder Export).');
        if (verb !== 'delete' && rule.isEnabled === (verb === 'enable')) warnings.push('Die Regel ist bereits in diesem Zustand; es aendert sich nichts.');
        const after = verb === 'delete' ? { regel: '(geloescht)' } : { ...describeRule(rule), aktiv: verb === 'enable' ? 'ja' : 'nein' };
        return {
          changes: [
            {
              objectType: 'mailbox',
              objectId: p.userPrincipalName,
              objectDisplayName: `${p.displayName}: ${rule.displayName}`,
              action: verb === 'delete' ? 'delete' : 'update',
              before: describeRule(rule),
              after,
            },
          ],
          warnings,
          estimatedDurationSeconds: 5,
        };
      }
    );
  };
  defineRuleJob('mailbox.enable-rule', 'Posteingangsregel aktivieren', 'enable');
  defineRuleJob('mailbox.disable-rule', 'Posteingangsregel deaktivieren', 'disable');
  defineRuleJob('mailbox.delete-rule', 'Posteingangsregel loeschen', 'delete');
}
