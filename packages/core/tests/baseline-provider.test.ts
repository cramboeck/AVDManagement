/**
 * Tests fuer BaselineProvider (Intune-Baselines, Compliance) und die neuen
 * Haertungs-Checks (Baselines, Geraetecode-Fluss, Anmeldehaeufigkeit,
 * Tenant-Erstellung, SharePoint-Freigabe, externe Weiterleitung).
 * Die Graph-Antworten entsprechen den dokumentierten Formen der Endpunkte.
 */

import { describe, it, expect, vi } from 'vitest';
import { BaselineProvider, classifyBaseline, compliancePlatform, statusFromReportRow } from '../src/providers/baseline-provider.js';
import { evaluateBaselineChecks, evaluateChecks } from '../src/security/checks.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import type { ConditionalAccessPolicy, TenantPolicySnapshot } from '../src/providers/policy-provider.js';
import type { BaselineOverview, TenantId } from '@zerostress/types';

const ctx = { tenantId: 'tenant-1' as TenantId, correlationId: 'corr-1' };
const NOW = new Date('2026-11-25T08:00:00Z');

// Aufgezeichnete Formen der Graph-Antworten (gekuerzt, Werte anonymisiert)
const fixtures = {
  configurationPolicies: {
    value: [
      { id: 'cp-win', name: 'Windows Baseline 24H2', isAssigned: true, lastModifiedDateTime: '2026-10-01T10:00:00Z', templateReference: { templateId: 'tpl-win', templateFamily: 'baseline', templateDisplayName: 'Security Baseline for Windows 10 and later', templateDisplayVersion: 'Version 24H2' } },
      { id: 'cp-edge', name: 'Edge Baseline', isAssigned: false, lastModifiedDateTime: null, templateReference: { templateId: 'tpl-edge', templateFamily: 'baseline', templateDisplayName: 'Security Baseline for Microsoft Edge', templateDisplayVersion: 'Version 128' } },
    ],
  },
  catalogReport: {
    Schema: [
      { Column: 'PolicyId', PropertyType: 'String' },
      { Column: 'NumberOfCompliantDevices', PropertyType: 'Int32' },
      { Column: 'NumberOfNonCompliantDevices', PropertyType: 'Int32' },
      { Column: 'NumberOfErrorDevices', PropertyType: 'Int32' },
      { Column: 'NumberOfConflictDevices', PropertyType: 'Int32' },
      { Column: 'NumberOfNotApplicableDevices', PropertyType: 'Int32' },
      { Column: 'NumberOfInProgressDevices', PropertyType: 'Int32' },
    ],
    Values: [['cp-win', 18, 2, 1, 1, 0, 3]],
  },
  templates: { value: [{ id: 'tmpl-mde', displayName: 'Microsoft Defender for Endpoint baseline', versionInfo: 'Version 6', templateType: 'securityBaseline' }] },
  intents: {
    value: [
      { id: 'int-mde', displayName: 'MDE Baseline', templateId: 'TMPL-MDE', isAssigned: true, lastModifiedDateTime: '2026-09-01T10:00:00Z' },
      { id: 'int-other', displayName: 'Endpoint protection profile', templateId: 'tmpl-unrelated', isAssigned: true },
    ],
  },
  intentSummary: { conflictCount: 0, errorCount: 0, failedCount: 1, notApplicableCount: 2, notApplicablePlatformCount: 1, successCount: 20 },
  compliancePolicies: {
    value: [
      { '@odata.type': '#microsoft.graph.windows10CompliancePolicy', id: 'cmp-win', displayName: 'Windows Compliance', lastModifiedDateTime: '2026-08-01T10:00:00Z', assignments: [{ id: 'a1' }] },
      { '@odata.type': '#microsoft.graph.iosCompliancePolicy', id: 'cmp-ios', displayName: 'iOS Compliance', assignments: [] },
    ],
  },
  complianceOverview: { pendingCount: 1, notApplicableCount: 0, notApplicablePlatformCount: 0, successCount: 40, errorCount: 0, failedCount: 5, conflictCount: 0 },
};

