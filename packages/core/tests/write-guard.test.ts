/**
 * Tests fuer die Nur-Lese-Entscheidung (ohne Queue)
 */

import { describe, it, expect, vi } from 'vitest';
import { createWriteGuard, readOnlyDecision } from '../src/jobs/write-guard.js';
import { getAllRegisteredJobs, type JobDefinition } from '../src/jobs/job-types.js';
import { registerTempAdminJobs, registerRestartJobs, registerMonitorJobs, registerHardeningJobs, registerExchangeJobs, registerDeviceJobs } from '../src/jobs/index.js';
import type { MspId, TenantId } from '@zerostress/types';

const write: JobDefinition = { type: 'identity.disable-user', displayName: 'Benutzer deaktivieren', maxRetries: 0, timeoutSeconds: 60, concurrencyPerTenant: 1, requiresPreview: true };
const undo: JobDefinition = { ...write, type: 'device.temp-admin-revoke', displayName: 'Admin entziehen', allowedInReadOnly: true };
const input = { type: write.type, tenantId: 't-1' as TenantId, mspId: 'm-1' as MspId };

describe('readOnlyDecision', () => {
  it('lets writes through in full mode', () => {
    expect(readOnlyDecision(write, { consoleReadOnly: false, tenantMode: 'full' })).toBeNull();
  });

  it('blocks writes for a read-only tenant and names the job', () => {
    expect(readOnlyDecision(write, { consoleReadOnly: false, tenantMode: 'read-only' })).toMatchObject({ scope: 'tenant', reason: expect.stringContaining('Benutzer deaktivieren') });
  });

  it('reports the console as scope when the whole console is read-only', () => {
    expect(readOnlyDecision(write, { consoleReadOnly: true, tenantMode: 'read-only' })?.scope).toBe('console');
  });

  it('always allows jobs that only undo earlier console changes', () => {
    expect(readOnlyDecision(undo, { consoleReadOnly: true, tenantMode: 'read-only' })).toBeNull();
  });
});

describe('createWriteGuard', () => {
  it('skips the tenant lookup when the console switch is on', async () => {
    const lookup = vi.fn(async () => 'full' as const);
    const guard = createWriteGuard(() => true, lookup);
    expect((await guard(input, write))?.scope).toBe('console');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('asks for the mode of exactly the tenant of the job', async () => {
    const lookup = vi.fn(async (id: TenantId) => (id === 't-1' ? ('read-only' as const) : ('full' as const)));
    const guard = createWriteGuard(() => false, lookup);
    expect((await guard(input, write))?.scope).toBe('tenant');
    expect(await guard({ ...input, tenantId: 't-2' as TenantId }, write)).toBeNull();
    expect(lookup).toHaveBeenCalledWith('t-1');
  });

  it('propagates lookup failures instead of silently allowing the write', async () => {
    const guard = createWriteGuard(() => false, async () => {
      throw new Error('database unavailable');
    });
    await expect(guard(input, write)).rejects.toThrow('database unavailable');
  });
});

describe('allowed job types', () => {
  it('exempts only reading and undoing jobs', () => {
    const noop = vi.fn();
    const ops = new Proxy({}, { get: () => noop });
    registerTempAdminJobs(ops as never);
    registerRestartJobs(ops as never);
    registerMonitorJobs(ops as never);
    registerHardeningJobs(ops as never);
    registerExchangeJobs(ops as never);
    registerDeviceJobs(ops as never);
    const allowed = getAllRegisteredJobs()
      .filter((j) => j.definition.allowedInReadOnly)
      .map((j) => j.definition.type)
      .sort();
    expect(allowed).toEqual(['device.restart-cancel', 'device.temp-admin-revoke', 'exchange.collect-facts', 'tenant.hardening-disable', 'tenant.monitor-disable']);
  });
});
