/**
 * Jobs, die der Exchange-Worker ausfuehrt (Exchange Online PowerShell)
 *
 * Das Cockpit legt je Job einen Auftrag mit benannter Operation und streng
 * geprueften Parametern an; der Worker kennt nur die Positivliste und baut
 * die Cmdlet-Aufrufe selbst. Der Cockpit-Job wartet auf den Abschluss und
 * uebernimmt Ergebnis oder Fehler. Vorschau aus den zuletzt gesammelten
 * Postfachdaten (exchange_facts).
 */

import type { ExchangeJobRecord, ExchangeMailboxFacts, ExchangeOperation } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';

export interface ExchangeOperations {
  enqueue(input: { mspId: string; tenantId: string; userId: string; jobId: string; operation: ExchangeOperation; parameters: Record<string, unknown> }): Promise<string>;
  wait(exchangeJobId: string, timeoutMs: number): Promise<ExchangeJobRecord | null>;
  factsFor(tenantId: string, upn: string): Promise<{ facts: ExchangeMailboxFacts | null; collectedAt: string | null; autoForwardingMode: string | null }>;
  tenantDomains(tenantId: string): Promise<string[]>;
}

export interface ExchangeJobOptions {
  timeoutMs?: number;
}

const UPN = /^[^\s@\\/]{1,64}@[A-Za-z0-9.-]{1,255}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const QUOTA_MIN_GB = 1;
export const QUOTA_MAX_GB = 100;
export const HOLD_MAX_DAYS = 24855;

interface BasePayload {
  userPrincipalName: string;
  displayName: string;
  reason: string | null;
}

export interface QuotaPayload extends BasePayload {
  issueWarningGb: number;
  prohibitSendGb: number;
  prohibitSendReceiveGb: number;
}

export interface ForwardingPayload extends BasePayload {
  forwardingSmtpAddress: string | null;
  deliverToMailboxAndForward: boolean;
}

export interface PermissionPayload extends BasePayload {
  trustee: string;
  grant: boolean;
  autoMapping: boolean;
}

export interface ConvertPayload extends BasePayload {
  toShared: boolean;
}

export interface HoldPayload extends BasePayload {
  enabled: boolean;
  durationDays: number | null;
}

function failure(code: string, message: string): JobResult {
  return { success: false, error: { code, message, retryable: false } };
}

function requireUpn(value: string, label = 'userPrincipalName'): string {
  const v = value.trim().toLowerCase();
  if (!UPN.test(v)) throw new Error(`${label} ungueltig`);
  return v;
}

function requireEmail(value: string, label: string): string {
  const v = value.trim().toLowerCase();
  if (!EMAIL.test(v)) throw new Error(`${label} ist keine gueltige Adresse`);
  return v;
}

function gb(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < QUOTA_MIN_GB || n > QUOTA_MAX_GB) throw new Error(`${label} muss zwischen ${QUOTA_MIN_GB} und ${QUOTA_MAX_GB} GB liegen`);
  return Math.round(n * 10) / 10;
}

/**
 * Parameter je Operation pruefen und auf das Format bringen, das der Worker erwartet.
 */