function graph(over: { get?: (path: string) => unknown; post?: (path: string) => unknown } = {}): GraphClient {
  const get = vi.fn(async (_t: string, path: string) => {
    const custom = over.get?.(path);
    if (custom !== undefined) return custom;
    if (path.includes('/configurationPolicies')) return fixtures.configurationPolicies;
    if (path.includes('/deviceManagement/templates')) return fixtures.templates;
    if (path.includes('/deviceStateSummary')) return fixtures.intentSummary;
    if (path.includes('/deviceManagement/intents')) return fixtures.intents;
    if (path.includes('/deviceStatusOverview')) return fixtures.complianceOverview;
    if (path.includes('/deviceCompliancePolicies')) return fixtures.compliancePolicies;
    throw new Error(`unexpected get ${path}`);
  });
  const post = vi.fn(async (_t: string, path: string) => {
    const custom = over.post?.(path);
    if (custom !== undefined) return custom;
    if (path.includes('getConfigurationPolicyDeviceSummaryReport')) return fixtures.catalogReport;
    throw new Error(`unexpected post ${path}`);
  });
  return { get, post } as unknown as GraphClient;
}

describe('helpers', () => {
  it('classifies baselines and compliance platforms', () => {
    expect(classifyBaseline('Security Baseline for Windows 10 and later', 'x')).toBe('windows');
    expect(classifyBaseline('Microsoft Defender for Endpoint baseline', 'x')).toBe('defender');
    expect(classifyBaseline('Security Baseline for Microsoft Edge', 'x')).toBe('edge');
    expect(classifyBaseline('Microsoft 365 Apps for Enterprise Security Baseline', 'x')).toBe('m365-apps');
    expect(classifyBaseline('Windows 365 Security Baseline', 'x')).toBe('windows365');
    expect(compliancePlatform('#microsoft.graph.windows10CompliancePolicy')).toBe('windows');
    expect(compliancePlatform('#microsoft.graph.androidWorkProfileCompliancePolicy')).toBe('android');
    expect(compliancePlatform('#microsoft.graph.macOSCompliancePolicy')).toBe('macos');
  });

  it('maps report columns by name and returns null for unknown formats', () => {
    expect(statusFromReportRow({ PolicyId: 'x', NumberOfCompliantDevices: 3, NumberOfNonCompliantDevices: 1, NumberOfErrorDevices: 2 })).toEqual({ success: 3, failed: 1, error: 2, conflict: 0, notApplicable: 0, pending: 0 });
    expect(statusFromReportRow({ PolicyId: 'x', Something: 1 })).toBeNull();
    expect(statusFromReportRow(undefined)).toBeNull();
  });
});

describe('BaselineProvider.getOverview', () => {
  it('collects catalog and template baselines with status and compliance policies', async () => {
    const result = await new BaselineProvider(graph()).getOverview(ctx, NOW);
    expect(result.available).toBe(true);
    if (!result.available) return;
    const { baselines, compliance, collectedAt } = result.data;
    expect(collectedAt).toBe(NOW.toISOString());
    expect(baselines.map((b) => [b.kind, b.source, b.assigned])).toEqual([
      ['defender', 'template', true],
      ['edge', 'settings-catalog', false],
      ['windows', 'settings-catalog', true],
    ]);
    expect(baselines.find((b) => b.id === 'cp-win')?.status).toEqual({ success: 18, failed: 2, error: 1, conflict: 1, notApplicable: 0, pending: 3 });
    expect(baselines.find((b) => b.id === 'int-mde')?.status).toEqual({ success: 20, failed: 1, error: 0, conflict: 0, notApplicable: 3, pending: 0 });
    expect(compliance).toEqual([
      expect.objectContaining({ id: 'cmp-win', platform: 'windows', assigned: true, status: { success: 40, failed: 5, error: 0, conflict: 0, notApplicable: 0, pending: 1 } }),
      expect.objectContaining({ id: 'cmp-ios', platform: 'ios', assigned: false }),
    ]);
  });

  it('keeps a policy when its status report fails', async () => {
    const result = await new BaselineProvider(graph({ post: () => { throw new GraphApiError(500, 'InternalServerError', 'report failed'); } })).getOverview(ctx, NOW);
    expect(result.available && result.data.baselines.find((b) => b.id === 'cp-win')?.status).toBeNull();
  });

  it('reports a missing permission on 403', async () => {
    const result = await new BaselineProvider(graph({ get: () => { throw new GraphApiError(403, 'Authorization_RequestDenied', 'Forbidden'); } })).getOverview(ctx, NOW);
    expect(result).toMatchObject({ available: false, reason: 'permission-missing', missingPermission: 'DeviceManagementConfiguration.Read.All' });
  });

  it('reports not licensed on 404 and passes on throttling', async () => {
    const notLicensed = await new BaselineProvider(graph({ get: () => { throw new GraphApiError(404, 'ResourceNotFound', 'Not found'); } })).getOverview(ctx, NOW);
    expect(notLicensed).toMatchObject({ available: false, reason: 'not-licensed' });
    await expect(new BaselineProvider(graph({ get: () => { throw new GraphApiError(429, 'TooManyRequests', 'Too many requests', 10); } })).getOverview(ctx, NOW)).rejects.toBeInstanceOf(GraphApiError);
  });
});

