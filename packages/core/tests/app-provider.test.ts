/**
 * Tests fuer AppProvider und App-Jobs (Graph gemockt)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppProvider, mergeAssignments, reportRows, deploymentGroupNames, toGraphAssignment, mapAssignment, APP_ERROR_HINTS } from '../src/providers/app-provider.js';
import { registerAppJobs, type AppAssignmentOperations } from '../src/jobs/app-job-handlers.js';
import { GRAPH_BETA } from '../src/providers/remediation-provider.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { AppAssignment, CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const ctx = { tenantId: 'tenant-1' as TenantId, correlationId: 'corr-1' };

const groupAssignment = (id: string, groupId: string, intent = 'required') => ({
  id,
  intent,
  target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId, deviceAndAppManagementAssignmentFilterId: null, deviceAndAppManagementAssignmentFilterType: 'none' },
});

describe('helpers', () => {
  it('maps assignments and builds graph payloads', () => {
    const a = mapAssignment({ id: 'x', intent: 'available', target: { '@odata.type': '#microsoft.graph.allLicensedUsersAssignmentTarget' } });
    expect(a).toMatchObject({ intent: 'available', targetType: 'allUsers', groupId: null });
    expect(toGraphAssignment({ intent: 'required', targetType: 'group', groupId: 'g1' })).toEqual({
      '@odata.type': '#microsoft.graph.mobileAppAssignment',
      intent: 'required',
      target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'g1', deviceAndAppManagementAssignmentFilterId: null, deviceAndAppManagementAssignmentFilterType: 'none' },
    });
  });

  it('merges by target: replaces the same group, keeps others, removes by id', () => {
    const existing: AppAssignment[] = [
      { id: 'a1', intent: 'available', targetType: 'group', groupId: 'g1', groupName: null, filterId: null, filterType: null },
      { id: 'a2', intent: 'required', targetType: 'group', groupId: 'g2', groupName: null, filterId: null, filterType: null },
    ];
    expect(mergeAssignments(existing, [{ intent: 'required', targetType: 'group', groupId: 'g1' }]).map((m) => [m.groupId, m.intent])).toEqual([
      ['g2', 'required'],
      ['g1', 'required'],
    ]);
    expect(mergeAssignments(existing, [], ['a2']).map((m) => m.groupId)).toEqual(['g1']);
  });

  it('turns report schema and values into rows', () => {
    const rows = reportRows({ Schema: [{ Column: 'ApplicationId', PropertyType: 'String' }, { Column: 'FailedDeviceCount', PropertyType: 'Int64' }], Values: [['app-1', 3]] });
    expect(rows).toEqual([{ ApplicationId: 'app-1', FailedDeviceCount: 3 }]);
  });

  it('names deployment groups with prefix and intent', () => {
    expect(deploymentGroupNames('SCI', 'Google Chrome').map((g) => g.name)).toEqual(['SCI Google Chrome - Install (Required)', 'SCI Google Chrome - Available', 'SCI Google Chrome - Uninstall']);
    expect(deploymentGroupNames('', 'X')[0].name).toBe('X - Install (Required)');
  });
});

describe('AppProvider', () => {
  let graph: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  let provider: AppProvider;

  beforeEach(() => {
    graph = { get: vi.fn(), post: vi.fn() };
    provider = new AppProvider(graph as unknown as GraphClient);
  });

  it('lists apps with assignments and install summaries from the report', async () => {
    graph.get.mockResolvedValue({
      value: [
        { id: 'app-1', '@odata.type': '#microsoft.graph.win32LobApp', displayName: 'Chrome', publisher: 'Google', displayVersion: '129', isAssigned: true, assignments: [groupAssignment('a1', 'g1')] },
        { id: 'app-2', '@odata.type': '#microsoft.graph.winGetApp', displayName: 'Acrobat', publisher: 'Adobe', isAssigned: false, assignments: [] },
      ],
    });
    graph.post.mockResolvedValue({
      Schema: [{ Column: 'ApplicationId' }, { Column: 'InstalledDeviceCount' }, { Column: 'FailedDeviceCount' }, { Column: 'PendingInstallDeviceCount' }, { Column: 'NotInstalledDeviceCount' }, { Column: 'NotApplicableDeviceCount' }, { Column: 'InstalledUserCount' }, { Column: 'FailedUserCount' }, { Column: 'PendingInstallUserCount' }],
      Values: [['app-1', 10, 2, 1, 0, 0, 0, 0, 0]],
    });

    const result = await provider.listApps(ctx);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.data.items.map((i) => i.displayName)).toEqual(['Acrobat', 'Chrome']);
    expect(result.data.items[1]).toMatchObject({ type: 'win32LobApp', version: '129', install: { installed: 10, failed: 2, pending: 1 }, assignments: [{ groupId: 'g1', intent: 'required' }] });
    expect(result.data.items[0].install).toEqual({ installed: 0, failed: 0, pending: 0, notInstalled: 0, notApplicable: 0 });
    expect(result.data.stats).toMatchObject({ total: 2, assigned: 1, withFailures: 1, win32: 1, winget: 1 });
    expect(graph.get.mock.calls[0][1]).toContain(`${GRAPH_BETA}/deviceAppManagement/mobileApps?$filter=`);
    expect(graph.post.mock.calls[0][1]).toBe(`${GRAPH_BETA}/deviceAppManagement/reports/getAppsInstallSummaryReport`);
  });

  it('keeps the list when the summary report fails and maps 403', async () => {
    graph.get.mockResolvedValue({ value: [{ id: 'app-1', '@odata.type': '#microsoft.graph.win32LobApp', displayName: 'Chrome', assignments: [] }] });
    graph.post.mockRejectedValue(new GraphApiError(404, 'NotFound', 'no report'));
    const result = await provider.listApps(ctx);
    if (!result.available) throw new Error('expected available');
    expect(result.data.summaryAvailable).toBe(false);
    expect(result.data.items[0].install).toBeNull();

    graph.get.mockRejectedValue(new GraphApiError(403, 'Forbidden', 'no'));
    expect(await provider.listApps(ctx)).toMatchObject({ available: false, reason: 'permission-missing', missingPermission: 'DeviceManagementApps.Read.All' });
  });

  it('reads device statuses with error hints, failures first', async () => {
    graph.post.mockResolvedValue({
      Schema: [{ Column: 'DeviceId' }, { Column: 'DeviceName' }, { Column: 'UserPrincipalName' }, { Column: 'AppInstallState' }, { Column: 'AppInstallStateDetails' }, { Column: 'HexErrorCode' }, { Column: 'ErrorCode' }, { Column: 'AppVersion' }, { Column: 'LastModifiedDateTime' }],
      Values: [
        ['d1', 'PC-1', 'max@contoso.com', 'installed', '', '', 0, '129', '2026-09-20T00:00:00Z'],
        ['d2', 'PC-2', 'eva@contoso.com', 'failed', 'DetectionRuleFailed', '0x87D1041C', -2016345060, '129', '2026-09-21T00:00:00Z'],
      ],
    });
    const result = await provider.getDeviceStatuses(ctx, 'app-1');
    if (!result.available) throw new Error('expected available');
    expect(result.data.map((s) => s.deviceName)).toEqual(['PC-2', 'PC-1']);
    expect(result.data[0]).toMatchObject({ installState: 'failed', errorCode: '0x87D1041C', errorHint: APP_ERROR_HINTS['0x87D1041C'] });
    expect(graph.post.mock.calls[0][3].filter).toBe("(ApplicationId eq 'app-1')");
  });

  it('reuses an existing security group instead of creating a duplicate', async () => {
    graph.get.mockResolvedValueOnce({ value: [{ id: 'g-existing' }] }).mockResolvedValueOnce({ value: [] });
    graph.post.mockResolvedValue({ id: 'g-new' });
    expect(await provider.ensureSecurityGroup(ctx, 'SCI X - Available', 'd')).toEqual({ id: 'g-existing', created: false });
    expect(await provider.ensureSecurityGroup(ctx, "SCI O'Neil - Uninstall", 'd')).toEqual({ id: 'g-new', created: true });
    expect(graph.get.mock.calls[1][1]).toContain("displayName eq 'SCI O''Neil - Uninstall'");
    expect(graph.post.mock.calls[0][3]).toMatchObject({ securityEnabled: true, mailEnabled: false, mailNickname: 'SCIONeilUninstall' });
  });
});

describe('app jobs', () => {
  const base = { jobId: 'j' as JobId, tenantId: 'tenant-1' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
  const existing: AppAssignment[] = [{ id: 'a1', intent: 'available', targetType: 'group', groupId: 'g1', groupName: 'Alle', filterId: null, filterType: null }];

  function fakeOps(): AppAssignmentOperations {
    return {
      getAssignments: vi.fn(async () => existing),
      replaceAssignments: vi.fn(async () => undefined),
      ensureSecurityGroup: vi.fn(async (_c, name: string) => ({ id: `id-${name.length}`, created: true })),
    };
  }

  it('assigns by merging and previews before/after with warnings', async () => {
    const ops = fakeOps();
    registerAppJobs(ops);
    const job = getRegisteredJob('apps.assign')!;
    const payload = { appId: 'app-1', appName: 'Chrome', intent: 'required', targetType: 'group', groupId: 'g2', groupName: 'Vertrieb', groupMemberCount: 120 };
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes[0].after?.assignments).toEqual(['available: Alle', 'required: Vertrieb']);
    expect(preview.warnings[0]).toContain('grosse Gruppe');

    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(ops.replaceAssignments).toHaveBeenCalledWith(expect.anything(), 'app-1', [
      { intent: 'available', targetType: 'group', groupId: 'g1', filterId: null, filterType: null },
      { intent: 'required', targetType: 'group', groupId: 'g2', filterId: null, filterType: null },
    ]);
  });

  it('refuses to unassign an assignment that no longer exists', async () => {
    registerAppJobs(fakeOps());
    const result = await getRegisteredJob('apps.unassign')!.handler({ ...base, payload: { appId: 'app-1', appName: 'Chrome', assignmentId: 'gone', groupName: null, intent: 'required' } });
    expect(result.error?.code).toBe('ASSIGNMENT_NOT_FOUND');
  });

  it('creates three deployment groups and assigns them when requested', async () => {
    const ops = fakeOps();
    registerAppJobs(ops);
    const job = getRegisteredJob('apps.create-deployment-groups')!;
    const payload = { appId: 'app-1', appName: 'Chrome', prefix: 'SCI', autoAssign: true };
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes.map((c) => c.objectDisplayName)).toEqual(['SCI Chrome - Install (Required)', 'SCI Chrome - Available', 'SCI Chrome - Uninstall']);

    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(ops.ensureSecurityGroup).toHaveBeenCalledTimes(3);
    const replaced = (ops.replaceAssignments as ReturnType<typeof vi.fn>).mock.calls[0][2] as { intent: string }[];
    expect(replaced.map((a) => a.intent)).toEqual(['available', 'required', 'available', 'uninstall']);
  });
});
