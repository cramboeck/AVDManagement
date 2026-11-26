/**
 * Tests fuer die Betriebsart (Konsole und Tenant), Datenbank gemockt
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MspId, TenantId } from '@zerostress/types';

const rows = new Map<string, { accessMode: string }>();

vi.mock('../src/db/index.js', () => ({
  managedTenants: { id: 'id' },
  db: {
    query: {
      managedTenants: {
        // Die Bedingung ist ein drizzle-Ausdruck; der Mock liest die Id aus dem Aufruf von eq()
        findFirst: vi.fn(async (opts: { where: { value: string } }) => rows.get(opts.where.value)),
      },
    },
  },
}));
vi.mock('drizzle-orm', () => ({ eq: (_col: unknown, value: string) => ({ value }) }));

const { consoleMode, getWriteGuard, tenantAccessMode } = await import('../src/services/access-mode.js');

const definition = { type: 'identity.disable-user', displayName: 'Benutzer deaktivieren', maxRetries: 0, timeoutSeconds: 60, concurrencyPerTenant: 1, requiresPreview: true };
const input = (tenantId: string) => ({ type: definition.type, tenantId: tenantId as TenantId, mspId: 'm' as MspId });

describe('access mode', () => {
  afterEach(() => {
    delete process.env.CONSOLE_READ_ONLY;
    rows.clear();
  });

  it('reads the console switch from CONSOLE_READ_ONLY', () => {
    expect(consoleMode()).toEqual({ readOnly: false });
    process.env.CONSOLE_READ_ONLY = 'true';
    expect(consoleMode()).toEqual({ readOnly: true });
    process.env.CONSOLE_READ_ONLY = 'yes';
    expect(consoleMode()).toEqual({ readOnly: false });
  });

  it('treats an unknown tenant as read-only (fail closed)', async () => {
    expect(await tenantAccessMode('missing' as TenantId)).toBe('read-only');
  });

  it('blocks writes per tenant and leaves the other tenant writable', async () => {
    rows.set('tenant-a', { accessMode: 'read-only' });
    rows.set('tenant-b', { accessMode: 'full' });
    const guard = getWriteGuard();
    expect((await guard(input('tenant-a'), definition))?.scope).toBe('tenant');
    expect(await guard(input('tenant-b'), definition)).toBeNull();
  });

  it('blocks every tenant when the console is read-only', async () => {
    rows.set('tenant-b', { accessMode: 'full' });
    process.env.CONSOLE_READ_ONLY = 'true';
    expect((await getWriteGuard()(input('tenant-b'), definition))?.scope).toBe('console');
  });
});
