/**
 * Mailbox-Provider (Exchange Online ueber Graph, je Postfach)
 *
 * Einstellungen (Abwesenheit, Zeitzone, Sprache) und Posteingangsregeln
 * kommen live aus Graph. Aenderungen laufen ausschliesslich ueber Jobs.
 * Kontingente, Postfach-Weiterleitung auf Postfachebene, Berechtigungen
 * und Archive sind in Graph nicht verfuegbar; dafuer ist der Exchange-
 * Worker vorgesehen (docs/implementation/exchange-module-plan.md).
 */

import type {
  AutoReplyAudience,
  AutoReplyStatus,
  CapabilityResult,
  ForwardingFinding,
  ForwardingScan,
  InboxRule,
  InboxRuleAction,
  MailboxAutoReply,
  MailboxDetail,
  MailboxSettingsInfo,
  MailboxUsage,
} from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';
import { GraphApiError } from '../errors.js';

interface GraphUserRow {
  id: string;
  displayName: string | null;
  userPrincipalName: string;
  mail: string | null;
  proxyAddresses: string[] | null;
  accountEnabled: boolean | null;
}

interface GraphDateTimeZone {
  dateTime: string;
  timeZone: string;
}

interface GraphMailboxSettings {
  automaticRepliesSetting?: {
    status?: string;
    externalAudience?: string;
    scheduledStartDateTime?: GraphDateTimeZone;
    scheduledEndDateTime?: GraphDateTimeZone;
    internalReplyMessage?: string;
    externalReplyMessage?: string;
  };
  timeZone?: string;
  language?: { locale?: string; displayName?: string };
  userPurpose?: string;
}

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessageRule {
  id: string;
  displayName?: string;
  sequence?: number;
  isEnabled?: boolean;
  hasError?: boolean;
  isReadOnly?: boolean;
  conditions?: Record<string, unknown> | null;
  actions?: {
    forwardTo?: GraphRecipient[];
    forwardAsAttachmentTo?: GraphRecipient[];
    redirectTo?: GraphRecipient[];
    delete?: boolean;
    permanentDelete?: boolean;
    markAsRead?: boolean;
    moveToFolder?: string;
    copyToFolder?: string;
    stopProcessingRules?: boolean;
    assignCategories?: string[];
    markImportance?: string;
  } | null;
}

interface BatchResponse {
  responses: { id: string; status: number; body?: unknown }[];
}

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

const BATCH_SIZE = 20;
// Obergrenze je Scan, damit ein Riesen-Tenant die API nicht minutenlang bindet
export const SCAN_LIMIT = 1000;

function asUnavailable(error: unknown, permission: string): Unavailable | null {
  if (!(error instanceof GraphApiError)) return null;
  if (error.isAuthError) {
    return { available: false, reason: 'permission-missing', missingPermission: permission, detail: error.message };
  }
  // Ohne Postfach (keine Exchange-Lizenz) antwortet Graph mit 404
  if (error.statusCode === 404) {
    return { available: false, reason: 'not-licensed', missingPermission: null, detail: error.message };
  }
  return null;
}

function addressOf(r: GraphRecipient): string | null {
  const a = r.emailAddress?.address?.trim().toLowerCase();
  return a ? a : null;
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase() : '';
}

/**
 * Bedingungen einer Regel als kurze, lesbare Liste (ohne Inhalte von Mails).
 */
