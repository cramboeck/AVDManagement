/**
 * Jobs "Neustart mit Vorwarnung": Neustart mit Frist und Verschiebemoeglichkeit
 * fuer den Benutzer planen oder wieder abbrechen.
 *
 * Alles laeuft auf dem Geraet: eine SYSTEM-Aufgabe startet zur Frist neu
 * (wenn nicht schon geschehen), eine Benutzer-Aufgabe zeigt den Dialog mit
 * "Jetzt" und "Spaeter". Die Konsole stoesst nur an und kann abbrechen.
 */

import type { LibraryScriptId, ScriptRunResult } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { parseScriptOutput } from '../scripts/library.js';
import { renderRestartCancel, renderRestartPrompt, RESTART_TASK_NAME } from '../scripts/templates.js';
import type { RemediationOperations, RemediationRunState_ } from '../providers/remediation-provider.js';

export interface RestartPromptPayload {
  managedDeviceId: string;
  deviceName: string;
  deadlineMinutes: number;
  maxDeferrals: number;
  deferMinutes: number;
  message: string;
  reason: string;
}

export interface RestartCancelPayload {
  managedDeviceId: string;
  deviceName: string;
  reason: string;
}

export interface RestartJobOptions {
  timeoutMs?: number;
  pollMs?: number;
}

function failure(code: string, message: string): JobResult {
  return { success: false, error: { code, message, retryable: false } };
}

function toResult(state: RemediationRunState_, scriptId: string, hash: string, managedDeviceId: string, requestedAt: Date): ScriptRunResult {
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
    observedAt: new Date().toISOString(),
    possiblyStale: false,
    stateSource: state.source,
  };
}

export function registerRestartJobs(remediations: RemediationOperations, options: RestartJobOptions = {}): void {
  registerJob(
    {
      type: 'device.restart-prompt',
      displayName: 'Neustart mit Vorwarnung planen',
      maxRetries: 0,
      timeoutSeconds: 900,
      concurrencyPerTenant: 3,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as RestartPromptPayload;
      let rendered;
      try {
        rendered = renderRestartPrompt({ deadlineMinutes: Number(payload.deadlineMinutes), maxDeferrals: Number(payload.maxDeferrals), deferMinutes: Number(payload.deferMinutes), message: payload.message });
      } catch (error) {
        return failure('RESTART_INVALID', error instanceof Error ? error.message : String(error));
      }
      const requestedAt = new Date();
      let state: RemediationRunState_ | null;
      try {
        state = await remediations.runTransient({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, payload.managedDeviceId, `restart-${ctx.jobId.slice(0, 8)}`, rendered.content, options);
      } catch (error) {
        return failure('RESTART_START_FAILED', error instanceof Error ? error.message : String(error));
      }
      if (!state) return failure('RESTART_TIMEOUT', 'Das Geraet hat innerhalb der Wartezeit nicht gemeldet; es ist vermutlich offline. Es wurde nichts geplant.');
      const result = toResult(state, 'restart-prompt', rendered.hash, payload.managedDeviceId, requestedAt);
      const json = result.outputJson;
      if (state.detectionState !== 'success' || (json && json.error)) {
        return failure('RESTART_FAILED', String(json?.error ?? state.detectionError ?? 'Planen fehlgeschlagen'));
      }
      return { success: true, data: { ...result, deadlineAt: json?.deadlineAt ?? null, deferrals: rendered.maxDeferrals, deferMinutes: rendered.deferMinutes, userSessionPresent: json?.userSessionPresent === true, taskName: RESTART_TASK_NAME } as unknown as Record<string, unknown> };
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as RestartPromptPayload;
      const rendered = renderRestartPrompt({ deadlineMinutes: Number(payload.deadlineMinutes), maxDeferrals: Number(payload.maxDeferrals), deferMinutes: Number(payload.deferMinutes), message: payload.message });
      const deadline = new Date(Date.now() + rendered.deadlineMinutes * 60 * 1000);
      return {
        changes: [
          {
            objectType: 'device',
            objectId: payload.managedDeviceId,
            objectDisplayName: payload.deviceName,
            action: 'update',
            before: { restart: 'nicht geplant' },
            after: { restart: `spaetestens ${deadline.toISOString()}`, deferrals: `${rendered.maxDeferrals} x ${rendered.deferMinutes} Min`, message: rendered.message, tasks: `${RESTART_TASK_NAME}-Prompt, ${RESTART_TASK_NAME}-Deadline` },
          },
        ],
        warnings: [
          `Der angemeldete Benutzer auf ${payload.deviceName} sieht sofort und danach alle ${rendered.deferMinutes} Minuten einen Dialog mit "Jetzt neu starten" und "Spaeter"; verschieben geht ${rendered.maxDeferrals} Mal.`,
          `Zur Frist (${rendered.deadlineMinutes} Minuten ab Lauf) startet das Geraet mit zwei Minuten Countdown neu, auch wenn Programme offen sind (ungespeicherte Arbeit geht verloren). Wurde es vorher neu gestartet, passiert nichts mehr.`,
          'Ohne angemeldeten Benutzer erscheint der Dialog bei der naechsten Anmeldung; die Frist laeuft trotzdem. "Neustart abbrechen" nimmt alles zurueck.',
        ],
        estimatedDurationSeconds: 120,
      };
    }
  );

  registerJob(
    {
      type: 'device.restart-cancel',
      displayName: 'Geplanten Neustart abbrechen',
      maxRetries: 0,
      timeoutSeconds: 900,
      concurrencyPerTenant: 3,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as RestartCancelPayload;
      const rendered = renderRestartCancel();
      const requestedAt = new Date();
      let state: RemediationRunState_ | null;
      try {
        state = await remediations.runTransient({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, payload.managedDeviceId, `restart-cancel-${ctx.jobId.slice(0, 8)}`, rendered.content, options);
      } catch (error) {
        return failure('RESTART_START_FAILED', error instanceof Error ? error.message : String(error));
      }
      if (!state) return failure('RESTART_TIMEOUT', 'Das Geraet hat innerhalb der Wartezeit nicht gemeldet. Die geplanten Aufgaben bleiben bestehen, bis das Geraet erreichbar ist.');
      const result = toResult(state, 'restart-cancel', rendered.hash, payload.managedDeviceId, requestedAt);
      if (state.detectionState !== 'success' || result.outputJson?.error) {
        return failure('RESTART_FAILED', String(result.outputJson?.error ?? state.detectionError ?? 'Abbrechen fehlgeschlagen'));
      }
      return { success: true, data: { ...result, hadRequest: result.outputJson?.hadRequest === true, tasksRemoved: Number(result.outputJson?.tasksRemoved ?? 0) } as unknown as Record<string, unknown> };
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as RestartCancelPayload;
      return {
        changes: [
          {
            objectType: 'device',
            objectId: payload.managedDeviceId,
            objectDisplayName: payload.deviceName,
            action: 'update',
            before: { restart: 'geplant' },
            after: { restart: 'abgebrochen', tasks: 'entfernt' },
          },
        ],
        warnings: ['Entfernt die geplanten Aufgaben und den Eintrag auf dem Geraet und bricht einen laufenden Countdown ab. Ein bereits begonnener Neustart laesst sich nicht mehr stoppen.'],
        estimatedDurationSeconds: 120,
      };
    }
  );
}
