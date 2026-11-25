/**
 * Jobs "Geraete-Haertung": Bibliotheksskript hardening im Tenant anlegen und
 * taeglich allen Geraeten zuweisen, oder die Zuweisung entfernen.
 *
 * Das Skript liest nur. Die Konsole wertet die Zustaende aus
 * (security/hardening.ts) und zeigt sie unter Sicherheit > Baselines.
 */

import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { getLibraryScript } from '../scripts/library.js';
import { HARDENING_CONTROLS } from '../security/hardening.js';
import type { ProviderContext } from '../providers/resource-provider.js';
import type { EnsureScriptResult, ScriptSchedule } from '../providers/remediation-provider.js';

export interface HardeningScheduleOperations {
  ensureScript(ctx: ProviderContext, script: NonNullable<ReturnType<typeof getLibraryScript>>): Promise<EnsureScriptResult>;
  setSchedule(ctx: ProviderContext, tenantScriptId: string, schedule: ScriptSchedule): Promise<void>;
  findTenantScriptId(ctx: ProviderContext, scriptId: string): Promise<string | null>;
}

export interface HardeningTogglePayload {
  tenantDisplayName: string;
  reason: string | null;
}

function failure(code: string, message: string): JobResult {
  return { success: false, error: { code, message, retryable: false } };
}

export function registerHardeningJobs(remediations: HardeningScheduleOperations): void {
  registerJob(
    {
      type: 'tenant.hardening-enable',
      displayName: 'Geraete-Haertung pruefen (taeglich)',
      maxRetries: 0,
      timeoutSeconds: 300,
      concurrencyPerTenant: 1,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const script = getLibraryScript('hardening');
      if (!script) return failure('HARDENING_SCRIPT_MISSING', 'Bibliotheksskript hardening fehlt');
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const ensured = await remediations.ensureScript(providerCtx, script);
        await remediations.setSchedule(providerCtx, ensured.tenantScriptId, 'daily');
        return { success: true, data: { tenantScriptId: ensured.tenantScriptId, scriptAction: ensured.action, schedule: 'daily', target: 'all-devices', controls: HARDENING_CONTROLS.length } };
      } catch (error) {
        return failure('HARDENING_ENABLE_FAILED', error instanceof Error ? error.message : String(error));
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as HardeningTogglePayload;
      return {
        changes: [
          {
            objectType: 'tenant',
            objectId: ctx.tenantId,
            objectDisplayName: payload.tenantDisplayName,
            action: 'update',
            before: { hardeningCheck: 'aus' },
            after: { hardeningCheck: 'taeglich 12 Uhr auf allen Geraeten', script: 'ZSC-hardening (nur lesend)', controls: HARDENING_CONTROLS.length },
          },
        ],
        warnings: [
          `Intune legt das Remediation-Objekt ZSC-hardening an und weist es allen Geraeten taeglich um 12 Uhr Ortszeit zu. Das Skript prueft ${HARDENING_CONTROLS.length} Kontrollen und aendert nichts.`,
          'Ergebnisse erscheinen nach dem ersten Lauf je Geraet unter Sicherheit > Baselines; offline Geraete melden beim naechsten Start.',
          'Braucht die Windows-Lizenzbestaetigung fuer Remediations im Tenant.',
        ],
        estimatedDurationSeconds: 30,
      };
    }
  );

  registerJob(
    {
      type: 'tenant.hardening-disable',
      displayName: 'Geraete-Haertung nicht mehr pruefen',
      maxRetries: 0,
      timeoutSeconds: 300,
      concurrencyPerTenant: 1,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const tenantScriptId = await remediations.findTenantScriptId(providerCtx, 'hardening');
        if (!tenantScriptId) return { success: true, data: { schedule: 'none', note: 'Skript war nicht im Tenant' } };
        await remediations.setSchedule(providerCtx, tenantScriptId, 'none');
        return { success: true, data: { tenantScriptId, schedule: 'none' } };
      } catch (error) {
        return failure('HARDENING_DISABLE_FAILED', error instanceof Error ? error.message : String(error));
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as HardeningTogglePayload;
      return {
        changes: [
          {
            objectType: 'tenant',
            objectId: ctx.tenantId,
            objectDisplayName: payload.tenantDisplayName,
            action: 'update',
            before: { hardeningCheck: 'taeglich auf allen Geraeten' },
            after: { hardeningCheck: 'aus', script: 'bleibt im Tenant, ohne Zuweisung' },
          },
        ],
        warnings: ['Die Zuweisung wird entfernt; die letzten Ergebnisse bleiben in Intune sichtbar, werden aber nicht mehr aktualisiert.'],
        estimatedDurationSeconds: 15,
      };
    }
  );
}