export function describeConditions(conditions: Record<string, unknown> | null | undefined): string[] {
  if (!conditions) return ['alle Nachrichten'];
  const out: string[] = [];
  const list = (key: string, label: string) => {
    const v = conditions[key];
    if (Array.isArray(v) && v.length > 0) {
      const values = v.map((x) => (typeof x === 'string' ? x : addressOf(x as GraphRecipient) ?? '?'));
      out.push(`${label}: ${values.slice(0, 3).join(', ')}${values.length > 3 ? ` (+${values.length - 3})` : ''}`);
    }
  };
  list('fromAddresses', 'von');
  list('sentToAddresses', 'an');
  list('subjectContains', 'Betreff enthaelt');
  list('bodyContains', 'Text enthaelt');
  list('senderContains', 'Absender enthaelt');
  list('recipientContains', 'Empfaenger enthaelt');
  list('headerContains', 'Header enthaelt');
  list('categories', 'Kategorie');
  const flags: Array<[string, string]> = [
    ['hasAttachments', 'mit Anlage'],
    ['isApprovalRequest', 'Genehmigungsanfrage'],
    ['isAutomaticForward', 'automatische Weiterleitung'],
    ['isAutomaticReply', 'automatische Antwort'],
    ['isEncrypted', 'verschluesselt'],
    ['isMeetingRequest', 'Besprechungsanfrage'],
    ['isMeetingResponse', 'Besprechungsantwort'],
    ['isReadReceipt', 'Lesebestaetigung'],
    ['isSigned', 'signiert'],
    ['isVoicemail', 'Voicemail'],
    ['notSentToMe', 'nicht an mich'],
    ['sentCcMe', 'ich in CC'],
    ['sentOnlyToMe', 'nur an mich'],
    ['sentToMe', 'an mich'],
    ['sentToOrCcMe', 'an mich oder CC'],
  ];
  for (const [key, label] of flags) if (conditions[key] === true) out.push(label);
  if (typeof conditions['importance'] === 'string') out.push(`Wichtigkeit ${conditions['importance']}`);
  if (typeof conditions['sensitivity'] === 'string') out.push(`Vertraulichkeit ${conditions['sensitivity']}`);
  if (typeof conditions['messageActionFlag'] === 'string') out.push(`Kennzeichnung ${conditions['messageActionFlag']}`);
  return out.length > 0 ? out : ['alle Nachrichten'];
}

/**
 * Graph-Regel in die neutrale Form; extern = Ziel ausserhalb der Tenant-Domaenen.
 */
export function toInboxRule(rule: GraphMessageRule, tenantDomains: string[]): InboxRule {
  const actions: InboxRuleAction[] = [];
  const a = rule.actions ?? {};
  const rec = (list: GraphRecipient[] | undefined) => (list ?? []).map(addressOf).filter((x): x is string => x !== null);
  if (a.forwardTo && a.forwardTo.length > 0) actions.push({ kind: 'forward', recipients: rec(a.forwardTo) });
  if (a.forwardAsAttachmentTo && a.forwardAsAttachmentTo.length > 0) actions.push({ kind: 'forwardAsAttachment', recipients: rec(a.forwardAsAttachmentTo) });
  if (a.redirectTo && a.redirectTo.length > 0) actions.push({ kind: 'redirect', recipients: rec(a.redirectTo) });
  if (a.permanentDelete) actions.push({ kind: 'permanentDelete', recipients: [] });
  else if (a.delete) actions.push({ kind: 'delete', recipients: [] });
  if (a.moveToFolder || a.copyToFolder) actions.push({ kind: 'move', recipients: [] });
  if (a.markAsRead) actions.push({ kind: 'markAsRead', recipients: [] });
  if (actions.length === 0) actions.push({ kind: 'other', recipients: [] });
  const forwardsTo = Array.from(new Set(actions.flatMap((x) => x.recipients)));
  const domains = tenantDomains.map((d) => d.toLowerCase());
  return {
    id: rule.id,
    displayName: rule.displayName?.trim() || '(ohne Namen)',
    sequence: rule.sequence ?? 0,
    isEnabled: rule.isEnabled !== false,
    hasError: rule.hasError === true,
    isReadOnly: rule.isReadOnly === true,
    actions,
    conditions: describeConditions(rule.conditions),
    forwardsTo,
    forwardsExternally: forwardsTo.some((addr) => !domains.includes(domainOf(addr))),
  };
}

