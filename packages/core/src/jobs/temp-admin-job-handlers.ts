/**
 * Jobs "Admin auf Zeit": lokale Administratorrechte fuer ein Konto auf einem
 * Geraet befristet gewaehren und wieder entziehen.
 *
 * Ersatz fuer Endpoint Privilege Management ohne eigenen Agenten: das Konto
 * kommt in die Gruppe Administratoren, eine geplante Aufgabe auf dem Geraet
 * entfernt es nach Ablauf wieder. Beides sind Einmalskripte mit eingebetteten
 * Parametern (kein Freitext), Begruendung Pflicht, alles im Audit.
 */

import type { LibraryScriptId, ScriptRunResult } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { parseScriptOutput } from '../scripts/library.js';
import { renderTempAdminGrant, renderTempAdminRevoke, tempAdminTaskName, validateAccountName, validateMinutes } from '../scripts/templates.js';
import type { RemediationOperations, RemediationRunState_ } from '../providers/remediation-provider.js';

export interface TempAdminPayload {
  managedDeviceId: string;
  deviceName: string;
  // Lokaler Kontoname, 'AzureAD\\name@domain' oder SID
  account: string;
  minutes: number;
  reason: string;
}

export interface TempAdminRevokePayload {
  managedDeviceId: string;
  deviceName: string;
  account: string;
  reason: string;
}

export interface TempAdminOptions {
  timeoutMs?: number;
  pollMs?: number;
}

function failure(code: string, message: string): JobResult {
  return { success: false, error: { code, message, retryable: false } };
}

function toResult(state: RemediationRunState_, scriptId: LibraryScriptId | 'temp-admin-grant' | 'temp-admin-revoke', hash: string, managedDeviceId: string, requestedAt: Date): ScriptRunResult {
  const output = state.postOutput || state.preOutput || null;
  return {
    scriptId: scriptId as LibraryScriptId,
    version: '1.0.0',
    hash,
    tenantScriptId: 'transient',
    managedDeviceId,
    requestedAt: requestedAt.toISOString(),
    completedAt: new Date().toISOString(),
    detectionState: state.detectionState,
    remediationState: state.remediationState,
    output,
    outputJson: parseScriptOutput(output),
    detectionError: state.detectionError,
    remediationError: state.remediationError,
    deviceReportedAt: state.updatedAt ?? state.syncedAt,
    possiblyStale: false,
    stateSource: state.source,
  };
}

export function registerTempAdminJobs(remediations: RemediationOperations, options: TempAdminOptions = {}): void {
  registerJob(
    {
      type: 'device.temp-admin',
      displayName: 'Admin auf Zeit gewaehren',
      maxRetries: 0,
      timeoutSeconds: 900,
      concurrencyPerTenant: 2,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as TempAdminPayload;
      let rendered;
      try {
        rendered = renderTempAdminGrant({ account: payload.account, minutes: Number(payload.minutes) });
      } catch (error) {
        return failure('TEMP_ADMIN_INVALID', error instanceof Error ? error.message : String(error));
      }
      const requestedAt = new Date();
      let state: RemediationRunState_ | null;
      try {
        state = await remediations.runTransient({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, payload.managedDeviceId, `temp-admin-${ctx.jobId.slice(0, 8)}`, rendered.content, options);
      } catch (error) {
        return failure('TEMP_ADMIN_START_FAILED', error instanceof Error ? error.message : String(error));
      }
      if (!state) {
        return failure('TEMP_ADMIN_TIMEOUT', 'Das Geraet hat innerhalb der Wartezeit nicht gemeldet; es ist vermutlich offline. Es wurden keine Rechte gewaehrt, solange das Skript nicht lief.');
      }
      const result = toResult(state, 'temp-admin-grant', rendered.hash, payload.managedDeviceId, requestedAt);
      const json = result.outputJson;
      if (state.detectionState !== 'success' || (json && json.error)) {
        return failure('TEMP_ADMIN_FAILED', String(json?.error ?? state.detectionError ?? 'Gewaehren fehlgeschlagen'));
      }
      return { success: true, data: { ...result, account: payload.account, minutes: payload.minutes, expiresAt: json?.expiresAt ?? null, taskName: tempAdminTaskName(payload.account) } as unknown as Record<string, unknown> };
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as TempAdminPayload;
      const account = validateAccountName(payload.account);
      const minutes = validateMinutes(Number(payload.minutes));
      const expires = new Date(Date.now() + minutes * 60 * 1000);
      return {
        changes: [
          {
            objectType: 'device',
            objectId: payload.managedDeviceId,
            objectDisplayName: payload.deviceName,
            action: 'update',
            before: { localAdministrators: 'ohne dieses Konto' },
            after: { localAdministrators: `+ ${account} bis etwa ${expires.toISOString()}`, minutes, revokeTask: tempAdminTaskName(account) },
          },
        ],
        warnings: [
          `${account} erhaelt fuer ${minutes} Minuten volle Administratorrechte auf ${payload.deviceName}. Alles, was in dieser Zeit passiert, laeuft mit diesen Rechten.`,
          'Der Rueckbau laeuft als geplante Aufgabe auf dem Geraet, auch nach Neustart oder Offline-Phase. Zur Kontrolle danach das Skript "Lokale Administratoren" ausfuehren.',
          'Begruendung, Konto, Dauer und Ergebnis stehen im Audit-Log.',
        ],
        estimatedDurationSeconds: 120,
      };
    }
  );

  registerJob(
    {
      type: 'device.temp-admin-revoke',
      displayName: 'Admin auf Zeit entziehen',
      maxRetries: 0,
      timeoutSeconds: 900,
      concurrencyPerTenant: 2,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as TempAdminRevokePayload;
      let rendered;
      try {
        rendered = renderTempAdminRevoke({ account: payload.account });
      } catch (error) {
        return failure('TEMP_ADMIN_INVALID', error instanceof Error ? error.message : String(error));
      }
      const requestedAt = new Date();
      let state: RemediationRunState_ | null;
      try {
        state = await remediations.runTransient({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, payload.managedDeviceId, `temp-admin-revoke-${ctx.jobId.slice(0, 8)}`, rendered.content, options);
      } catch (error) {
        return failure('TEMP_ADMIN_START_FAILED', error instanceof Error ? error.message : String(error));
      }
      if (!state) {
        return failure('TEMP_ADMIN_TIMEOUT', 'Das Geraet hat innerhalb der Wartezeit nicht gemeldet. Die geplante Rueckbau-Aufgabe auf dem Geraet entzieht die Rechte trotzdem nach Ablauf.');
      }
      const result = toResult(state, 'temp-admin-revoke', rendered.hash, payload.managedDeviceId, requestedAt);
      if (state.detectionState !== 'success' || result.outputJson?.error) {
        return failure('TEMP_ADMIN_FAILED', String(result.outputJson?.error ?? state.detectionError ?? 'Entziehen fehlgeschlagen'));
      }
      return { success: true, data: { ...result, account: payload.account } as unknown as Record<string, unknown> };
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as TempAdminRevokePayload;
      const account = validateAccountName(payload.account);
      return {
        changes: [
          {
            objectType: 'device',
            objectId: payload.managedDeviceId,
            objectDisplayName: payload.deviceName,
            action: 'update',
            before: { localAdministrators: `mit ${account}` },
            after: { localAdministrators: `ohne ${account}`, revokeTask: 'entfernt' },
          },
        ],
        warnings: ['Das Konto verliert die Administratorrechte sofort; die geplante Rueckbau-Aufgabe wird geloescht.'],
        estimatedDurationSeconds: 120,
      };
    }
  );
}
