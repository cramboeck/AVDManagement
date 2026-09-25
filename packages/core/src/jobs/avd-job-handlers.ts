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
import { AvdProvider } from '../providers/avd-provider.js';

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
      await avdProvider.startVm(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.vmResourceId
      );

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
          retryable: message.includes('429') || message.includes('timeout'),
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
      await avdProvider.stopVm(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.vmResourceId
      );

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
          retryable: message.includes('429') || message.includes('timeout'),
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
      requiresPreview: false,
    },
    createSetDrainModeHandler(avdProvider)
  );

  registerJob(
    {
      type: 'avd.disconnect-session',
      displayName: 'Session trennen',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: false,
    },
    createDisconnectSessionHandler(avdProvider)
  );

  registerJob(
    {
      type: 'avd.logoff-session',
      displayName: 'Session abmelden',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: false,
    },
    createLogoffSessionHandler(avdProvider)
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
}
