/**
 * Job "Software ohne winget deinstallieren"
 *
 * Fuer Programme, die winget nicht kennt: der Eintrag unter den
 * Uninstall-Schluesseln der Registry (exakter Anzeigename) oder ein
 * Appx/MSIX-Paket. Das Einmalskript kennt die stillen Schalter von MSI,
 * QuietUninstallString, Inno Setup, NSIS und InstallShield; bei einem
 * unbekannten Deinstaller bricht es ab und nennt den Befehl, damit der
 * Techniker Argumente nachreicht. Nichts laeuft ohne stillen Schalter blind.
 */

import type { LibraryScriptId, ScriptRunResult } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { parseScriptOutput } from '../scripts/library.js';
import { renderAppUninstall, type AppUninstallKind } from '../scripts/templates.js';
import type { RemediationOperations, RemediationRunState_ } from '../providers/remediation-provider.js';

export interface AppUninstallPayload {
  managedDeviceId: string;
  deviceName: string;
  displayName: string;
  version: string | null;
  publisher: string | null;
  kind: AppUninstallKind;
  extraArgs: string | null;
  reason: string | null;
}

export interface AppUninstallJobOptions {
  timeoutMs?: number;
  pollMs?: number;
}

function failure(code: string, message: string): JobResult {
  return { success: false, error: { code, message, retryable: false } };
}

function toResult(state: RemediationRunState_, hash: string, managedDeviceId: string, requestedAt: Date): ScriptRunResult {
  const output = state.postOutput || state.preOutput || null;
  return {
    scriptId: 'app-uninstall' as LibraryScriptId,
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

export function registerAppUninstallJob(remediations: RemediationOperations, options: AppUninstallJobOptions = {}): void {
  registerJob(
    {
      type: 'device.app-uninstall',
      displayName: 'Software deinstallieren (ohne winget)',
      maxRetries: 0,
      timeoutSeconds: 1500,
      concurrencyPerTenant: 2,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as AppUninstallPayload;
      let rendered;
      try {
        rendered = renderAppUninstall({ displayName: payload.displayName, version: payload.version, kind: payload.kind, extraArgs: payload.extraArgs });
      } catch (error) {
        return failure('UNINSTALL_INVALID', error instanceof Error ? error.message : String(error));
      }
      const requestedAt = new Date();
      let state: RemediationRunState_ | null;
      try {
        state = await remediations.runTransient({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, payload.managedDeviceId, `uninstall-${ctx.jobId.slice(0, 8)}`, rendered.content, {
          timeoutMs: options.timeoutMs ?? 20 * 60 * 1000,
          pollMs: options.pollMs,
        });
      } catch (error) {
        return failure('UNINSTALL_START_FAILED', error instanceof Error ? error.message : String(error));
      }
      if (!state) {
        return failure('UNINSTALL_TIMEOUT', 'Das Geraet hat innerhalb der Wartezeit nicht gemeldet; es ist vermutlich offline oder der Deinstaller laeuft noch.');
      }
      const result = toResult(state, rendered.hash, payload.managedDeviceId, requestedAt);
      const json = result.outputJson;
      const data = { ...result, displayName: rendered.displayName, kind: rendered.kind } as unknown as Record<string, unknown>;
      if (state.detectionState !== 'success' && state.detectionState !== 'fail') {
        return failure('UNINSTALL_FAILED', String(state.detectionError ?? 'Skript lief nicht durch'));
      }
      if (!json) return failure('UNINSTALL_NO_OUTPUT', 'Das Skript hat kein auswertbares Ergebnis geliefert');
      if (json.error) return { success: false, data, error: { code: 'UNINSTALL_FAILED', message: String(json.error), retryable: false } };
      if (json.method === 'none' && json.found === true) {
        return { success: false, data, error: { code: 'UNINSTALL_NEEDS_ARGUMENTS', message: `Kein stiller Schalter bekannt fuer: ${String(json.command ?? '?')}. Argumente im Dialog angeben und erneut starten.`, retryable: false } };
      }
      if (json.success !== true) {
        const note = typeof json.note === 'string' && json.note ? json.note : `exit code ${String(json.exitCode)}`;
        return { success: false, data, error: { code: 'UNINSTALL_FAILED', message: note, retryable: false } };
      }
      return { success: true, data };
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as AppUninstallPayload;
      const rendered = renderAppUninstall({ displayName: payload.displayName, version: payload.version, kind: payload.kind, extraArgs: payload.extraArgs });
      const label = payload.version ? `${rendered.displayName} ${payload.version}` : rendered.displayName;
      const warnings = [
        rendered.kind === 'appx'
          ? `Das Store-/MSIX-Paket "${rendered.displayName}" wird auf ${payload.deviceName} fuer alle Benutzer entfernt und die Bereitstellung geloescht, damit es nicht bei der naechsten Anmeldung zurueckkommt.`
          : `Das Skript sucht auf ${payload.deviceName} den Registry-Eintrag mit genau diesem Anzeigenamen und fuehrt den stillen Deinstallationsbefehl als SYSTEM aus: msiexec fuer MSI, QuietUninstallString, Inno Setup, NSIS oder InstallShield mit ihren Schaltern.`,
        'Angemeldete Benutzer werden nicht gefragt; laufende Instanzen des Programms werden nicht vorher beendet. Benutzerdaten bleiben je nach Deinstaller erhalten.',
        'Ein EXE-Deinstaller ohne bekannten stillen Schalter wird nicht gestartet; der Job meldet dann den gefundenen Befehl, und du gibst die Argumente nach. Das verhindert einen unsichtbar wartenden Dialog als SYSTEM.',
        'Ist die Software ueber Intune zugewiesen, installiert Intune sie beim naechsten Abgleich wieder; dann zuerst die Zuweisung entfernen.',
      ];
      if (rendered.extraArgs) warnings.push(`Zusaetzliche Argumente werden an den Deinstaller angehaengt: ${rendered.extraArgs}`);
      return {
        changes: [
          {
            objectType: 'device',
            objectId: payload.managedDeviceId,
            objectDisplayName: payload.deviceName,
            action: 'delete',
            before: { software: label, publisher: payload.publisher ?? '', source: rendered.kind === 'appx' ? 'Appx/MSIX' : 'Registry (Uninstall)' },
            after: { software: `${label} entfernt`, method: rendered.kind === 'appx' ? 'Remove-AppxPackage -AllUsers' : 'stiller Deinstaller laut Registry', extraArgs: rendered.extraArgs ?? '' },
          },
        ],
        warnings,
        estimatedDurationSeconds: 300,
      };
    }
  );
}
