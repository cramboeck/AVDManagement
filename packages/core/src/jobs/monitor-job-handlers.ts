/**
 * Jobs "Geraete-Monitor": das Bibliotheksskript monitor im Tenant anlegen
 * und stuendlich allen Geraeten zuweisen, oder die Zuweisung entfernen.
 *
 * Die Zuweisung ist der einzige Bibliotheksfall mit Zeitplan: Intune fuehrt
 * das Skript stuendlich aus, die Konsole liest die Zustaende und macht
 * daraus Alerts (monitor-rules). Das Skript liest nur.
 */

import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { getLibraryScript } from '../scripts/library.js';
import type { ProviderContext } from '../providers/resource-provider.js';
import type { EnsureScriptResult } from '../providers/remediation-provider.js';

export interface MonitorScheduleOperations {
  ensureScript(ctx: ProviderContext, script: NonNullable<ReturnType<typeof getLibraryScript>>): Promise<EnsureScriptResult>;
  setHourlySchedule(ctx: ProviderContext, tenantScriptId: string, enabled: boolean): Promise<void>;
  findTenantScriptId(ctx: ProviderContext, scriptId: string): Promise<string | null>;
}

export interface MonitorTogglePayload {
  tenantDisplayName: string;
  reason: string | null;
}

function failure(code: string, message: string): JobResult {
  return { success: false, error: { code, message, retryable: false } };
}

export function registerMonitorJobs(remediations: MonitorScheduleOperations): void {
  registerJob(
    {
      type: 'tenant.monitor-enable',
      displayName: 'Geraete-Monitor einschalten',
      maxRetries: 0,
      timeoutSeconds: 300,
      concurrencyPerTenant: 1,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const script = getLibraryScript('monitor');
      if (!script) return failure('MONITOR_SCRIPT_MISSING', 'Bibliotheksskript monitor fehlt');
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const ensured = await remediations.ensureScript(providerCtx, script);
        await remediations.setHourlySchedule(providerCtx, ensured.tenantScriptId, true);
        return { success: true, data: { tenantScriptId: ensured.tenantScriptId, scriptAction: ensured.action, schedule: 'hourly', target: 'all-devices' } };
      } catch (error) {
        return failure('MONITOR_ENABLE_FAILED', error instanceof Error ? error.message : String(error));
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as MonitorTogglePayload;
      return {
        changes: [
          {
            objectType: 'tenant',
            objectId: ctx.tenantId,
            objectDisplayName: payload.tenantDisplayName,
            action: 'update',
            before: { monitor: 'aus' },
            after: { monitor: 'stuendlich auf allen Geraeten', script: 'ZSC-monitor (nur lesend)' },
          },
        ],
        warnings: [
          'Intune legt das Remediation-Objekt ZSC-monitor an und weist es allen Geraeten mit stuendlichem Zeitplan zu. Das Skript liest Laufzeit, Neustartbedarf, Speicher, Dienste, Fehlerereignisse, Zertifikate und Defender-Stand; es aendert nichts.',
          'Die Konsole wertet die Zustaende im Alert-Takt aus und meldet nach den Schwellen unter Einstellungen > Betriebs-Alerts (Geraete-Monitor). Geraete ohne Meldung seit N Stunden gelten als ohne Lebenszeichen.',
          'Braucht die Windows-Lizenzbestaetigung fuer Remediations im Tenant (Business Premium, E3/E5).',
        ],
        estimatedDurationSeconds: 30,
      };
    }
  );

  registerJob(
    {
      type: 'tenant.monitor-disable',
      displayName: 'Geraete-Monitor ausschalten',
      maxRetries: 0,
      timeoutSeconds: 300,
      concurrencyPerTenant: 1,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const tenantScriptId = await remediations.findTenantScriptId(providerCtx, 'monitor');
        if (!tenantScriptId) return { success: true, data: { schedule: 'none', note: 'Skript war nicht im Tenant' } };
        await remediations.setHourlySchedule(providerCtx, tenantScriptId, false);
        return { success: true, data: { tenantScriptId, schedule: 'none' } };
      } catch (error) {
        return failure('MONITOR_DISABLE_FAILED', error instanceof Error ? error.message : String(error));
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as MonitorTogglePayload;
      return {
        changes: [
          {
            objectType: 'tenant',
            objectId: ctx.tenantId,
            objectDisplayName: payload.tenantDisplayName,
            action: 'update',
            before: { monitor: 'stuendlich auf allen Geraeten' },
            after: { monitor: 'aus', script: 'bleibt im Tenant, ohne Zuweisung' },
          },
        ],
        warnings: ['Die Zuweisung wird entfernt; das Skriptobjekt bleibt fuer Laeufe auf Abruf erhalten. Offene Monitor-Alerts bleiben bestehen, neue entstehen nicht mehr.'],
        estimatedDurationSeconds: 15,
      };
    }
  );
}
