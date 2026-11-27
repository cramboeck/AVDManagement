/**
 * Job-Handler fuer Gruppen: Mitglieder und Besitzer hinzufuegen und entfernen
 *
 * Jede Aenderung ist ein Job mit Preview (Ist-Zustand wird live gelesen),
 * Freigabe durch Engineer und Audit. Dynamische Gruppen werden abgelehnt,
 * die letzte Besitzerin einer M365-Gruppe wird nicht entfernt.
 */

import type { CapabilityResult, GroupDetail, GroupSummary } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import { jobFailure } from './job-types.js';
import type { ProviderContext } from '../providers/resource-provider.js';

export interface GroupMembershipOperations {
  getGroupDetail(ctx: ProviderContext, groupId: string): Promise<CapabilityResult<GroupDetail> | null>;
  hasRelation(ctx: ProviderContext, groupId: string, relation: 'members' | 'owners', objectId: string): Promise<boolean>;
  addRelation(ctx: ProviderContext, groupId: string, relation: 'members' | 'owners', objectId: string): Promise<void>;
  removeRelation(ctx: ProviderContext, groupId: string, relation: 'members' | 'owners', objectId: string): Promise<void>;
  countOwners(ctx: ProviderContext, groupId: string): Promise<number>;
}

export interface GroupMembershipPayload {
  groupId: string;
  groupName: string;
  objectId: string;
  objectDisplayName: string;
  objectUpn: string | null;
}

type Relation = 'members' | 'owners';
type Verb = 'add' | 'remove';

const relationLabel: Record<Relation, string> = { members: 'Mitglied', owners: 'Besitzer' };

function failure(code: string, error: unknown): JobResult {
  return jobFailure(code, error);
}

async function loadGroup(ops: GroupMembershipOperations, ctx: ProviderContext, groupId: string): Promise<GroupSummary> {
  const detail = await ops.getGroupDetail(ctx, groupId);
  if (!detail) throw new Error('Gruppe nicht gefunden');
  if (!detail.available) throw new Error(`Gruppe nicht lesbar: ${detail.detail ?? detail.reason}`);
  return detail.data.group;
}

/**
 * Gruende, aus denen Graph eine Aenderung ablehnt. Verteilerlisten und
 * E-Mail-aktivierte Sicherheitsgruppen verwaltet Exchange; synchronisierte
 * Gruppen das lokale AD.
 */
export function membershipBlockReason(group: Pick<GroupSummary, 'kind' | 'isDynamic' | 'onPremisesSynced'>, relation: Relation): string | null {
  if (group.onPremisesSynced) return 'Die Gruppe wird aus dem lokalen Active Directory synchronisiert; Aenderungen dort vornehmen.';
  if (group.kind === 'distribution' || group.kind === 'mail-enabled-security') {
    return 'Verteilerlisten und E-Mail-aktivierte Sicherheitsgruppen verwaltet Exchange Online; Graph lehnt die Aenderung ab. Im Exchange Admin Center oder per Exchange-Worker aendern.';
  }
  if (group.isDynamic && relation === 'members') return 'Mitglieder dynamischer Gruppen kommen aus der Regel und koennen nicht manuell geaendert werden';
  return null;
}

function define(ops: GroupMembershipOperations, relation: Relation, verb: Verb) {
  const type = `group.${verb}-${relation === 'members' ? 'member' : 'owner'}`;
  const displayName = `${relationLabel[relation]} ${verb === 'add' ? 'hinzufuegen' : 'entfernen'}`;

  registerJob(
    { type, displayName, maxRetries: 0, timeoutSeconds: 60, concurrencyPerTenant: 3, requiresPreview: true },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as GroupMembershipPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const group = await loadGroup(ops, providerCtx, payload.groupId);
        const blocked = membershipBlockReason(group, relation);
        if (blocked) return failure('GROUP_NOT_EDITABLE', blocked);
        const present = await ops.hasRelation(providerCtx, payload.groupId, relation, payload.objectId);
        if (verb === 'add' && present) {
          return { success: true, data: { groupId: payload.groupId, objectId: payload.objectId, relation, changed: false, note: 'bereits vorhanden' } };
        }
        if (verb === 'remove' && !present) {
          return { success: true, data: { groupId: payload.groupId, objectId: payload.objectId, relation, changed: false, note: 'war nicht vorhanden' } };
        }
        if (verb === 'remove' && relation === 'owners' && (group.kind === 'team' || group.kind === 'microsoft365')) {
          const owners = await ops.countOwners(providerCtx, payload.groupId);
          if (owners <= 1) return failure('GROUP_LAST_OWNER', 'Der letzte Besitzer einer Microsoft 365-Gruppe kann nicht entfernt werden; zuerst einen weiteren Besitzer hinzufuegen');
        }
        if (verb === 'add') await ops.addRelation(providerCtx, payload.groupId, relation, payload.objectId);
        else await ops.removeRelation(providerCtx, payload.groupId, relation, payload.objectId);
        return { success: true, data: { groupId: payload.groupId, objectId: payload.objectId, relation, changed: true } };
      } catch (error) {
        return failure('GROUP_MEMBERSHIP_FAILED', error);
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as GroupMembershipPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: `preview-${ctx.tenantId}` };
      const group = await loadGroup(ops, providerCtx, payload.groupId);
      const present = await ops.hasRelation(providerCtx, payload.groupId, relation, payload.objectId);
      const warnings: string[] = [];
      const blocked = membershipBlockReason(group, relation);
      if (blocked) warnings.push(`Der Job wird abgelehnt: ${blocked}`);
      if (verb === 'add' && present) warnings.push(`${payload.objectDisplayName} ist bereits ${relationLabel[relation]}; es aendert sich nichts.`);
      if (verb === 'remove' && !present) warnings.push(`${payload.objectDisplayName} ist kein ${relationLabel[relation]}; es aendert sich nichts.`);
      if (verb === 'remove' && relation === 'owners' && group.ownerCount <= 1 && (group.kind === 'team' || group.kind === 'microsoft365')) warnings.push('Das ist der letzte Besitzer; Microsoft 365-Gruppen brauchen mindestens einen. Der Job wird abgelehnt.');
      if (verb === 'remove' && relation === 'members' && group.kind === 'team') warnings.push('Aus einem Team entfernt: verliert Zugriff auf Kanaele, Dateien und Chats des Teams.');
      if (verb === 'add' && relation === 'members' && group.kind === 'security') warnings.push('Sicherheitsgruppe: Mitgliedschaft kann Zugriff auf Ressourcen, Apps und Richtlinien gewaehren.');
      const label = payload.objectUpn ? `${payload.objectDisplayName} (${payload.objectUpn})` : payload.objectDisplayName;
      return {
        changes: [
          {
            objectType: 'group',
            objectId: payload.groupId,
            objectDisplayName: group.displayName,
            action: 'update',
            before: { [relation]: present ? `mit ${label}` : `ohne ${label}` },
            after: { [relation]: verb === 'add' ? `mit ${label}` : `ohne ${label}` },
          },
        ],
        warnings,
        estimatedDurationSeconds: 5,
      };
    }
  );
}

export function registerGroupJobs(ops: GroupMembershipOperations): void {
  define(ops, 'members', 'add');
  define(ops, 'members', 'remove');
  define(ops, 'owners', 'add');
  define(ops, 'owners', 'remove');
}
