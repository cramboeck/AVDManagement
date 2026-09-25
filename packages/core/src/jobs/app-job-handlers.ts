/**
 * Job-Handler fuer das Apps-Modul: Zuweisungen und Bereitstellungsgruppen
 *
 * /assign ersetzt in Intune die komplette Zuweisungsliste. Jeder Job liest
 * deshalb den Ist-Zustand, zeigt Vorher/Nachher in der Preview und schreibt
 * die zusammengefuehrte Liste. Bereitstellungsgruppen folgen dem Muster
 * "Install (Required) / Available / Uninstall" je App.
 */

import type { AppAssignment, AppAssignmentInput, AppAssignmentIntent } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { deploymentGroupNames, mergeAssignments } from '../providers/app-provider.js';
import type { ProviderContext } from '../providers/resource-provider.js';

export interface AppAssignmentOperations {
  getAssignments(ctx: ProviderContext, appId: string): Promise<AppAssignment[]>;
  replaceAssignments(ctx: ProviderContext, appId: string, assignments: AppAssignmentInput[]): Promise<void>;
  ensureSecurityGroup(ctx: ProviderContext, displayName: string, description: string): Promise<{ id: string; created: boolean }>;
}

export interface AssignAppPayload {
  appId: string;
  appName: string;
  intent: AppAssignmentIntent;
  targetType: AppAssignment['targetType'];
  groupId: string | null;
  groupName: string | null;
  // Aus dem Gruppen-Snapshot, fuer die Warnung bei grossen Gruppen
  groupMemberCount: number | null;
  filterId?: string | null;
  filterType?: 'include' | 'exclude' | null;
}

export interface UnassignAppPayload {
  appId: string;
  appName: string;
  assignmentId: string;
  groupName: string | null;
  intent: AppAssignmentIntent;
}

export interface CreateDeploymentGroupsPayload {
  appId: string;
  appName: string;
  prefix: string;
  autoAssign: boolean;
}

const LARGE_GROUP = 50;

function failure(code: string, error: unknown): JobResult {
  return { success: false, error: { code, message: error instanceof Error ? error.message : String(error), retryable: false } };
}

function describeTarget(a: { targetType: AppAssignment['targetType']; groupName?: string | null; groupId?: string | null }): string {
  if (a.targetType === 'allUsers') return 'Alle Benutzer';
  if (a.targetType === 'allDevices') return 'Alle Geraete';
  const name = a.groupName ?? a.groupId ?? 'Gruppe';
  return a.targetType === 'exclusionGroup' ? `Ausschluss ${name}` : name;
}

