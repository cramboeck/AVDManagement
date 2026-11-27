/**
 * Job-Handler fuer AVD-Modul
 */
import {
  registerJob,
  type JobContext,
  type JobResult,
  type PreviewContext,
  type PreviewResult,
} from './job-types.js';
import { AvdProvider, sessionHostShortName } from '../providers/avd-provider.js';
import { mapWithLimit } from '../providers/arm-client.js';
import { ArmApiError } from '../errors.js';

/** Wiederholbar nur bei Drosselung oder Serverfehler, erkannt am Statuscode. */
function isRetryable(error: unknown): boolean {
  return error instanceof ArmApiError && error.isRetryable;
}

/** VM des Hosts aus ARM; der vmResourceId-Wert aus dem Payload wird bewusst ignoriert. */
async function resolveVm(avdProvider: AvdProvider, ctx: { tenantId: JobContext['tenantId']; correlationId: string }, payload: { hostPoolId: string; sessionHostName: string }): Promise<string> {
  const vm = await avdProvider.resolveSessionHostVm(ctx, payload.hostPoolId, payload.sessionHostName);
  if (!vm) throw new Error(`Session host ${payload.sessionHostName} not found in host pool or has no VM`);
  return vm;
}

// Payload-Typen
interface StartSessionHostPayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  vmResourceId: string;
}

interface StopSessionHostPayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  vmResourceId: string;
  force: boolean;
}

interface SetDrainModePayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  allowNewSession: boolean;
}

interface DisconnectSessionPayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  sessionId: string;
  userPrincipalName: string;
}

interface LogoffSessionPayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  sessionId: string;
  userPrincipalName: string;
  force: boolean;
}

interface SendMessagePayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  sessionId: string;
  userPrincipalName: string;
  messageTitle: string;
  messageBody: string;
}

/**
 * Session-Host starten - Job-Handler
 */
export function createStartSessionHostHandler(
  avdProvider: AvdProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload as unknown as StartSessionHostPayload;

    try {
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      await avdProvider.startVm(providerCtx, await resolveVm(avdProvider, providerCtx, payload));

      return {
        success: true,
        data: {
          sessionHostId: payload.sessionHostId,
          sessionHostName: payload.sessionHostName,
          startedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'VM_START_FAILED',
          message,
          retryable: isRetryable(error),
        },
      };
    }
  };
}

/**
 * Session-Host starten - Preview-Generator
 */
export function createStartSessionHostPreviewGenerator(
  avdProvider: AvdProvider
): (ctx: PreviewContext) => Promise<PreviewResult> {
  return async (ctx: PreviewContext): Promise<PreviewResult> => {
    const payload = ctx.payload as unknown as StartSessionHostPayload;
    const warnings: string[] = [];

    const sessionHost = await avdProvider.getSessionHost(
      { tenantId: ctx.tenantId, correlationId: crypto.randomUUID() },
      payload.hostPoolId,
      payload.sessionHostName
    );

    if (sessionHost?.status === 'Available') {
      warnings.push('Session-Host ist bereits gestartet und verfuegbar.');
    }

    return {
      changes: [
        {
          objectType: 'session-host',
          objectId: payload.sessionHostId,
          objectDisplayName: payload.sessionHostName,
          action: 'update',
          before: { status: sessionHost?.status ?? 'Unknown' },
          after: { status: 'Available' },
        },
      ],
      warnings,
      estimatedDurationSeconds: 120,
    };
  };
}

/**
 * Session-Host stoppen - Job-Handler
 */
export function createStopSessionHostHandler(
  avdProvider: AvdProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload as unknown as StopSessionHostPayload;

    try {
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      await avdProvider.stopVm(providerCtx, await resolveVm(avdProvider, providerCtx, payload));

      return {
        success: true,
        data: {
          sessionHostId: payload.sessionHostId,
          sessionHostName: payload.sessionHostName,
          stoppedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'VM_STOP_FAILED',
          message,
          retryable: isRetryable(error),
        },
      };
    }
  };
}

