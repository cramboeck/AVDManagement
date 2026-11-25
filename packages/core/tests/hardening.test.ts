/**
 * Tests fuer die Geraete-Haertung: Katalog gegen Skript, Auswertung,
 * Best-Practice-Check und Zuweisungs-Jobs
 */

import { describe, it, expect, vi } from 'vitest';
import { HARDENING_CONTROLS, parseHardeningReport, summarizeHardening } from '../src/security/hardening.js';
import { evaluateChecks } from '../src/security/checks.js';
import { getLibraryScript } from '../src/scripts/library.js';
import { registerHardeningJobs, type HardeningScheduleOperations } from '../src/jobs/hardening-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { TenantPolicySnapshot } from '../src/providers/policy-provider.js';
import type { CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const NOW = new Date('2026-11-25T12:00:00Z');

function report(failed: string[] | string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema: 'zsc.hardening/1', collectedAt: '2026-11-25T11:00:00Z', osBuild: '26100', passed: 20, failed, notApplicable: ['rdp-nla'], unreadable: [], ...extra });
}

describe('catalog and script', () => {
  it('uses exactly the control ids the script checks', () => {
    const script = getLibraryScript('hardening')!;
    const scriptIds = Array.from(script.detectionScript.matchAll(/Test-Control '([a-z0-9-]+)'/g)).map((m) => m[1]).sort();
    expect(scriptIds).toEqual(HARDENING_CONTROLS.map((c) => c.id).sort());
    expect(new Set(scriptIds).size).toBe(scriptIds.length);
  });
});

describe('parseHardeningReport', () => {
  it('reads lists and the single-element string form of PowerShell 5.1', () => {
    expect(parseHardeningReport(report(['smb1-disabled', 'llmnr-disabled']))?.failed).toEqual(['smb1-disabled', 'llmnr-disabled']);
    expect(parseHardeningReport(report('smb1-disabled'))?.failed).toEqual(['smb1-disabled']);
    expect(parseHardeningReport(JSON.stringify({ schema: 'zsc.monitor/1' }))).toBeNull();
    expect(parseHardeningReport('Access denied')).toBeNull();
  });
});

describe('summarizeHardening', () => {
  it('counts per control and scores devices, worst first', () => {
    const summary = summarizeHardening(
      [
        { managedDeviceId: 'd1', deviceName: 'PC01', reportedAt: '2026-11-25T11:00:00Z', output: report([]) },
        { managedDeviceId: 'd2', deviceName: 'PC02', reportedAt: '2026-11-25T11:00:00Z', output: report(['bitlocker-os', 'firewall-all-profiles', 'smb1-disabled']) },
        { managedDeviceId: 'd3', deviceName: 'PC03', reportedAt: '2026-11-20T11:00:00Z', output: report(['smb1-disabled']) },
        { managedDeviceId: 'd4', deviceName: 'PC04', reportedAt: null, output: null },
      ],
      NOW
    );
    expect(summary.devicesReporting).toBe(3);
    expect(summary.staleDevices).toBe(1);
    expect(summary.controls[0]).toMatchObject({ id: 'smb1-disabled', failing: 2, passing: 1 });
    expect(summary.controls.find((c) => c.id === 'rdp-nla')).toMatchObject({ notApplicable: 3, failing: 0 });
    expect(summary.devices.map((d) => d.deviceName)).toEqual(['PC02', 'PC03', 'PC01']);
    expect(summary.devices[2].scorePercent).toBe(100);
    expect(summary.devices[0].scorePercent).toBeLessThan(summary.devices[1].scorePercent);
    expect(summary.scorePercent).toBeGreaterThan(0);
  });

  it('returns no score without reports', () => {
    expect(summarizeHardening([], NOW)).toMatchObject({ devicesReporting: 0, scorePercent: null });
  });
});

describe('device-hardening check', () => {
  const policies: TenantPolicySnapshot = {
    conditionalAccess: { available: false, reason: 'permission-missing', missingPermission: 'Policy.Read.All' },
    securityDefaultsEnabled: { available: false, reason: 'permission-missing', missingPermission: 'Policy.Read.All' },
    authenticationMethods: { available: false, reason: 'permission-missing', missingPermission: 'Policy.Read.All' },
    authorization: { available: false, reason: 'permission-missing', missingPermission: 'Policy.Read.All' },
    globalAdminCount: { available: false, reason: 'permission-missing', missingPermission: 'Directory.Read.All' },
    domains: { available: false, reason: 'permission-missing', missingPermission: 'Directory.Read.All' },
    compliancePolicyCount: { available: false, reason: 'permission-missing', missingPermission: 'DeviceManagementConfiguration.Read.All' },
    sharePointSharing: { available: false, reason: 'permission-missing', missingPermission: 'SharePointTenantSettings.Read.All' },
  };
  const status = (hardening: Parameters<typeof evaluateChecks>[0]['hardening']) => evaluateChecks({ policies, mailAuth: null, adminsWithoutMfa: null, hardening }).find((c) => c.id === 'device-hardening');

  it('rates by average score and names the most frequent gaps', () => {
    const good = summarizeHardening([{ managedDeviceId: 'd1', deviceName: 'PC01', reportedAt: '2026-11-25T11:00:00Z', output: report([]) }], NOW);
    expect(status(good)?.status).toBe('pass');
    const bad = summarizeHardening([{ managedDeviceId: 'd1', deviceName: 'PC01', reportedAt: '2026-11-25T11:00:00Z', output: report(HARDENING_CONTROLS.slice(0, 12).map((c) => c.id)) }], NOW);
    const c = status(bad);
    expect(c?.status).toBe('fail');
    expect(c?.summary).toContain('Am haeufigsten offen');
  });

  it('is unknown when not enabled and absent when not requested', () => {
    expect(status(null)?.status).toBe('unknown');
    expect(status(undefined)).toBeUndefined();
  });
});

describe('hardening jobs', () => {
  const base = { jobId: 'job-12345678' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0, payload: { tenantDisplayName: 'Contoso', reason: null } };

  it('assigns the script daily and removes the assignment again', async () => {
    const ops: HardeningScheduleOperations = {
      ensureScript: vi.fn(async () => ({ tenantScriptId: 'ts-h', action: 'created' as const })),
      setSchedule: vi.fn(async () => undefined),
      findTenantScriptId: vi.fn(async () => 'ts-h'),
    };
    registerHardeningJobs(ops);
    const preview = await getRegisteredJob('tenant.hardening-enable')!.previewGenerator!(base);
    expect(preview.changes[0].after).toMatchObject({ controls: HARDENING_CONTROLS.length });
    expect((await getRegisteredJob('tenant.hardening-enable')!.handler(base)).success).toBe(true);
    expect(ops.setSchedule).toHaveBeenCalledWith(expect.anything(), 'ts-h', 'daily');
    expect((await getRegisteredJob('tenant.hardening-disable')!.handler(base)).success).toBe(true);
    expect(ops.setSchedule).toHaveBeenCalledWith(expect.anything(), 'ts-h', 'none');
  });

  it('reports Graph failures as job errors', async () => {
    registerHardeningJobs({
      ensureScript: vi.fn(async () => { throw new Error('403 Forbidden'); }),
      setSchedule: vi.fn(async () => undefined),
      findTenantScriptId: vi.fn(async () => null),
    });
    const result = await getRegisteredJob('tenant.hardening-enable')!.handler(base);
    expect(result.error?.code).toBe('HARDENING_ENABLE_FAILED');
  });
});
