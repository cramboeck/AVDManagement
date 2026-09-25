/**
 * Tests fuer die Gruppen-Jobs (Provider nachgebildet)
 */

import { describe, it, expect, vi } from 'vitest';
import { registerGroupJobs, type GroupMembershipOperations } from '../src/jobs/group-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { CorrelationId, GroupDetail, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const base = { jobId: 'j' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
const payload = { groupId: 'g1', groupName: 'Vertrieb', objectId: 'u1', objectDisplayName: 'Max', objectUpn: 'max@contoso.com' };

function detail(over: Partial<GroupDetail['group']> = {}): GroupDetail {
  return {
    group: { id: 'g1', displayName: 'Vertrieb', description: null, kind: 'team', visibility: 'Private', mail: null, createdAt: null, renewedAt: null, isDynamic: false, onPremisesSynced: false, ownerCount: 1, memberCount: 5, guestCount: 0, flags: [], ...over },
    owners: [],
    members: [],
    membersTruncated: false,
  };
}

function ops(over: Partial<GroupMembershipOperations> = {}, present = false, owners = 1): GroupMembershipOperations {
  return {
    getGroupDetail: vi.fn(async () => ({ available: true as const, data: detail() })),
    hasRelation: vi.fn(async () => present),
    addRelation: vi.fn(async () => undefined),
    removeRelation: vi.fn(async () => undefined),
    countOwners: vi.fn(async () => owners),
    ...over,
  };
}

describe('group jobs', () => {
  it('adds a member with a before/after preview and skips when already present', async () => {
    const o = ops();
    registerGroupJobs(o);
    const job = getRegisteredJob('group.add-member')!;
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes[0]).toMatchObject({ before: { members: 'ohne Max (max@contoso.com)' }, after: { members: 'mit Max (max@contoso.com)' } });
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(o.addRelation).toHaveBeenCalledWith(expect.anything(), 'g1', 'members', 'u1');

    const present = ops({}, true);
    registerGroupJobs(present);
    const again = await getRegisteredJob('group.add-member')!.handler({ ...base, payload });
    expect(again.data).toMatchObject({ changed: false });
    expect(present.addRelation).not.toHaveBeenCalled();
  });

  it('removes a member from a team with a warning and refuses dynamic groups', async () => {
    const o = ops({}, true);
    registerGroupJobs(o);
    const job = getRegisteredJob('group.remove-member')!;
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.warnings.some((w) => w.includes('Team'))).toBe(true);
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(o.removeRelation).toHaveBeenCalledWith(expect.anything(), 'g1', 'members', 'u1');

    registerGroupJobs(ops({ getGroupDetail: vi.fn(async () => ({ available: true as const, data: detail({ isDynamic: true }) })) }, true));
    const dyn = await getRegisteredJob('group.remove-member')!.handler({ ...base, payload });
    expect(dyn.error?.code).toBe('GROUP_DYNAMIC');
  });

  it('refuses to remove the last owner of a Microsoft 365 group', async () => {
    const o = ops({}, true, 1);
    registerGroupJobs(o);
    const result = await getRegisteredJob('group.remove-owner')!.handler({ ...base, payload });
    expect(result.error?.code).toBe('GROUP_LAST_OWNER');
    expect(o.removeRelation).not.toHaveBeenCalled();

    registerGroupJobs(ops({}, true, 2));
    const ok = await getRegisteredJob('group.remove-owner')!.handler({ ...base, payload });
    expect(ok.success).toBe(true);
  });
});