/**
 * Session-Host stoppen - Preview-Generator
 */
export function createStopSessionHostPreviewGenerator(
  avdProvider: AvdProvider
): (ctx: PreviewContext) => Promise<PreviewResult> {
  return async (ctx: PreviewContext): Promise<PreviewResult> => {
    const payload = ctx.payload as unknown as StopSessionHostPayload;
    const warnings: string[] = [];

    const sessionHost = await avdProvider.getSessionHost(
      { tenantId: ctx.tenantId, correlationId: crypto.randomUUID() },
      payload.hostPoolId,
      payload.sessionHostName
    );

    if (sessionHost?.sessions && sessionHost.sessions > 0) {
      warnings.push(
        `Session-Host hat ${sessionHost.sessions} aktive Session(s). Diese werden beim Stoppen beendet.`
      );
    }

    if (sessionHost?.status === 'Shutdown') {
      warnings.push('Session-Host ist bereits heruntergefahren.');
    }

    return {
      changes: [
        {
          objectType: 'session-host',
          objectId: payload.sessionHostId,
          objectDisplayName: payload.sessionHostName,
          action: 'update',
          before: {
            status: sessionHost?.status ?? 'Unknown',
            sessions: sessionHost?.sessions ?? 0,
          },
          after: {
            status: 'Shutdown',
            sessions: 0,
          },
        },
      ],
      warnings,
      estimatedDurationSeconds: 60,
    };
  };
}

/**
 * Drain-Modus setzen - Job-Handler
 */
export function createSetDrainModeHandler(
  avdProvider: AvdProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload as unknown as SetDrainModePayload;

    try {
      await avdProvider.setDrainMode(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.hostPoolId,
        payload.sessionHostName,
        payload.allowNewSession
      );

      return {
        success: true,
        data: {
          sessionHostId: payload.sessionHostId,
          sessionHostName: payload.sessionHostName,
          allowNewSession: payload.allowNewSession,
          updatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'SET_DRAIN_MODE_FAILED',
          message,
          retryable: false,
        },
      };
    }
  };
}

/**
 * Session trennen - Job-Handler
 */
export function createDisconnectSessionHandler(
  avdProvider: AvdProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload as unknown as DisconnectSessionPayload;

    try {
      await avdProvider.disconnectSession(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.hostPoolId,
        payload.sessionHostName,
        payload.sessionId
      );

      return {
        success: true,
        data: {
          sessionId: payload.sessionId,
          userPrincipalName: payload.userPrincipalName,
          disconnectedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'DISCONNECT_SESSION_FAILED',
          message,
          retryable: false,
        },
      };
    }
  };
}

/**
 * Session abmelden - Job-Handler
 */
export function createLogoffSessionHandler(
  avdProvider: AvdProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload as unknown as LogoffSessionPayload;

    try {
      await avdProvider.logoffSession(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.hostPoolId,
        payload.sessionHostName,
        payload.sessionId,
        payload.force
      );

      return {
        success: true,
        data: {
          sessionId: payload.sessionId,
          userPrincipalName: payload.userPrincipalName,
          loggedOffAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'LOGOFF_SESSION_FAILED',
          message,
          retryable: false,
        },
      };
    }
  };
}

/**
 * Nachricht senden - Job-Handler
 */
export function createSendMessageHandler(
  avdProvider: AvdProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload as unknown as SendMessagePayload;

    try {
      await avdProvider.sendMessage(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.hostPoolId,
        payload.sessionHostName,
        payload.sessionId,
        payload.messageTitle,
        payload.messageBody
      );

      return {
        success: true,
        data: {
          sessionId: payload.sessionId,
          userPrincipalName: payload.userPrincipalName,
          sentAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'SEND_MESSAGE_FAILED',
          message,
          retryable: false,
        },
      };
    }
  };
}

/**
 * AVD-Job-Definitionen registrieren
 */