export function registerAppJobs(apps: AppAssignmentOperations): void {
  registerJob(
    {
      type: 'apps.assign',
      displayName: 'App zuweisen',
      maxRetries: 0,
      timeoutSeconds: 60,
      concurrencyPerTenant: 2,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as AssignAppPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const existing = await apps.getAssignments(providerCtx, payload.appId);
        const merged = mergeAssignments(existing, [
          { intent: payload.intent, targetType: payload.targetType, groupId: payload.groupId, filterId: payload.filterId ?? null, filterType: payload.filterType ?? null },
        ]);
        await apps.replaceAssignments(providerCtx, payload.appId, merged);
        return { success: true, data: { appId: payload.appId, assignments: merged.length, intent: payload.intent, target: describeTarget(payload) } };
      } catch (error) {
        return failure('APP_ASSIGN_FAILED', error);
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as AssignAppPayload;
      const existing = await apps.getAssignments({ tenantId: ctx.tenantId, correlationId: `preview-${ctx.tenantId}` }, payload.appId);
      const merged = mergeAssignments(existing, [{ intent: payload.intent, targetType: payload.targetType, groupId: payload.groupId }]);
      const replaced = existing.find((e) => e.targetType === payload.targetType && (e.groupId ?? null) === (payload.groupId ?? null));
      const warnings: string[] = [];
      if (payload.intent === 'required' && (payload.targetType === 'allDevices' || payload.targetType === 'allUsers')) {
        warnings.push('Erforderlich fuer alle Geraete oder Benutzer: die Installation startet ueberall beim naechsten Check-in.');
      } else if (payload.intent === 'required' && (payload.groupMemberCount ?? 0) >= LARGE_GROUP) {
        warnings.push(`Erforderlich fuer eine grosse Gruppe (${payload.groupMemberCount} Mitglieder): Rollout in Ringen erwaegen.`);
      }
      if (payload.intent === 'uninstall') warnings.push('Deinstallation: die App wird bei allen Mitgliedern entfernt.');
      if (replaced) warnings.push(`Bestehende Zuweisung fuer dieses Ziel (${replaced.intent}) wird ersetzt.`);
      return {
        changes: [
          {
            objectType: 'app',
            objectId: payload.appId,
            objectDisplayName: payload.appName,
            action: 'update',
            before: { assignments: existing.map((e) => `${e.intent}: ${describeTarget(e)}`) },
            after: { assignments: merged.map((m) => `${m.intent}: ${describeTarget({ ...m, groupName: m.groupId === payload.groupId ? payload.groupName : existing.find((e) => e.groupId === m.groupId)?.groupName })}`) },
          },
        ],
        warnings,
        estimatedDurationSeconds: 5,
      };
    }
  );

  registerJob(
    {
      type: 'apps.unassign',
      displayName: 'App-Zuweisung entfernen',
      maxRetries: 0,
      timeoutSeconds: 60,
      concurrencyPerTenant: 2,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as UnassignAppPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const existing = await apps.getAssignments(providerCtx, payload.appId);
        if (!existing.some((e) => e.id === payload.assignmentId)) {
          return { success: false, error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Die Zuweisung existiert nicht mehr', retryable: false } };
        }
        const merged = mergeAssignments(existing, [], [payload.assignmentId]);
        await apps.replaceAssignments(providerCtx, payload.appId, merged);
        return { success: true, data: { appId: payload.appId, assignments: merged.length, removed: payload.assignmentId } };
      } catch (error) {
        return failure('APP_UNASSIGN_FAILED', error);
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as UnassignAppPayload;
      const existing = await apps.getAssignments({ tenantId: ctx.tenantId, correlationId: `preview-${ctx.tenantId}` }, payload.appId);
      const remaining = existing.filter((e) => e.id !== payload.assignmentId);
      return {
        changes: [
          {
            objectType: 'app',
            objectId: payload.appId,
            objectDisplayName: payload.appName,
            action: 'update',
            before: { assignments: existing.map((e) => `${e.intent}: ${describeTarget(e)}`) },
            after: { assignments: remaining.map((e) => `${e.intent}: ${describeTarget(e)}`) },
          },
        ],
        warnings:
          payload.intent === 'required'
            ? ['Eine erforderliche Zuweisung zu entfernen deinstalliert nichts; die App bleibt auf den Geraeten.']
            : [],
        estimatedDurationSeconds: 5,
      };
    }
  );

  registerJob(
    {
      type: 'apps.create-deployment-groups',
      displayName: 'Bereitstellungsgruppen anlegen',
      maxRetries: 0,
      timeoutSeconds: 120,
      concurrencyPerTenant: 1,
      requiresPreview: true,
    },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as CreateDeploymentGroupsPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      const created: { intent: AppAssignmentIntent; name: string; id: string; created: boolean }[] = [];
      try {
        for (const g of deploymentGroupNames(payload.prefix, payload.appName)) {
          const result = await apps.ensureSecurityGroup(providerCtx, g.name, g.description);
          created.push({ intent: g.intent, name: g.name, id: result.id, created: result.created });
        }
        if (payload.autoAssign) {
          const existing = await apps.getAssignments(providerCtx, payload.appId);
          const merged = mergeAssignments(
            existing,
            created.map((g) => ({ intent: g.intent, targetType: 'group' as const, groupId: g.id }))
          );
          await apps.replaceAssignments(providerCtx, payload.appId, merged);
        }
        return { success: true, data: { appId: payload.appId, groups: created, assigned: payload.autoAssign } };
      } catch (error) {
        // Teilweise angelegte Gruppen bleiben stehen; der naechste Lauf findet sie ueber den Namen wieder
        return { success: false, error: { code: 'DEPLOYMENT_GROUPS_FAILED', message: `${error instanceof Error ? error.message : String(error)} (bereits angelegt: ${created.map((g) => g.name).join(', ') || 'keine'})`, retryable: false } };
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as CreateDeploymentGroupsPayload;
      const groups = deploymentGroupNames(payload.prefix, payload.appName);
      return {
        changes: groups.map((g) => ({
          objectType: 'group',
          objectId: g.name,
          objectDisplayName: g.name,
          action: 'create' as const,
          before: {},
          after: { securityEnabled: true, intent: g.intent, assign: payload.autoAssign },
        })),
        warnings: [
          'Bestehende Gruppen gleichen Namens werden wiederverwendet, nicht dupliziert.',
          payload.autoAssign ? 'Die drei Gruppen werden der App sofort mit ihrer Absicht zugewiesen; Mitglieder sind zunaechst keine.' : 'Ohne automatische Zuweisung entstehen nur die Gruppen.',
        ],
        estimatedDurationSeconds: 15,
      };
    }
  );
}