export function validateExchangeParameters(operation: ExchangeOperation, payload: Record<string, unknown>): Record<string, unknown> {
  switch (operation) {
    case 'collect-facts':
      return {};
    case 'set-quota': {
      const p = payload as unknown as QuotaPayload;
      const warn = gb(p.issueWarningGb, 'Warnung');
      const send = gb(p.prohibitSendGb, 'Sendesperre');
      const receive = gb(p.prohibitSendReceiveGb, 'Empfangssperre');
      if (!(warn <= send && send <= receive)) throw new Error('Reihenfolge muss Warnung <= Sendesperre <= Empfangssperre sein');
      return { identity: requireUpn(p.userPrincipalName), issueWarningQuota: `${warn}GB`, prohibitSendQuota: `${send}GB`, prohibitSendReceiveQuota: `${receive}GB` };
    }
    case 'set-forwarding': {
      const p = payload as unknown as ForwardingPayload;
      const address = p.forwardingSmtpAddress ? requireEmail(p.forwardingSmtpAddress, 'Weiterleitungsadresse') : null;
      return { identity: requireUpn(p.userPrincipalName), forwardingSmtpAddress: address, deliverToMailboxAndForward: address ? p.deliverToMailboxAndForward === true : false };
    }
    case 'set-full-access':
    case 'set-send-as': {
      const p = payload as unknown as PermissionPayload;
      const identity = requireUpn(p.userPrincipalName);
      const trustee = requireEmail(p.trustee, 'Berechtigter');
      if (identity === trustee) throw new Error('Berechtigter und Postfach sind identisch');
      return { identity, trustee, grant: p.grant === true, ...(operation === 'set-full-access' ? { autoMapping: p.autoMapping !== false } : {}) };
    }
    case 'enable-archive': {
      const p = payload as unknown as BasePayload;
      return { identity: requireUpn(p.userPrincipalName) };
    }
    case 'convert-mailbox': {
      const p = payload as unknown as ConvertPayload;
      return { identity: requireUpn(p.userPrincipalName), type: p.toShared ? 'Shared' : 'Regular' };
    }
    case 'set-litigation-hold': {
      const p = payload as unknown as HoldPayload;
      const days = p.durationDays === null || p.durationDays === undefined ? null : Number(p.durationDays);
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > HOLD_MAX_DAYS)) throw new Error('Dauer in Tagen ungueltig');
      return { identity: requireUpn(p.userPrincipalName), enabled: p.enabled === true, durationDays: p.enabled ? days : null };
    }
  }
}