function setDrainModePreview(avdProvider: AvdProvider): (ctx: PreviewContext) => Promise<PreviewResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as SetDrainModePayload;
    const host = await avdProvider.getSessionHost({ tenantId: ctx.tenantId, correlationId: crypto.randomUUID() }, payload.hostPoolId, payload.sessionHostName);
    const warnings: string[] = [];
    if (!payload.allowNewSession && host && host.sessions > 0) warnings.push(`${host.sessions} Sitzung(en) laufen weiter; neue Anmeldungen landen auf anderen Hosts.`);
    return {
      changes: [{ objectType: 'session-host', objectId: payload.sessionHostId, objectDisplayName: payload.sessionHostName, action: 'update', before: { neueSitzungen: host ? (host.allowNewSession ? 'erlaubt' : 'gesperrt') : 'unbekannt' }, after: { neueSitzungen: payload.allowNewSession ? 'erlaubt' : 'gesperrt' } }],
      warnings,
      estimatedDurationSeconds: 5,
    };
  };
}

function sessionPreview(verb: 'disconnect' | 'logoff'): (ctx: PreviewContext) => Promise<PreviewResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as DisconnectSessionPayload;
    return {
      changes: [{ objectType: 'user-session', objectId: payload.sessionId, objectDisplayName: `${payload.userPrincipalName} auf ${payload.sessionHostName}`, action: verb === 'logoff' ? 'delete' : 'update', before: { sitzung: 'aktiv' }, after: { sitzung: verb === 'logoff' ? 'abgemeldet' : 'getrennt' } }],
      warnings:
        verb === 'logoff'
          ? ['Abmelden beendet alle Programme der Sitzung; nicht gespeicherte Arbeit geht verloren. Vorher eine Nachricht senden.']
          : ['Trennen laesst Programme weiterlaufen; der Benutzer kann sich wieder verbinden.'],
      estimatedDurationSeconds: 5,
    };
  };
}

export type BulkHostAction = 'start' | 'stop' | 'drain-on' | 'drain-off';
const BULK_HOST_MAX = 50;

interface BulkHostPayload {
  hostPoolId: string;
  hostPoolName: string;
  action: BulkHostAction;
  hosts: Array<{ sessionHostId: string; sessionHostName: string }>;
}

