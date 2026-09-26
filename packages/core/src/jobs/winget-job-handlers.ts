/**
 * Job "winget auf dem Geraet": ein Paket aus der Quelle winget im
 * Maschinenkontext installieren oder aktualisieren.
 *
 * Einmalskript mit eingebetteten, geprueften Parametern (Id, Modus,
 * Version), ausgefuehrt ueber Intune Remediations. Das ist der schnelle Weg
 * fuer ein einzelnes Geraet; fuer viele Geraete ist der Paketkatalog mit
 * Rollout der richtige Weg, weil nur der eine Erkennung und einen Stand je
 * Tenant hat.
 */

import type { LibraryScriptId, ScriptRunResult } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { parseScriptOutput } from '../scripts/library.js';
import { renderWingetInstall, type WingetInstallMode } from '../scripts/templates.js';
import type { RemediationOperations, RemediationRunState_ } from '../providers/remediation-provider.js';

export interface WingetInstallPayload {
  managedDeviceId: string;
  deviceName: string;
  packageId: string;
  mode: WingetInstallMode;
  version: string | null;
  // Anzeige aus der letzten winget-Pruefung, nur fuer die Vorschau
  displayName: string | null;
  installedVersion: string | null;
  availableVersion: string | null;
  reason: string | null;
}

export interface WingetJobOptions {
  timeoutMs?: number;
  pollMs?: number;
}

function failure(code: string, message: string): JobResult {
  return { success: false, error: { code, message, retryable: false } };
}

function toResult(state: RemediationRunState_, hash: string, managedDeviceId: string, requestedAt: Date): ScriptRunResult {
  const output = state.postOutput || state.preOutput || null;
  return {
    scriptId: 'winget-install' as LibraryScriptId,
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

export function registerWingetJobs(remediations: RemediationOperations, options: WingetJobOptions = {}): void {
  registerJob(
    {
      type: 'device.winget-install',
      displayName: 'Software per winget verwalten',
      maxRetries: 0,
      timeoutSeconds: 1500,
      concurrencyPerTenant: 2,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as WingetInstallPayload;
      let rendered;
      try {
        rendered = renderWingetInstall({ packageId: payload.packageId, mode: payload.mode, version: payload.version });
      } catch (error) {
        return failure('WINGET_INVALID', error instanceof Error ? error.message : String(error));
      }
      const requestedAt = new Date();
      let state: RemediationRunState_ | null;
      try {
        state = await remediations.runTransient({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, payload.managedDeviceId, `winget-${ctx.jobId.slice(0, 8)}`, rendered.content, {
          timeoutMs: options.timeoutMs ?? 20 * 60 * 1000,
          pollMs: options.pollMs,
        });
      } catch (error) {
        return failure('WINGET_START_FAILED', error instanceof Error ? error.message : String(error));
      }
      if (!state) {
        return failure('WINGET_TIMEOUT', 'Das Geraet hat innerhalb der Wartezeit nicht gemeldet; es ist vermutlich offline oder die Installation dauert noch. Ergebnis spaeter mit der winget-Pruefung kontrollieren.');
      }
      const result = toResult(state, rendered.hash, payload.managedDeviceId, requestedAt);
      const json = result.outputJson;
      const data = { ...result, packageId: rendered.packageId, mode: rendered.mode, requestedVersion: rendered.version } as unknown as Record<string, unknown>;
      if (state.detectionState !== 'success' && state.detectionState !== 'fail') {
        return failure('WINGET_FAILED', String(state.detectionError ?? 'Skript lief nicht durch'));
      }
      if (!json) return failure('WINGET_NO_OUTPUT', 'Das Skript hat kein auswertbares Ergebnis geliefert');
      if (json.error) return { success: false, data, error: { code: 'WINGET_FAILED', message: String(json.error), retryable: false } };
      if (json.success !== true) {
        const note = typeof json.note === 'string' && json.note ? json.note : `winget exit code ${String(json.exitCode)}`;
        return { success: false, data, error: { code: 'WINGET_FAILED', message: `${note}${json.message ? `: ${String(json.message)}` : ''}`, retryable: false } };
      }
      return { success: true, data };
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as WingetInstallPayload;
      const rendered = renderWingetInstall({ packageId: payload.packageId, mode: payload.mode, version: payload.version });
      const label = payload.displayName ? `${payload.displayName} (${rendered.packageId})` : rendered.packageId;
      const warnings =
        payload.mode === 'uninstall'
          ? [
              `winget deinstalliert ${label} als SYSTEM auf ${payload.deviceName} mit dem stillen Deinstallationsbefehl aus dem Katalogmanifest. Angemeldete Benutzer werden nicht gefragt.`,
              'Benutzerdaten und Einstellungen der Software bleiben je nach Deinstallationsprogramm erhalten. Software, die nur im Benutzerprofil installiert ist, kann der Maschinenkontext nicht entfernen.',
              'Ist die Software ueber Intune zugewiesen, installiert Intune sie beim naechsten Abgleich wieder; dann zuerst die Zuweisung entfernen.',
            ]
          : [
              `winget laeuft als SYSTEM auf ${payload.deviceName} und laedt den Installer aus der Quelle winget (Community-Katalog). Das Cockpit prueft dabei keinen Hash; das macht winget selbst gegen das Manifest.`,
              'Der Lauf gilt nur fuer dieses Geraet: keine Intune-App, keine Erkennung, kein Stand je Tenant. Fuer mehrere Geraete das Paket im Katalog anlegen und ausrollen.',
              'Software, die nur im Benutzerprofil installiert ist, kann der Maschinenkontext nicht aktualisieren.',
            ];
      if (payload.mode === 'install' && payload.installedVersion) warnings.push('Laut letzter Pruefung ist die Software bereits installiert; winget meldet dann "bereits aktuell".');
      return {
        changes: [
          {
            objectType: 'device',
            objectId: payload.managedDeviceId,
            objectDisplayName: payload.deviceName,
            action: payload.mode === 'uninstall' ? 'delete' : 'update',
            before: { software: payload.installedVersion ? `${label} ${payload.installedVersion}` : payload.mode === 'install' ? `${label} nicht installiert (laut Inventar)` : `${label} (Version laut Inventar unbekannt)` },
            after: payload.mode === 'uninstall' ? { software: `${label} entfernt`, mode: 'uninstall', scope: 'machine' } : { software: `${label} ${rendered.version ?? payload.availableVersion ?? '(neueste im Katalog)'}`, mode: rendered.mode, scope: 'machine' },
          },
        ],
        warnings,
        estimatedDurationSeconds: 300,
      };
    }
  );
}
