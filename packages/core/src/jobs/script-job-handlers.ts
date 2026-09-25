/**
 * Job: Bibliotheksskript auf einem Geraet ausfuehren (Intune Remediation auf Abruf)
 *
 * Preview zeigt Skript, Version, Hash und Wirkung; der Job bringt das
 * Remediation-Objekt auf Stand, startet es und wartet auf das Ergebnis des
 * Geraets. Name, Version und Hash landen ueber die Preview im Audit.
 */

import type { LibraryScriptId, RevealedScriptResult, ScriptRunResult, SealedCipher } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { getLibraryScript, parseScriptOutput, type LoadedScript } from '../scripts/library.js';
import { buildRunCommandScript, parseRunCommandOutput } from '../scripts/run-command.js';
import type { RemediationOperations, RemediationRunState_ } from '../providers/remediation-provider.js';
import type { ProviderContext } from '../providers/resource-provider.js';
import type { VmCommandOutput } from '../providers/avd-provider.js';

export interface RunScriptPayload {
  managedDeviceId: string;
  deviceName: string;
  scriptId: LibraryScriptId;
}

/**
 * Versiegelt personenbezogene Ergebnisteile; die API liefert die Umsetzung
 * mit Schluessel aus der Umgebung beziehungsweise dem Key Vault.
 */
export interface ResultSealer {
  seal(payload: RevealedScriptResult): Promise<SealedCipher>;
}

export interface RunScriptOptions {
  // Wie lange auf das Geraet gewartet wird (Standard 10 Minuten)
  timeoutMs?: number;
  pollMs?: number;
  sealer?: ResultSealer | null;
}

function failure(code: string, message: string): JobResult {
  return { success: false, error: { code, message, retryable: false } };
}

/**
 * Ergebnis fuer die Ablage vorbereiten: ohne Personenbezug unveraendert, sonst
 * Klartext raus und Chiffrat rein. Ohne Sealer darf so ein Lauf nicht abgelegt werden.
 */
export async function finalizeResult(result: ScriptRunResult, containsPersonalData: boolean, sealer: ResultSealer | null | undefined): Promise<JobResult> {
  if (!containsPersonalData) {
    return { success: true, data: result as unknown as Record<string, unknown> };
  }
  if (!sealer) {
    return failure(
      'RESULT_SEAL_UNAVAILABLE',
      'Das Ergebnis enthaelt personenbezogene Daten, aber die Verschluesselung ist nicht eingerichtet (RESULT_ENCRYPTION_KEY). Ergebnis verworfen.'
    );
  }
  const cipher = await sealer.seal({
    output: result.output,
    outputJson: result.outputJson,
    detectionError: result.detectionError,
    remediationError: result.remediationError,
  });
  const sealed: ScriptRunResult = { ...result, output: null, outputJson: null, detectionError: null, remediationError: null, sealed: true, cipher };
  return { success: true, data: sealed as unknown as Record<string, unknown> };
}