function toAutoReply(s: GraphMailboxSettings['automaticRepliesSetting']): MailboxAutoReply {
  const status = (['disabled', 'alwaysEnabled', 'scheduled'] as AutoReplyStatus[]).find((x) => x === s?.status) ?? 'disabled';
  const audience = (['none', 'contactsOnly', 'all'] as AutoReplyAudience[]).find((x) => x === s?.externalAudience) ?? 'none';
  const iso = (d: GraphDateTimeZone | undefined) => (d?.dateTime ? d.dateTime : null);
  return {
    status,
    externalAudience: audience,
    scheduledStart: status === 'scheduled' ? iso(s?.scheduledStartDateTime) : null,
    scheduledEnd: status === 'scheduled' ? iso(s?.scheduledEndDateTime) : null,
    internalMessage: s?.internalReplyMessage ?? '',
    externalMessage: s?.externalReplyMessage ?? '',
  };
}

export interface AutoReplyInput {
  status: AutoReplyStatus;
  externalAudience: AutoReplyAudience;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  internalMessage: string;
  externalMessage: string;
  timeZone: string;
}

export interface ForwardRuleInput {
  displayName: string;
  addresses: string[];
  // true: Kopie bleibt im Postfach (forwardTo); false: Umleitung (redirectTo)
  keepCopy: boolean;
}

export class MailboxProvider extends BaseResourceProvider {
  readonly name = 'mailbox';
  readonly requiredScopes = ['MailboxSettings.Read'];
  readonly writeScopes = ['MailboxSettings.ReadWrite'];
  readonly directoryScopes = ['User.Read.All'];

  constructor(
    private readonly graphClient: GraphClient,
    private readonly now: () => Date = () => new Date()
  ) {
    super();
  }

  /**
   * Verifizierte Domaenen des Tenants; ohne Berechtigung die Domaenen der Postfaecher selbst.
   */
  async getTenantDomains(ctx: ProviderContext, fallbackUpns: string[]): Promise<string[]> {
    this.validateContext(ctx);
    try {
      const org = await this.graphClient.get<GraphResponse<Array<{ verifiedDomains?: Array<{ name?: string }> }>>>(ctx.tenantId as string, '/organization?$select=verifiedDomains', ['Organization.Read.All', 'Directory.Read.All']);
      const names = (org.value ?? []).flatMap((o) => (o.verifiedDomains ?? []).map((d) => d.name?.toLowerCase() ?? '')).filter(Boolean);
      if (names.length > 0) return Array.from(new Set(names));
    } catch (error) {
      if (!(error instanceof GraphApiError)) throw error;
    }
    return Array.from(new Set(fallbackUpns.map(domainOf).filter(Boolean)));
  }

  async findUser(ctx: ProviderContext, upn: string): Promise<GraphUserRow | null> {
    this.validateContext(ctx);
    try {
      return await this.graphClient.get<GraphUserRow>(ctx.tenantId as string, `/users/${encodeURIComponent(upn)}?$select=id,displayName,userPrincipalName,mail,proxyAddresses,accountEnabled`, this.directoryScopes);
    } catch (error) {
      if (error instanceof GraphApiError && error.statusCode === 404) return null;
      throw error;
    }
  }

