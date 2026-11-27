/**
 * Tests: Lizenz-Jobs warnen vor absehbaren Fehlern und entfernen nur direkte Zuweisungen
 */

import { describe, it, expect, vi } from 'vitest';
import { registerIdentityJobs } from '../src/jobs/job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { IdentityProvider } from '../src/providers/identity-provider.js';
import type { CorrelationId, JobId, LicenseSku, MspId, TenantId, UserId, UserLicense } from '@zerostress/types';

const base = { jobId: 'j' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
const payload = { userId: 'user-1', userDisplayName: 'Max', skuId: 'sku-bp', skuDisplayName: 'Microsoft 365 Business Premium' };

function provider(over: { licenses?: UserLicense[]; usageLocation?: string | null; skus?: LicenseSku[] } = {}) {
  return {
    getUserLicenses: vi.fn(async () => over.licenses ?? []),
    getUsageLocation: vi.fn(async () => (over.usageLocation === undefined ? 'DE' : over.usageLocation)),
    getAvailableSkus: vi.fn(async () => over.skus ?? [{ skuId: 'sku-bp', skuPartNumber: 'SPB', displayName: 'Microsoft 365 Business Premium', totalUnits: 10, consumedUnits: 4, availableUnits: 6 }]),
    assignLicense: vi.fn(async () => undefined),
    removeLicense: vi.fn(async () => undefined),
  };
}

const direct: UserLicense = { skuId: 'sku-bp', skuPartNumber: 'SPB', displayName: 'Microsoft 365 Business Premium', assignedDirectly: true, inheritedFromGroupIds: [] };
const inherited: UserLicense = { ...direct, assignedDirectly: false, inheritedFromGroupIds: ['grp-1'] };

describe('identity.assign-license preview', () => {
  it('warns when the user has no usage location', async () => {
    registerIdentityJobs(provider({ usageLocation: null }) as unknown as IdentityProvider);
    const preview = await getRegisteredJob('identity.assign-license')!.previewGenerator!({ ...base, payload });
    expect(preview.warnings.some((w) => w.includes('Nutzungsort'))).toBe(true);
  });

  it('warns when no licenses are free', async () => {
    registerIdentityJobs(provider({ skus: [{ skuId: 'sku-bp', skuPartNumber: 'SPB', displayName: 'BP', totalUnits: 5, consumedUnits: 5, availableUnits: 0 }] }) as unknown as IdentityProvider);
    const preview = await getRegisteredJob('identity.assign-license')!.previewGenerator!({ ...base, payload });
    expect(preview.warnings.some((w) => w.includes('Keine freie Lizenz'))).toBe(true);
  });
});

describe('identity.remove-license', () => {
  it('removes a direct assignment', async () => {
    const p = provider({ licenses: [direct] });
    registerIdentityJobs(p as unknown as IdentityProvider);
    const result = await getRegisteredJob('identity.remove-license')!.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(p.removeLicense).toHaveBeenCalledWith(expect.anything(), 'user-1', 'sku-bp');
  });

  it('refuses a group-inherited license before calling Graph and says why in the preview', async () => {
    const p = provider({ licenses: [inherited] });
    registerIdentityJobs(p as unknown as IdentityProvider);
    const job = getRegisteredJob('identity.remove-license')!;
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.warnings.some((w) => w.includes('ueber eine Gruppe'))).toBe(true);
    const result = await job.handler({ ...base, payload });
    expect(result.error?.code).toBe('LICENSE_INHERITED');
    expect(p.removeLicense).not.toHaveBeenCalled();
  });

  it('changes nothing when the license is already gone', async () => {
    const p = provider({ licenses: [] });
    registerIdentityJobs(p as unknown as IdentityProvider);
    const result = await getRegisteredJob('identity.remove-license')!.handler({ ...base, payload });
    expect(result).toMatchObject({ success: true, data: { changed: false } });
    expect(p.removeLicense).not.toHaveBeenCalled();
  });
});
