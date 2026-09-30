/**
 * Tests fuer die Monitor-Regeln und die Zuweisungs-Jobs
 */

import { describe, it, expect, vi } from 'vitest';
import { evaluateMonitorStates, parseMonitorReport } from '../src/security/monitor-rules.js';
import { registerMonitorJobs, type MonitorScheduleOperations } from '../src/jobs/monitor-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import { DEFAULT_MSP_SETTINGS, normalizeMspSettings } from '../src/jobs/approval-policy.js';
import type { CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const settings = { ...DEFAULT_MSP_SETTINGS.alerts.monitor, enabled: true };
const now = new Date('2026-09-30T12:00:00Z');

function report(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 'zsc.monitor/1',
    uptimeHours: 12,
    pendingReboot: false,
    volumes: [{ drive: 'C:', freePercent: 40, freeGB: 100, sizeGB: 250 }],
    stoppedServices: [],
    systemErrors24h: 0,
    systemErrorSources: [],
    expiringCerts: [],
    defenderSignatureAgeDays: 1,
    defenderRealTime: true,
    ...patch,
  });
}

describe('monitor rules', () => {
  it('parses the report and ignores foreign schemas', () => {
    expect(parseMonitorReport(report())?.volumes[0].drive).toBe('C:');
    expect(parseMonitorReport(JSON.stringify({ schema: 'other' }))).toBeNull();
    expect(parseMonitorReport('not json')).toBeNull();
  });

  it('is quiet for a healthy device that reported recently', () => {
    const findings = evaluateMonitorStates('t1', [{ managedDeviceId: 'd1', deviceName: 'PC01', reportedAt: '2026-09-30T11:30:00Z', output: report() }], settings, now);
    expect(findings).toEqual([]);
  });

  it('flags a stale heartbeat and skips the other rules for that device', () => {
    const findings = evaluateMonitorStates('t1', [{ managedDeviceId: 'd1', deviceName: 'PC01', reportedAt: '2026-09-28T12:00:00Z', output: report({ systemErrors24h: 5 }) }], settings, now);
    expect(findings.map((f) => f.ruleId)).toEqual(['device-heartbeat']);
    expect(findings[0].summary).toContain('48 Stunden');
  });

  it('creates one finding per rule and object with severities', () => {
    const output = report({
      uptimeHours: 24 * 45,
      pendingReboot: true,
      volumes: [
        { drive: 'C:', freePercent: 3, freeGB: 7, sizeGB: 250 },
        { drive: 'D:', freePercent: 8, freeGB: 40, sizeGB: 500 },
      ],
      stoppedServices: ['Spooler'],
      systemErrors24h: 2,
      systemErrorSources: ['disk'],
      expiringCerts: [{ subject: 'CN=PC01', notAfter: '2026-10-10', thumbprint: 'ABCDEF12' }],
      defenderSignatureAgeDays: 9,
      defenderRealTime: true,
    });
    const findings = evaluateMonitorStates('t1', [{ managedDeviceId: 'd1', deviceName: 'PC01', reportedAt: '2026-09-30T11:30:00Z', output }], settings, now);
    const byRule = Object.fromEntries(findings.map((f) => [f.ruleId + ':' + (f.evidence.drive ?? ''), f.severity]));
    expect(byRule['disk-space:C:']).toBe('high');
    expect(byRule['disk-space:D:']).toBe('medium');
    expect(findings.filter((f) => f.ruleId === 'service-stopped')).toHaveLength(1);
    expect(findings.find((f) => f.ruleId === 'system-events')?.summary).toContain('disk');
    expect(findings.find((f) => f.ruleId === 'certificate-expiry')?.summary).toContain('2026-10-10');
    expect(findings.find((f) => f.ruleId === 'restart-due')?.summary).toContain('45 Tagen');
    expect(findings.find((f) => f.ruleId === 'defender-stale')?.severity).toBe('high');
    const fingerprints = new Set(findings.map((f) => f.fingerprint));
    expect(fingerprints.size).toBe(findings.length);
  });

  it('is off by default and normalises thresholds', () => {
    expect(evaluateMonitorStates('t1', [{ managedDeviceId: 'd1', deviceName: 'PC01', reportedAt: null, output: null }], DEFAULT_MSP_SETTINGS.alerts.monitor, now)).toEqual([]);
    const s = normalizeMspSettings({ alerts: { monitor: { enabled: true, heartbeatHours: 1, diskFreePercent: 99, uptimeDays: 0, defenderSignatureDays: 100 } } }).alerts.monitor;
    expect(s).toEqual({ enabled: true, heartbeatHours: 26, diskFreePercent: 10, uptimeDays: 30, defenderSignatureDays: 3 });
  });
});

describe('monitor jobs', () => {
  const base = { jobId: 'job-12345678' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0, payload: { tenantDisplayName: 'Contoso', reason: null } };

  it('ensures the script and assigns the hourly schedule, and removes it again', async () => {
    const ops: MonitorScheduleOperations = {
      ensureScript: vi.fn(async () => ({ tenantScriptId: 'ts-1', action: 'created' as const })),
      setHourlySchedule: vi.fn(async () => undefined),
      findTenantScriptId: vi.fn(async () => 'ts-1'),
    };
    registerMonitorJobs(ops);
    const enable = getRegisteredJob('tenant.monitor-enable')!;
    const preview = await enable.previewGenerator!(base);
    expect(preview.changes[0].after).toMatchObject({ monitor: 'stuendlich auf allen Geraeten' });
    const result = await enable.handler(base);
    expect(result.success).toBe(true);
    expect(ops.setHourlySchedule).toHaveBeenCalledWith(expect.anything(), 'ts-1', true);
    const disable = await getRegisteredJob('tenant.monitor-disable')!.handler(base);
    expect(disable.success).toBe(true);
    expect(ops.setHourlySchedule).toHaveBeenCalledWith(expect.anything(), 'ts-1', false);
  });
});
