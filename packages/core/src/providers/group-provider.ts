/**
 * Group-Provider (Teams, Microsoft 365-Gruppen, Sicherheits- und Verteilergruppen)
 *
 * Liest Gruppen mit Besitzern ueber Graph und zaehlt Mitglieder und Gaeste
 * je Gruppe ueber $batch, damit ein Tenant mit hunderten Gruppen nicht
 * hunderte Einzelaufrufe kostet. Directory.Read.All reicht fuer alles.
 */

import type {
  CapabilityResult,
  GroupDetail,
  GroupFlag,
  GroupInventorySet,
  GroupKind,
  GroupMember,
  GroupMemberType,
  GroupStats,
  GroupSummary,
  GroupVisibility,
} from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';
import { GraphApiError } from '../errors.js';

interface GraphGroupRow {
  id: string;
  displayName: string | null;
  description: string | null;
  groupTypes: string[] | null;
  mailEnabled: boolean | null;
  securityEnabled: boolean | null;
  visibility: string | null;
  resourceProvisioningOptions: string[] | null;
  createdDateTime: string | null;
  renewedDateTime: string | null;
  mail: string | null;
  membershipRule: string | null;
  onPremisesSyncEnabled: boolean | null;
  owners?: { id: string; displayName?: string | null; userPrincipalName?: string | null; '@odata.type'?: string }[];
}

interface GraphDirectoryObject {
  id: string;
  '@odata.type'?: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  userType?: string | null;
  accountEnabled?: boolean | null;
}

interface BatchResponse {
  responses: { id: string; status: number; body?: unknown }[];
}

const GROUP_SELECT = [
  'id',
  'displayName',
  'description',
  'groupTypes',
  'mailEnabled',
  'securityEnabled',
  'visibility',
  'resourceProvisioningOptions',
  'createdDateTime',
  'renewedDateTime',
  'mail',
  'membershipRule',
  'onPremisesSyncEnabled',
].join(',');

// Graph erlaubt 20 Anfragen je $batch; zwei je Gruppe (Mitglieder, Gaeste)
const BATCH_GROUPS = 10;
// Obergrenze fuer Zaehlungen je Sync, damit ein Riesen-Tenant den Worker nicht blockiert
export const COUNT_LIMIT = 1500;
const MEMBER_PAGE = 999;
const MEMBER_LIMIT = 2000;

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

function asUnavailable(error: unknown, permission: string): Unavailable | null {
  if (!(error instanceof GraphApiError)) return null;
  if (error.isAuthError) {
    return { available: false, reason: 'permission-missing', missingPermission: permission, detail: error.message };
  }
  return null;
}

export function classifyGroupKind(group: Pick<GraphGroupRow, 'groupTypes' | 'mailEnabled' | 'securityEnabled' | 'resourceProvisioningOptions'>): GroupKind {
  if (group.groupTypes?.includes('Unified')) {
    return group.resourceProvisioningOptions?.includes('Team') ? 'team' : 'microsoft365';
  }
  if (group.mailEnabled && group.securityEnabled) return 'mail-enabled-security';
  if (group.mailEnabled) return 'distribution';
  return 'security';
}

function toVisibility(value: string | null): GroupVisibility {
  return value === 'Public' || value === 'Private' || value === 'HiddenMembership' ? value : 'unknown';
}

/**
 * Auffaelligkeiten einer Gruppe; reine Ableitung, damit sie testbar bleibt.
 */
export function groupFlags(group: Omit<GroupSummary, 'flags'>): GroupFlag[] {
  const flags: GroupFlag[] = [];
  const needsOwner = group.kind === 'team' || group.kind === 'microsoft365';
  if (needsOwner && group.ownerCount === 0) flags.push('ownerless');
  else if (needsOwner && group.ownerCount === 1) flags.push('single-owner');
  if (group.kind === 'team' && group.visibility === 'Public') flags.push('public-team');
  if ((group.guestCount ?? 0) > 0) flags.push('has-guests');
  if (group.isDynamic) flags.push('dynamic');
  if (group.memberCount === 0) flags.push('empty');
  return flags;
}