/** Mehrere Hosts eines Pools in einem Job: eine Vorschau, ein Ergebnis je Host. */
function registerBulkHostJob(avdProvider: AvdProvider): void {
  registerJob(
    { type: 'avd.bulk-host-action', displayName: 'Sammelaktion auf Session-Hosts', maxRetries: 0, timeoutSeconds: 1800, concurrencyPerTenant: 1, requiresPreview: true },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as BulkHostPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      const outcomes = await mapWithLimit(payload.hosts.slice(0, BULK_HOST_MAX), 3, async (h) => {
        try {
          if (payload.action === 'start' || payload.action === 'stop') {
            const vm = await resolveVm(avdProvider, providerCtx, { hostPoolId: payload.hostPoolId, sessionHostName: h.sessionHostName });
            if (payload.action === 'start') await avdProvider.startVm(providerCtx, vm);
            else await avdProvider.stopVm(providerCtx, vm);
          } else {
            await avdProvider.setDrainMode(providerCtx, payload.hostPoolId, h.sessionHostName, payload.action === 'drain-off');
          }
          return { sessionHostName: h.sessionHostName, success: true, message: null as string | null };
        } catch (error) {
          return { sessionHostName: h.sessionHostName, success: false, message: error instanceof Error ? error.message : String(error) };
        }
      });
      const failed = outcomes.filter((o) => !o.success).length;
      const data = { action: payload.action, total: outcomes.length, succeeded: outcomes.length - failed, failed, outcomes } as unknown as Record<string, unknown>;
      if (failed === outcomes.length) return { success: false, data, error: { code: 'AVD_BULK_FAILED', message: `Auf allen ${outcomes.length} Hosts fehlgeschlagen`, retryable: false } };
      if (failed > 0) return { success: false, data, error: { code: 'AVD_BULK_PARTIAL', message: `${failed} von ${outcomes.length} Hosts fehlgeschlagen; Einzelheiten im Ergebnis`, retryable: false } };
      return { success: true, data };
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as BulkHostPayload;
      if (!payload.hosts?.length) throw new Error('Keine Hosts angegeben');
      if (payload.hosts.length > BULK_HOST_MAX) throw new Error(`Hoechstens ${BULK_HOST_MAX} Hosts je Sammelaktion`);
      // Ein Abruf fuer alle Hosts statt einer je Host
      const current = await avdProvider.listSessionHosts({ tenantId: ctx.tenantId, correlationId: crypto.randomUUID() }, payload.hostPoolId);
      const byName = new Map(current.map((h) => [sessionHostShortName(h.name).toLowerCase(), h]));
      let sessions = 0;
      const changes = payload.hosts.map((h) => {
        const host = byName.get(sessionHostShortName(h.sessionHostName).toLowerCase());
        sessions += payload.action === 'stop' ? (host?.sessions ?? 0) : 0;
        const before = payload.action === 'start' || payload.action === 'stop' ? { status: host?.status ?? 'unbekannt' } : { neueSitzungen: host ? (host.allowNewSession ? 'erlaubt' : 'gesperrt') : 'unbekannt' };
        const after = payload.action === 'start' ? { status: 'Available' } : payload.action === 'stop' ? { status: 'Shutdown' } : { neueSitzungen: payload.action === 'drain-off' ? 'erlaubt' : 'gesperrt' };
        return { objectType: 'session-host', objectId: h.sessionHostId, objectDisplayName: h.sessionHostName, action: 'update' as const, before, after };
      });
      const missing = payload.hosts.filter((h) => !byName.has(sessionHostShortName(h.sessionHostName).toLowerCase())).length;
      const warnings: string[] = [];
      if (sessions > 0) warnings.push(`Auf den zu stoppenden Hosts laufen ${sessions} Sitzung(en); sie werden beim Stoppen beendet. Vorher Drain-Modus setzen und eine Nachricht senden.`);
      if (missing > 0) warnings.push(`${missing} Host(s) sind nicht mehr im Pool; fuer sie schlaegt der Job fehl.`);
      return { changes, warnings, estimatedDurationSeconds: payload.action === 'start' || payload.action === 'stop' ? 180 : 10 };
    }
  );
}

export function registerAvdJobs(avdProvider: AvdProvider): void {
  registerJob(
    {
      type: 'avd.start-session-host',
      displayName: 'Session-Host starten',
      maxRetries: 2,
      timeoutSeconds: 180,
      concurrencyPerTenant: 3,
      requiresPreview: true,
    },
    createStartSessionHostHandler(avdProvider),
    createStartSessionHostPreviewGenerator(avdProvider)
  );

  registerJob(
    {
      type: 'avd.stop-session-host',
      displayName: 'Session-Host stoppen',
      maxRetries: 1,
      timeoutSeconds: 120,
      concurrencyPerTenant: 3,
      requiresPreview: true,
    },
    createStopSessionHostHandler(avdProvider),
    createStopSessionHostPreviewGenerator(avdProvider)
  );

  registerJob(
    {
      type: 'avd.set-drain-mode',
      displayName: 'Drain-Modus setzen',
      maxRetries: 2,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    createSetDrainModeHandler(avdProvider),
    setDrainModePreview(avdProvider)
  );

  registerJob(
    {
      type: 'avd.disconnect-session',
      displayName: 'Session trennen',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    createDisconnectSessionHandler(avdProvider),
    sessionPreview('disconnect')
  );

  registerJob(
    {
      type: 'avd.logoff-session',
      displayName: 'Session abmelden',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    createLogoffSessionHandler(avdProvider),
    sessionPreview('logoff')
  );

  registerJob(
    {
      type: 'avd.send-message',
      displayName: 'Nachricht senden',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 10,
      requiresPreview: false,
    },
    createSendMessageHandler(avdProvider)
  );

  registerBulkHostJob(avdProvider);
}