const definitions: Array<{ operation: ExchangeOperation; type: string; displayName: string; describe: (params: Record<string, unknown>, facts: ExchangeMailboxFacts | null) => { before: Record<string, unknown>; after: Record<string, unknown>; warnings: string[] } }> = [
  {
    operation: 'set-quota',
    type: 'mailbox.set-quota',
    displayName: 'Postfachkontingent setzen',
    describe: (params, facts) => ({
      before: { warnung: facts?.issueWarningQuota ?? 'unbekannt', sendesperre: facts?.prohibitSendQuota ?? 'unbekannt', empfangssperre: facts?.prohibitSendReceiveQuota ?? 'unbekannt' },
      after: { warnung: params.issueWarningQuota, sendesperre: params.prohibitSendQuota, empfangssperre: params.prohibitSendReceiveQuota },
      warnings: ['Kontingente ueber der Lizenzgrenze (z. B. 50 GB bei Business-Plaenen, 100 GB bei E3/E5) lehnt Exchange ab.', 'Liegt das neue Kontingent unter der aktuellen Belegung, kann das Postfach sofort nicht mehr senden.'],
    }),
  },
  {
    operation: 'set-forwarding',
    type: 'mailbox.set-forwarding',
    displayName: 'Weiterleitung auf Postfachebene setzen',
    describe: (params, facts) => ({
      before: { weiterleitung: facts?.forwardingSmtpAddress ?? facts?.forwardingAddress ?? 'keine', kopieBehalten: facts ? (facts.deliverToMailboxAndForward ? 'ja' : 'nein') : 'unbekannt' },
      after: { weiterleitung: (params.forwardingSmtpAddress as string | null) ?? 'keine', kopieBehalten: params.deliverToMailboxAndForward ? 'ja' : 'nein' },
      warnings: params.forwardingSmtpAddress ? ['Weiterleitung auf Postfachebene greift vor allen Regeln und fuer alle Mails. Externe Ziele stellt Exchange nur zu, wenn die Outbound-Spam-Richtlinie automatische Weiterleitung erlaubt.'] : ['Die Weiterleitung wird entfernt; Posteingangsregeln bleiben unberuehrt.'],
    }),
  },
  {
    operation: 'set-full-access',
    type: 'mailbox.set-full-access',
    displayName: 'Vollzugriff setzen',
    describe: (params, facts) => ({
      before: { vollzugriff: facts ? facts.fullAccess.join(', ') || 'niemand' : 'unbekannt' },
      after: { vollzugriff: `${params.grant ? '+' : '-'} ${String(params.trustee)}${params.grant && params.autoMapping ? ' (AutoMapping)' : ''}` },
      warnings: params.grant ? ['Vollzugriff heisst: alle Ordner lesen, aendern, loeschen. Mit AutoMapping erscheint das Postfach automatisch in Outlook.'] : [],
    }),
  },
  {
    operation: 'set-send-as',
    type: 'mailbox.set-send-as',
    displayName: 'Senden als setzen',
    describe: (params, facts) => ({
      before: { sendenAls: facts ? facts.sendAs.join(', ') || 'niemand' : 'unbekannt' },
      after: { sendenAls: `${params.grant ? '+' : '-'} ${String(params.trustee)}` },
      warnings: params.grant ? ['Senden als: Mails erscheinen als vom Postfach selbst gesendet, ohne Hinweis auf den Absender.'] : [],
    }),
  },
  {
    operation: 'enable-archive',
    type: 'mailbox.enable-archive',
    displayName: 'Archivpostfach aktivieren',
    describe: (_params, facts) => ({
      before: { archiv: facts?.archiveStatus ?? 'unbekannt' },
      after: { archiv: 'Active' },
      warnings: ['Braucht eine Lizenz mit Archiv (Exchange Online Archiving oder enthalten in E3/E5/Business Premium). Ein Archiv laesst sich spaeter nur mit Datenverlust wieder deaktivieren.'],
    }),
  },
  {
    operation: 'convert-mailbox',
    type: 'mailbox.convert',
    displayName: 'Postfachtyp aendern',
    describe: (params, facts) => ({
      before: { typ: facts?.recipientTypeDetails ?? 'unbekannt' },
      after: { typ: params.type === 'Shared' ? 'SharedMailbox' : 'UserMailbox' },
      warnings: params.type === 'Shared' ? ['Freigegebene Postfaecher brauchen bis 50 GB keine Lizenz; die Lizenz des Benutzers erst entfernen, wenn die Umwandlung durch ist. Das Konto sollte anschliessend gesperrt werden.'] : ['Ein normales Postfach braucht eine Exchange-Lizenz; ohne Lizenz wird es nach 30 Tagen deaktiviert.'],
    }),
  },
  {
    operation: 'set-litigation-hold',
    type: 'mailbox.set-litigation-hold',
    displayName: 'Beweissicherung (Litigation Hold) setzen',
    describe: (params, facts) => ({
      before: { hold: facts ? (facts.litigationHoldEnabled ? `aktiv${facts.litigationHoldDuration ? ` (${facts.litigationHoldDuration})` : ''}` : 'aus') : 'unbekannt' },
      after: { hold: params.enabled ? `aktiv${params.durationDays ? ` (${String(params.durationDays)} Tage)` : ' (unbegrenzt)'}` : 'aus' },
      warnings: params.enabled ? ['Beweissicherung braucht Exchange Online Plan 2 oder eine Archiv-Lizenz. Geloeschte und geaenderte Elemente werden aufbewahrt; das kann Datenschutzfolgen haben und gehoert dokumentiert.'] : ['Nach dem Aufheben werden aufbewahrte Elemente nach der normalen Aufbewahrung endgueltig geloescht.'],
    }),
  },
];

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export function registerExchangeJobs(ops: ExchangeOperations, options: ExchangeJobOptions = {}): void {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const def of definitions) {
    registerJob(
      { type: def.type, displayName: def.displayName, maxRetries: 0, timeoutSeconds: 1800, concurrencyPerTenant: 1, requiresPreview: true },
      async (ctx: JobContext): Promise<JobResult> => {
        const payload = ctx.payload as unknown as BasePayload & Record<string, unknown>;
        let params: Record<string, unknown>;
        try {
          params = validateExchangeParameters(def.operation, payload);
        } catch (error) {
          return failure('EXCHANGE_INVALID', error instanceof Error ? error.message : String(error));
        }
        let exchangeJobId: string;
        try {
          exchangeJobId = await ops.enqueue({ mspId: ctx.mspId, tenantId: ctx.tenantId, userId: ctx.userId, jobId: ctx.jobId, operation: def.operation, parameters: params });
        } catch (error) {
          return failure('EXCHANGE_ENQUEUE_FAILED', error instanceof Error ? error.message : String(error));
        }
        const record = await ops.wait(exchangeJobId, timeoutMs);
        if (!record) return failure('EXCHANGE_TIMEOUT', 'Kein Exchange-Worker hat den Auftrag innerhalb der Wartezeit abgeschlossen. Laeuft der Worker? Der Auftrag bleibt in der Warteschlange.');
        if (record.status !== 'succeeded') return failure('EXCHANGE_FAILED', record.error ?? 'Der Worker meldete einen Fehler');
        return { success: true, data: { exchangeJobId, operation: def.operation, identity: params.identity, result: record.result ?? null, workerId: record.workerId } };
      },
      async (ctx: PreviewContext): Promise<PreviewResult> => {
        const payload = ctx.payload as unknown as BasePayload & Record<string, unknown>;
        const params = validateExchangeParameters(def.operation, payload);
        const { facts, collectedAt, autoForwardingMode } = await ops.factsFor(ctx.tenantId, String(params.identity));
        const described = def.describe(params, facts);
        const warnings = [...described.warnings];
        if (!facts) warnings.push('Fuer dieses Postfach liegen noch keine Worker-Daten vor; der Ist-Zustand ist unbekannt. "Exchange-Daten sammeln" liefert ihn.');
        else if (collectedAt) warnings.push(`Ist-Zustand vom ${collectedAt}; seitdem kann sich etwas geaendert haben.`);
        if (def.operation === 'set-forwarding' && params.forwardingSmtpAddress) {
          const domains = await ops.tenantDomains(ctx.tenantId);
          const target = String(params.forwardingSmtpAddress);
          const domain = target.slice(target.lastIndexOf('@') + 1);
          if (!domains.includes(domain)) warnings.push(`Ziel ${target} liegt ausserhalb des Tenants${autoForwardingMode ? ` (Outbound-Spam-Richtlinie: automatische Weiterleitung ${autoForwardingMode})` : ''}.`);
        }
        warnings.push('Die Aenderung fuehrt der Exchange-Worker mit seiner eigenen Identitaet aus; Ergebnis und Protokoll landen im Job.');
        return {
          changes: [{ objectType: 'mailbox', objectId: String(params.identity), objectDisplayName: payload.displayName || String(params.identity), action: 'update', before: described.before, after: described.after }],
          warnings,
          estimatedDurationSeconds: 90,
        };
      }
    );
  }

  registerJob(
    { type: 'exchange.collect-facts', displayName: 'Exchange-Postfachdaten sammeln', maxRetries: 0, timeoutSeconds: 1800, concurrencyPerTenant: 1, requiresPreview: false },
    async (ctx: JobContext): Promise<JobResult> => {
      let exchangeJobId: string;
      try {
        exchangeJobId = await ops.enqueue({ mspId: ctx.mspId, tenantId: ctx.tenantId, userId: ctx.userId, jobId: ctx.jobId, operation: 'collect-facts', parameters: {} });
      } catch (error) {
        return failure('EXCHANGE_ENQUEUE_FAILED', error instanceof Error ? error.message : String(error));
      }
      const record = await ops.wait(exchangeJobId, timeoutMs);
      if (!record) return failure('EXCHANGE_TIMEOUT', 'Kein Exchange-Worker hat den Auftrag innerhalb der Wartezeit abgeschlossen. Laeuft der Worker?');
      if (record.status !== 'succeeded') return failure('EXCHANGE_FAILED', record.error ?? 'Der Worker meldete einen Fehler');
      return { success: true, data: { exchangeJobId, mailboxes: record.result?.mailboxes ?? null, workerId: record.workerId } };
    }
  );
}