export function groupStats(items: GroupSummary[]): GroupStats {
  return {
    total: items.length,
    teams: items.filter((g) => g.kind === 'team').length,
    microsoft365: items.filter((g) => g.kind === 'microsoft365').length,
    security: items.filter((g) => g.kind === 'security' || g.kind === 'mail-enabled-security').length,
    distribution: items.filter((g) => g.kind === 'distribution').length,
    ownerless: items.filter((g) => g.flags.includes('ownerless')).length,
    withGuests: items.filter((g) => g.flags.includes('has-guests')).length,
    publicTeams: items.filter((g) => g.flags.includes('public-team')).length,
    dynamic: items.filter((g) => g.flags.includes('dynamic')).length,
  };
}

function toMember(obj: GraphDirectoryObject): GroupMember {
  const odataType = obj['@odata.type'] ?? '';
  let type: GroupMemberType = 'other';
  if (odataType.endsWith('.user')) type = obj.userType === 'Guest' ? 'guest' : 'user';
  else if (odataType.endsWith('.group')) type = 'group';
  else if (odataType.endsWith('.servicePrincipal')) type = 'servicePrincipal';
  else if (odataType.endsWith('.device')) type = 'device';
  return {
    id: obj.id,
    displayName: obj.displayName ?? obj.userPrincipalName ?? obj.id,
    userPrincipalName: obj.userPrincipalName ?? null,
    type,
    accountEnabled: typeof obj.accountEnabled === 'boolean' ? obj.accountEnabled : null,
  };
}

function parseCount(body: unknown): number | null {
  if (typeof body === 'number') return body;
  if (typeof body === 'string' && /^\d+$/.test(body.trim())) return Number(body.trim());
  return null;
}

export class GroupProvider extends BaseResourceProvider {
  readonly name = 'groups';
  readonly requiredScopes = ['Directory.Read.All'];

  constructor(private readonly graphClient: GraphClient) {
    super();
  }

  async listGroups(ctx: ProviderContext): Promise<CapabilityResult<GroupInventorySet>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const rows: GraphGroupRow[] = [];
    let next: string | null = `/groups?$select=${GROUP_SELECT}&$expand=owners($select=id)&$top=999`;

