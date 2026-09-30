/**
 * Tests fuer die Neustart-Vorlagen und die Jobs device.restart-prompt/-cancel
 */

import { describe, it, expect, vi } from 'vitest';
import { renderRestartCancel, renderRestartPrompt, RESTART_TASK_NAME } from '../src/scripts/templates.js';
import { registerRestartJobs } from '../src/jobs/restart-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { RemediationOperations, RemediationRunState_ } from '../src/providers/remediation-provider.js';
import type { CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const base = { jobId: 'job-12345678' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
const payload = { managedDeviceId: 'md-1', deviceName: 'PC01', deadlineMinutes: 240, maxDeferrals: 2, deferMinutes: 60, message: "Bitte speichern Sie Ihre Arbeit; Neustart wegen Updates (Ticket 4711).", reason: 'Ticket 4711 Treiberupdate' };

function state(output: Record<string, unknown>): RemediationRunState_ {
  return { detectionState: 'success', remediationState: 'skipped', preOutput: JSON.stringify(output), postOutput: null, detectionError: null, remediationError: null, updatedAt: '2026-09-30T10:00:00Z', syncedAt: null, source: 'device' } as unknown as RemediationRunState_;
}

function ops(result: RemediationRunState_ | null): RemediationOperations {
  return { runTransient: vi.fn(async () => result) } as unknown as RemediationOperations;
}

describe('renderRestartPrompt', () => {
  it('embeds validated numbers and the message, rejects bad values', () => {
    const r = renderRestartPrompt({ deadlineMinutes: 240, maxDeferrals: 2, deferMinutes: 60, message: "It's time; Neustart (Ticket 4711)" });
    expect(r.content).toContain('$deadlineMinutes = 240');
    expect(r.content).toContain('$maxDeferrals = 2');
    expect(r.content).toContain('$deferMinutes = 60');
    expect(r.content).toContain("$message = 'It''s time; Neustart (Ticket 4711)'");
    expect(r.content).toContain(`$taskName = '${RESTART_TASK_NAME}'`);
    expect(r.content).not.toContain('__MESSAGE__');
    expect(() => renderRestartPrompt({ deadlineMinutes: 5, maxDeferrals: 2, deferMinutes: 60, message: 'Neustart bitte' })).toThrow(/Frist/);
    expect(() => renderRestartPrompt({ deadlineMinutes: 240, maxDeferrals: 9, deferMinutes: 60, message: 'Neustart bitte' })).toThrow(/Verschiebungen/);
    expect(() => renderRestartPrompt({ deadlineMinutes: 240, maxDeferrals: 2, deferMinutes: 5, message: 'Neustart bitte' })).toThrow(/Verschiebung/);
    expect(() => renderRestartPrompt({ deadlineMinutes: 240, maxDeferrals: 2, deferMinutes: 60, message: 'x' })).toThrow(/Text/);
    expect(() => renderRestartPrompt({ deadlineMinutes: 240, maxDeferrals: 2, deferMinutes: 60, message: 'Neustart $(Remove-Item C:\\)' })).toThrow(/Text/);
  });

  it('renders the cancel script with the fixed task name', () => {
    expect(renderRestartCancel().content).toContain(`$taskName = '${RESTART_TASK_NAME}'`);
  });
});

describe('device.restart-prompt and device.restart-cancel', () => {
  it('previews the plan and returns deadline and session info', async () => {
    registerRestartJobs(ops(state({ schema: 'zsc.restart-prompt/1', action: 'schedule', deadlineAt: '2026-09-30T14:00:00.000Z', userSessionPresent: true })));
    const job = getRegisteredJob('device.restart-prompt')!;
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes[0]).toMatchObject({ action: 'update', after: { deferrals: '2 x 60 Min' } });
    expect(preview.warnings.some((w) => w.includes('Countdown'))).toBe(true);
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ deadlineAt: '2026-09-30T14:00:00.000Z', userSessionPresent: true, deferrals: 2 });
  });

  it('reports script errors and offline devices', async () => {
    registerRestartJobs(ops(state({ schema: 'zsc.restart-prompt/1', action: 'schedule', error: 'Access denied' })));
    const failed = await getRegisteredJob('device.restart-prompt')!.handler({ ...base, payload });
    expect(failed.error?.code).toBe('RESTART_FAILED');
    registerRestartJobs(ops(null));
    const timeout = await getRegisteredJob('device.restart-cancel')!.handler({ ...base, payload: { managedDeviceId: 'md-1', deviceName: 'PC01', reason: 'Ticket 4711 storniert' } });
    expect(timeout.error?.code).toBe('RESTART_TIMEOUT');
  });

  it('cancels and reports what was removed', async () => {
    registerRestartJobs(ops(state({ schema: 'zsc.restart-prompt/1', action: 'cancel', hadRequest: true, tasksRemoved: 2 })));
    const result = await getRegisteredJob('device.restart-cancel')!.handler({ ...base, payload: { managedDeviceId: 'md-1', deviceName: 'PC01', reason: 'Ticket 4711 storniert' } });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ hadRequest: true, tasksRemoved: 2 });
  });
});