export function registerScriptJobs(remediations: RemediationOperations, options: RunScriptOptions = {}): void {
  registerJob(
    {
      type: 'device.run-script',
      displayName: 'Skript ausfuehren',
      maxRetries: 0,
      timeoutSeconds: 900,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as RunScriptPayload;
      const script = getLibraryScript(payload.scriptId);
      if (!script) {
        return failure('SCRIPT_UNKNOWN', `Script '${payload.scriptId}' is not in the library`);
      }
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };

      let tenantScriptId: string;
      try {
        tenantScriptId = (await remediations.ensureScript(providerCtx, script)).tenantScriptId;
      } catch (error) {
        return failure('SCRIPT_PUBLISH_FAILED', error instanceof Error ? error.message : String(error));
      }

      // Zustand vor dem Start merken: Intune fuehrt keine Lauf-Id, also gilt
      // als Ergebnis, was nach dem Start neuer ist oder vom Vorzustand abweicht
      let baseline: RemediationRunState_ | null = null;
      try {
        baseline = await remediations.getRunState(providerCtx, payload.managedDeviceId, tenantScriptId);
      } catch {
        baseline = null;
      }

      const requestedAt = new Date();
      try {
        await remediations.runOnDemand(providerCtx, payload.managedDeviceId, tenantScriptId);
      } catch (error) {
        return failure('SCRIPT_START_FAILED', error instanceof Error ? error.message : String(error));
      }

      let state = await remediations.waitForRunState(providerCtx, payload.managedDeviceId, tenantScriptId, requestedAt, {
        timeoutMs: options.timeoutMs,
        pollMs: options.pollMs,
        baseline,
      });
      let possiblyStale = false;
      if (!state) {
        // Lieber der letzte bekannte Stand mit Hinweis als gar nichts
        const last = await remediations.getRunState(providerCtx, payload.managedDeviceId, tenantScriptId).catch(() => null);
        if (!last) {
          return failure(
            'SCRIPT_RESULT_TIMEOUT',
            `Das Geraet hat innerhalb der Wartezeit kein Ergebnis gemeldet und Intune kennt fuer dieses Skript noch keinen Zustand des Geraets (Skript ${tenantScriptId}). Es ist vermutlich offline; das Ergebnis erscheint spaeter im Intune-Portal unter Geraet > Remediations.`
          );
        }
        state = last;
        possiblyStale = true;
      }

      const output = state.postOutput || state.preOutput || null;
      const result: ScriptRunResult = {
        scriptId: script.id,
        version: script.version,
        hash: script.hash,
        tenantScriptId,
        managedDeviceId: payload.managedDeviceId,
        requestedAt: requestedAt.toISOString(),
        completedAt: new Date().toISOString(),
        detectionState: state.detectionState,
        remediationState: state.remediationState,
        output,
        outputJson: parseScriptOutput(output),
        detectionError: state.detectionError,
        remediationError: state.remediationError,
        deviceReportedAt: state.updatedAt ?? state.syncedAt,
        possiblyStale,
        stateSource: state.source,
      };

      if (state.detectionState === 'scriptError' || state.remediationState === 'scriptError' || state.remediationState === 'remediationFailed') {
        return {
          success: false,
          error: {
            code: 'SCRIPT_FAILED_ON_DEVICE',
            message: state.remediationError || state.detectionError || `Script ended with ${state.detectionState}/${state.remediationState}`,
            retryable: false,
          },
        };
      }

      return finalizeResult(result, script.containsPersonalData, options.sealer);
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as RunScriptPayload;
      const script = getLibraryScript(payload.scriptId);
      if (!script) {
        throw new Error(`Script '${payload.scriptId}' is not in the library`);
      }
      const warnings = [
        'Das Skript laeuft als SYSTEM auf dem Geraet. Es stammt aus der signierten Bibliothek der Konsole; Version und Pruefsumme werden protokolliert.',
        `Das Ergebnis kommt erst, wenn das Geraet online ist und sich bei Intune meldet, in der Regel innerhalb von ${Math.ceil(script.expectedDurationSeconds / 60)} Minuten.`,
      ];
      if (script.hasRemediation && script.remediationSummary) {
        warnings.push(`Aendert etwas auf dem Geraet: ${script.remediationSummary}`);
      } else {
        warnings.push('Nur lesend: das Skript veraendert nichts auf dem Geraet.');
      }
      if (script.containsPersonalData) {
        warnings.push('Die Ausgabe enthaelt Kontonamen. Sie wird verschluesselt gespeichert, jede Anzeige braucht eine Begruendung und steht im Audit, nach 30 Tagen wird sie geloescht.');
      }
      return {
        changes: [
          {
            objectType: 'device',
            objectId: payload.managedDeviceId,
            objectDisplayName: payload.deviceName,
            action: 'update',
            before: {},
            after: {
              script: script.displayName,
              scriptId: script.id,
              version: script.version,
              hash: script.hash,
              runAs: script.runAsAccount,
              remediation: script.hasRemediation,
            },
          },
        ],
        warnings,
        estimatedDurationSeconds: script.expectedDurationSeconds,
      };
    }
  );
}

// ============================================
// Azure Run Command (AVD-Session-Hosts, Azure-VMs)
// ============================================

export interface AvdRunScriptPayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  vmResourceId: string;
  scriptId: LibraryScriptId;
}

/**
 * Was der Job braucht; AvdProvider erfuellt es, Tests koennen es nachbilden.
 */
export interface VmCommandRunner {
  runCommand(ctx: ProviderContext, vmResourceId: string, scriptLines: string[], timeoutMs?: number): Promise<VmCommandOutput>;
}