  async getSettings(ctx: ProviderContext, userId: string): Promise<CapabilityResult<MailboxSettingsInfo>> {
    this.validateContext(ctx);
    try {
      const s = await this.graphClient.get<GraphMailboxSettings>(ctx.tenantId as string, `/users/${encodeURIComponent(userId)}/mailboxSettings`, this.requiredScopes);
      return {
        available: true,
        data: {
          autoReply: toAutoReply(s.automaticRepliesSetting),
          timeZone: s.timeZone ?? null,
          language: s.language?.displayName ?? s.language?.locale ?? null,
          userPurpose: s.userPurpose ?? null,
        },
      };
    } catch (error) {
      const unavailable = asUnavailable(error, 'MailboxSettings.Read');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  async listRules(ctx: ProviderContext, userId: string, tenantDomains: string[]): Promise<CapabilityResult<InboxRule[]>> {
    this.validateContext(ctx);
    try {
      const res = await this.graphClient.get<GraphResponse<GraphMessageRule[]>>(ctx.tenantId as string, `/users/${encodeURIComponent(userId)}/mailFolders/inbox/messageRules`, this.requiredScopes);
      return { available: true, data: (res.value ?? []).map((r) => toInboxRule(r, tenantDomains)).sort((a, b) => a.sequence - b.sequence) };
    } catch (error) {
      const unavailable = asUnavailable(error, 'MailboxSettings.Read');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  async getRule(ctx: ProviderContext, userId: string, ruleId: string, tenantDomains: string[]): Promise<InboxRule | null> {
    this.validateContext(ctx);
    try {
      const r = await this.graphClient.get<GraphMessageRule>(ctx.tenantId as string, `/users/${encodeURIComponent(userId)}/mailFolders/inbox/messageRules/${encodeURIComponent(ruleId)}`, this.requiredScopes);
      return toInboxRule(r, tenantDomains);
    } catch (error) {
      if (error instanceof GraphApiError && error.statusCode === 404) return null;
      throw error;
    }
  }

  /**
   * Postfachdetail: Verzeichnisdaten, Einstellungen und Regeln; Nutzung aus dem Snapshot.
   */
  async getMailboxDetail(ctx: ProviderContext, upn: string, usage: MailboxUsage | null, tenantDomains: string[]): Promise<MailboxDetail | null> {
    const user = await this.findUser(ctx, upn);
    if (!user && !usage) return null;
    const userId = user?.id ?? null;
    const [settings, rules] = userId
      ? await Promise.all([this.getSettings(ctx, userId), this.listRules(ctx, userId, tenantDomains)])
      : [
          { available: false as const, reason: 'not-licensed' as const, missingPermission: null, detail: 'Kein Benutzerobjekt zum Postfach gefunden' },
          { available: false as const, reason: 'not-licensed' as const, missingPermission: null, detail: 'Kein Benutzerobjekt zum Postfach gefunden' },
        ];
    const aliases = (user?.proxyAddresses ?? [])
      .filter((p) => /^smtp:/i.test(p))
      .map((p) => p.slice(5).toLowerCase())
      .filter((a) => a !== (user?.mail ?? '').toLowerCase());
    return {
      userPrincipalName: user?.userPrincipalName ?? upn,
      displayName: user?.displayName ?? usage?.displayName ?? upn,
      userId,
      mail: user?.mail ?? null,
      aliases: Array.from(new Set(aliases)),
      accountEnabled: user?.accountEnabled ?? null,
      usage,
      settings,
      rules,
    };
  }

  async setAutoReply(ctx: ProviderContext, userId: string, input: AutoReplyInput): Promise<void> {
    this.validateContext(ctx);
    const body: GraphMailboxSettings = {
      automaticRepliesSetting: {
        status: input.status,
        externalAudience: input.externalAudience,
        internalReplyMessage: input.internalMessage,
        externalReplyMessage: input.externalMessage,
        ...(input.status === 'scheduled' && input.scheduledStart && input.scheduledEnd
          ? {
              scheduledStartDateTime: { dateTime: input.scheduledStart, timeZone: input.timeZone },
              scheduledEndDateTime: { dateTime: input.scheduledEnd, timeZone: input.timeZone },
            }
          : {}),
      },
    };
    await this.graphClient.patch<unknown>(ctx.tenantId as string, `/users/${encodeURIComponent(userId)}/mailboxSettings`, this.writeScopes, body);
  }

  async createForwardRule(ctx: ProviderContext, userId: string, input: ForwardRuleInput): Promise<string> {
    this.validateContext(ctx);
    const recipients = input.addresses.map((address) => ({ emailAddress: { address } }));
    const body = {
      displayName: input.displayName,
      sequence: 1,
      isEnabled: true,
      conditions: {},
      actions: input.keepCopy ? { forwardTo: recipients, stopProcessingRules: false } : { redirectTo: recipients, stopProcessingRules: false },
    };
    const created = await this.graphClient.post<GraphMessageRule>(ctx.tenantId as string, `/users/${encodeURIComponent(userId)}/mailFolders/inbox/messageRules`, this.writeScopes, body);
    return created.id;
  }

  async setRuleEnabled(ctx: ProviderContext, userId: string, ruleId: string, enabled: boolean): Promise<void> {
    this.validateContext(ctx);
    await this.graphClient.patch<unknown>(ctx.tenantId as string, `/users/${encodeURIComponent(userId)}/mailFolders/inbox/messageRules/${encodeURIComponent(ruleId)}`, this.writeScopes, { isEnabled: enabled });
  }

  async deleteRule(ctx: ProviderContext, userId: string, ruleId: string): Promise<void> {
    this.validateContext(ctx);
    await this.graphClient.delete(ctx.tenantId as string, `/users/${encodeURIComponent(userId)}/mailFolders/inbox/messageRules/${encodeURIComponent(ruleId)}`, this.writeScopes);
  }

  /**
   * Regeln aller uebergebenen Postfaecher per $batch lesen und die mit
   * Weiterleitung oder Umleitung melden. Fehler je Postfach werden gezaehlt,
   * nicht durchgereicht.
   */
  async scanForwarding(ctx: ProviderContext, mailboxes: Array<{ userPrincipalName: string; displayName: string }>): Promise<CapabilityResult<ForwardingScan>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const targets = mailboxes.slice(0, SCAN_LIMIT);
    const tenantDomains = await this.getTenantDomains(ctx, targets.map((m) => m.userPrincipalName));
    const findings: ForwardingFinding[] = [];
    let failed = 0;
    let authFailures = 0;

    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const slice = targets.slice(i, i + BATCH_SIZE);
      const requests = slice.map((m, idx) => ({
        id: String(idx),
        method: 'GET',
        url: `/users/${encodeURIComponent(m.userPrincipalName)}/mailFolders/inbox/messageRules?$select=id,displayName,sequence,isEnabled,hasError,isReadOnly,actions,conditions`,
      }));
      let batch: BatchResponse;
      try {
        batch = await this.graphClient.post<BatchResponse>(tenantId, '/$batch', this.requiredScopes, { requests });
      } catch (error) {
        const unavailable = asUnavailable(error, 'MailboxSettings.Read');
        if (unavailable && unavailable.reason === 'permission-missing') return unavailable;
        failed += slice.length;
        continue;
      }
      for (const response of batch.responses) {
        const mailbox = slice[Number(response.id)];
        if (!mailbox) continue;
        if (response.status === 401 || response.status === 403) {
          authFailures += 1;
          failed += 1;
          continue;
        }
        if (response.status >= 300) {
          failed += 1;
          continue;
        }
        const body = response.body as GraphResponse<GraphMessageRule[]> | undefined;
        for (const raw of body?.value ?? []) {
          const rule = toInboxRule(raw, tenantDomains);
          if (rule.forwardsTo.length > 0) findings.push({ userPrincipalName: mailbox.userPrincipalName, displayName: mailbox.displayName, rule });
        }
      }
    }

    if (targets.length > 0 && authFailures === targets.length) {
      return { available: false, reason: 'permission-missing', missingPermission: 'MailboxSettings.Read', detail: 'Graph lehnte das Lesen der Posteingangsregeln fuer alle Postfaecher ab' };
    }
    findings.sort((a, b) => Number(b.rule.forwardsExternally) - Number(a.rule.forwardsExternally) || a.displayName.localeCompare(b.displayName));
    return {
      available: true,
      data: {
        scannedMailboxes: targets.length - failed,
        failedMailboxes: failed,
        tenantDomains,
        findings,
        externalCount: findings.filter((f) => f.rule.forwardsExternally && f.rule.isEnabled).length,
        scannedAt: this.now().toISOString(),
      },
    };
  }
}