    try {
      while (next) {
        const page: GraphResponse<GraphGroupRow[]> = await this.graphClient.get<GraphResponse<GraphGroupRow[]>>(tenantId, next, this.requiredScopes);
        rows.push(...page.value);
        next = page['@odata.nextLink'] ?? null;
      }
    } catch (error) {
      const unavailable = asUnavailable(error, 'Directory.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }

    const counts = await this.countMembers(tenantId, rows.slice(0, COUNT_LIMIT).map((r) => r.id));
    const items = rows
      .map((row) => {
        const count = counts.get(row.id) ?? { members: null, guests: null };
        const base: Omit<GroupSummary, 'flags'> = {
          id: row.id,
          displayName: row.displayName ?? row.id,
          description: row.description || null,
          kind: classifyGroupKind(row),
          visibility: toVisibility(row.visibility),
          mail: row.mail || null,
          createdAt: row.createdDateTime,
          renewedAt: row.renewedDateTime,
          isDynamic: !!row.membershipRule || (row.groupTypes?.includes('DynamicMembership') ?? false),
          onPremisesSynced: row.onPremisesSyncEnabled === true,
          ownerCount: row.owners?.length ?? 0,
          memberCount: count.members,
          guestCount: count.guests,
        };
        return { ...base, flags: groupFlags(base) };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));

    return { available: true, data: { items, stats: groupStats(items), countsTruncated: rows.length > COUNT_LIMIT } };
  }

  /**
   * Mitglieder- und Gastzahlen je Gruppe ueber $batch. Fehlt eine Antwort,
   * bleibt der Wert null statt die ganze Liste zu verwerfen.
   */
  private async countMembers(tenantId: string, groupIds: string[]): Promise<Map<string, { members: number | null; guests: number | null }>> {
    const result = new Map<string, { members: number | null; guests: number | null }>();
    for (let i = 0; i < groupIds.length; i += BATCH_GROUPS) {
      const chunk = groupIds.slice(i, i + BATCH_GROUPS);
      const requests = chunk.flatMap((id) => [
        { id: `m:${id}`, method: 'GET', url: `/groups/${id}/members/$count`, headers: { ConsistencyLevel: 'eventual' } },
        { id: `g:${id}`, method: 'GET', url: `/groups/${id}/members/microsoft.graph.user/$count?$filter=userType eq 'Guest'`, headers: { ConsistencyLevel: 'eventual' } },
      ]);
      let batch: BatchResponse;
      try {
        batch = await this.graphClient.post<BatchResponse>(tenantId, '/$batch', this.requiredScopes, { requests });
      } catch {
        for (const id of chunk) result.set(id, { members: null, guests: null });
        continue;
      }
      for (const id of chunk) {
        const members = batch.responses.find((r) => r.id === `m:${id}`);
        const guests = batch.responses.find((r) => r.id === `g:${id}`);
        result.set(id, {
          members: members && members.status < 300 ? parseCount(members.body) : null,
          guests: guests && guests.status < 300 ? parseCount(guests.body) : null,
        });
      }
    }
    return result;
  }

  async getGroupDetail(ctx: ProviderContext, groupId: string): Promise<CapabilityResult<GroupDetail> | null> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    let row: GraphGroupRow;
    try {
      row = await this.graphClient.get<GraphGroupRow>(
        tenantId,
        `/groups/${encodeURIComponent(groupId)}?$select=${GROUP_SELECT}&$expand=owners($select=id,displayName,userPrincipalName)`,
        this.requiredScopes
      );
    } catch (error) {
      if (error instanceof GraphApiError && error.statusCode === 404) return null;
      const unavailable = asUnavailable(error, 'Directory.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }

    const members: GraphDirectoryObject[] = [];
    let next: string | null = `/groups/${encodeURIComponent(groupId)}/members?$select=id,displayName,userPrincipalName,userType,accountEnabled&$top=${MEMBER_PAGE}`;
    let truncated = false;
    while (next && members.length < MEMBER_LIMIT) {
      const page: GraphResponse<GraphDirectoryObject[]> = await this.graphClient.get<GraphResponse<GraphDirectoryObject[]>>(tenantId, next, this.requiredScopes);
      members.push(...page.value);
      next = page['@odata.nextLink'] ?? null;
      if (next && members.length >= MEMBER_LIMIT) truncated = true;
    }

    const memberList = members.map(toMember).sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));
    const guestCount = memberList.filter((m) => m.type === 'guest').length;
    const base: Omit<GroupSummary, 'flags'> = {
      id: row.id,
      displayName: row.displayName ?? row.id,
      description: row.description || null,
      kind: classifyGroupKind(row),
      visibility: toVisibility(row.visibility),
      mail: row.mail || null,
      createdAt: row.createdDateTime,
      renewedAt: row.renewedDateTime,
      isDynamic: !!row.membershipRule || (row.groupTypes?.includes('DynamicMembership') ?? false),
      onPremisesSynced: row.onPremisesSyncEnabled === true,
      ownerCount: row.owners?.length ?? 0,
      memberCount: truncated ? null : memberList.length,
      guestCount: truncated ? null : guestCount,
    };

    return {
      available: true,
      data: {
        group: { ...base, flags: groupFlags(base) },
        owners: (row.owners ?? []).map((o) => toMember({ ...o, '@odata.type': o['@odata.type'] ?? '#microsoft.graph.user' })),
        members: memberList,
        membersTruncated: truncated,
      },
    };
  }
}