describe('baseline checks', () => {
  it('rates baselines, deviations and compliance', async () => {
    const overview = (await new BaselineProvider(graph()).getOverview(ctx, NOW)) as BaselineOverview;
    const checks = evaluateBaselineChecks(overview);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({
      'baseline-windows': 'pass',
      'baseline-defender': 'pass',
      'baseline-edge': 'warn',
      'baseline-m365-apps': 'warn',
      'baseline-deviations': 'fail',
      'compliance-windows': 'pass',
      'compliance-rate': 'fail',
    });
  });

  it('fails without a Windows baseline and marks unknown when the source is not readable', () => {
    const empty: BaselineOverview = { available: true, data: { baselines: [], compliance: [], collectedAt: NOW.toISOString() } };
    const byId = Object.fromEntries(evaluateBaselineChecks(empty).map((c) => [c.id, c.status]));
    expect(byId['baseline-windows']).toBe('fail');
    expect(byId['compliance-windows']).toBe('fail');
    const unavailable = evaluateBaselineChecks({ available: false, reason: 'permission-missing', missingPermission: 'DeviceManagementConfiguration.Read.All' });
    expect(unavailable[0]).toMatchObject({ id: 'baseline-windows', status: 'unknown' });
  });
});

describe('additional hardening checks', () => {
  const adminFrequency: ConditionalAccessPolicy = {
    id: 'a',
    displayName: 'Admins sign-in frequency',
    state: 'enabled',
    conditions: { users: { includeRoles: ['62e90394-69f5-4237-9190-012177145e10'] }, applications: { includeApplications: ['All'] } },
    grantControls: { builtInControls: ['mfa'] },
    sessionControls: { signInFrequency: { isEnabled: true, value: 8, type: 'hours' } },
  };
  const blockDeviceCode: ConditionalAccessPolicy = {
    id: 'b',
    displayName: 'Block device code flow',
    state: 'enabled',
    conditions: { users: { includeUsers: ['All'] }, applications: { includeApplications: ['All'] }, authenticationFlows: { transferMethods: 'deviceCodeFlow' } },
    grantControls: { builtInControls: ['block'] },
  };
  function snapshot(ca: ConditionalAccessPolicy[], sharing: string, createTenants: boolean): TenantPolicySnapshot {
    return {
      conditionalAccess: { available: true, data: ca },
      securityDefaultsEnabled: { available: true, data: false },
      authenticationMethods: { available: true, data: { methods: {}, numberMatching: true } },
      authorization: { available: true, data: { allowedToCreateApps: false, allowedToCreateSecurityGroups: false, allowedToCreateTenants: createTenants, allowInvitesFrom: null, guestUserRoleId: null, userConsentAllowed: false, allowEmailVerifiedUsersToJoinOrganization: null } },
      globalAdminCount: { available: true, data: 2 },
      domains: { available: true, data: [] },
      compliancePolicyCount: { available: true, data: 1 },
      sharePointSharing: { available: true, data: sharing },
    };
  }

  it('passes a hardened tenant', () => {
    const checks = evaluateChecks({ policies: snapshot([adminFrequency, blockDeviceCode], 'externalUserSharingOnly', false), mailAuth: null, adminsWithoutMfa: 0, exchangeAutoForwarding: 'Off' });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({ 'admin-signin-frequency': 'pass', 'device-code-flow': 'pass', 'tenant-creation': 'pass', 'sharepoint-sharing': 'pass', 'external-forwarding': 'pass' });
  });

  it('flags open settings and unknown sources', () => {
    const checks = evaluateChecks({
      policies: { ...snapshot([], 'externalUserAndGuestSharing', true), sharePointSharing: { available: false, reason: 'permission-missing', missingPermission: 'SharePointTenantSettings.Read.All' } },
      mailAuth: null,
      adminsWithoutMfa: 0,
      exchangeAutoForwarding: 'On',
    });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({ 'admin-signin-frequency': 'warn', 'device-code-flow': 'warn', 'tenant-creation': 'warn', 'sharepoint-sharing': 'unknown', 'external-forwarding': 'fail' });
    const anonymous = evaluateChecks({ policies: snapshot([], 'externalUserAndGuestSharing', false), mailAuth: null, adminsWithoutMfa: 0, exchangeAutoForwarding: null });
    expect(anonymous.find((c) => c.id === 'sharepoint-sharing')?.status).toBe('warn');
    expect(anonymous.find((c) => c.id === 'external-forwarding')?.status).toBe('unknown');
  });
});