function scriptWarnings(script: LoadedScript, transport: string): string[] {
  const warnings = [
    `Das Skript laeuft als SYSTEM auf dem Host ueber ${transport}. Es stammt aus der Bibliothek der Konsole; Version und Pruefsumme werden protokolliert.`,
  ];
  if (script.hasRemediation && script.remediationSummary) {
    warnings.push(`Aendert etwas auf dem Host: ${script.remediationSummary}`);
  } else {
    warnings.push('Nur lesend: das Skript veraendert nichts auf dem Host.');
  }
  return warnings;
}

export function registerAvdScriptJobs(runner: VmCommandRunner, options: RunScriptOptions = {}): void {
  registerJob(
    {
      type: 'avd.run-script',
      displayName: 'Skript auf Session-Host ausfuehren',
      maxRetries: 0,
      timeoutSeconds: 900,
      concurrencyPerTenant: 3,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as AvdRunScriptPayload;
      const script = getLibraryScript(payload.scriptId);
      if (!script) {
        return failure('SCRIPT_UNKNOWN', `Script '${payload.scriptId}' is not in the library`);
      }
      if (!payload.vmResourceId) {
        return failure('VM_UNKNOWN', 'Session host has no VM resource id');
      }

      const requestedAt = new Date();
      let raw: VmCommandOutput;
      try {
        raw = await runner.runCommand({ tenantId: ctx.tenantId, correlationId: ctx.correlationId }, payload.vmResourceId, buildRunCommandScript(script), options.timeoutMs);
      } catch (error) {
        return failure('RUN_COMMAND_FAILED', error instanceof Error ? error.message : String(error));
      }

      const outcome = parseRunCommandOutput(raw.stdout, raw.stderr);
      const detectionState = outcome.exitCode === 0 ? 'success' : outcome.exitCode === 1 ? 'fail' : outcome.exitCode === null ? 'unknown' : 'scriptError';
      const remediationState =
        outcome.remediation.state === 'none'
          ? 'skipped'
          : outcome.remediation.state === 'skipped'
            ? 'skipped'
            : outcome.remediation.exitCode === 0
              ? 'success'
              : 'remediationFailed';

      const result: ScriptRunResult = {
        scriptId: script.id,
        version: script.version,
        hash: script.hash,
        tenantScriptId: 'azure-run-command',
        managedDeviceId: payload.vmResourceId,
        requestedAt: requestedAt.toISOString(),
        completedAt: new Date().toISOString(),
        detectionState,
        remediationState,
        output: outcome.output,
        outputJson: parseScriptOutput(outcome.output),
        detectionError: detectionState === 'scriptError' ? outcome.stderr || `Exit code ${outcome.exitCode}` : outcome.stderr,
        remediationError: remediationState === 'remediationFailed' ? `Remediation exit code ${outcome.remediation.exitCode}` : null,
        deviceReportedAt: new Date().toISOString(),
        possiblyStale: false,
        stateSource: 'run-command',
      };

      if (detectionState === 'scriptError' || remediationState === 'remediationFailed') {
        return { success: false, error: { code: 'SCRIPT_FAILED_ON_HOST', message: result.remediationError || result.detectionError || 'Script failed', retryable: false } };
      }
      if (detectionState === 'unknown' && !outcome.output) {
        return failure('RUN_COMMAND_NO_OUTPUT', outcome.stderr || 'Run Command returned no output; the VM may be stopped or the agent unresponsive');
      }
      return finalizeResult(result, script.containsPersonalData, options.sealer);
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as AvdRunScriptPayload;
      const script = getLibraryScript(payload.scriptId);
      if (!script) {
        throw new Error(`Script '${payload.scriptId}' is not in the library`);
      }
      return {
        changes: [
          {
            objectType: 'session-host',
            objectId: payload.sessionHostId,
            objectDisplayName: payload.sessionHostName,
            action: 'update',
            before: {},
            after: {
              script: script.displayName,
              scriptId: script.id,
              version: script.version,
              hash: script.hash,
              runAs: 'system',
              remediation: script.hasRemediation,
              transport: 'azure-run-command',
            },
          },
        ],
        warnings: [...scriptWarnings(script, 'Azure Run Command'), 'Die VM muss laufen; Run Command braucht den Azure-VM-Agent.'],
        estimatedDurationSeconds: Math.min(script.expectedDurationSeconds, 180),
      };
    }
  );
}
