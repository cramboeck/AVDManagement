/**
 * Tests: Passwort-Reset erzeugt starke Passwoerter und legt sie nur versiegelt ab
 */

import { describe, it, expect, vi } from 'vitest';
import { IdentityProvider } from '../src/providers/identity-provider.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { GraphApiError } from '../src/errors.js';
import { createResetPasswordHandler } from '../src/jobs/job-handlers.js';
import type { CorrelationId, JobId, MspId, SealedCipher, TenantId, UserId } from '@zerostress/types';

// Echte Paging- und Batch-Logik ueber die gemockten get/post
function withClientHelpers<T extends object>(mock: T): T {
  return Object.assign(mock, {
    getAllPages(this: unknown, ...args: Parameters<GraphClient['getAllPages']>) {
      return GraphClient.prototype.getAllPages.apply(this as GraphClient, args);
    },
    batch(this: unknown, ...args: Parameters<GraphClient['batch']>) {
      return GraphClient.prototype.batch.apply(this as GraphClient, args);
    },
    delay: async () => undefined,
  });
}

const ctx = { jobId: 'job-1' as JobId, tenantId: 'tenant-1' as TenantId, mspId: 'msp-1' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0, payload: { userId: 'user-1', userPrincipalName: 'x', displayName: 'x' } };

function setup() {
  const graph = { patch: vi.fn(async () => undefined), get: vi.fn(), post: vi.fn() };
  const provider = new IdentityProvider(withClientHelpers(graph) as unknown as GraphClient);
  return { graph, provider };
}

describe('IdentityProvider.resetPassword', () => {
  it('sets a 16 character password with all character classes and forces a change', async () => {
    const { graph, provider } = setup();
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { temporaryPassword } = await provider.resetPassword({ tenantId: 'tenant-1' as TenantId, correlationId: 'c' }, 'user-1');
      expect(temporaryPassword).toHaveLength(16);
      expect(temporaryPassword).toMatch(/[A-Z]/);
      expect(temporaryPassword).toMatch(/[a-z]/);
      expect(temporaryPassword).toMatch(/[2-9]/);
      expect(temporaryPassword).toMatch(/[!@#$%&*]/);
      seen.add(temporaryPassword);
    }
    expect(seen.size).toBe(50);
    expect(graph.patch).toHaveBeenCalledWith('tenant-1', '/users/user-1', expect.any(Array), expect.objectContaining({ passwordProfile: expect.objectContaining({ forceChangePasswordNextSignIn: true }) }));
  });

  it('propagates 403 from Graph (missing user administrator role)', async () => {
    const { graph, provider } = setup();
    graph.patch.mockRejectedValue(new GraphApiError(403, 'Authorization_RequestDenied', 'Insufficient privileges'));
    await expect(provider.resetPassword({ tenantId: 'tenant-1' as TenantId, correlationId: 'c' }, 'user-1')).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('reset password job', () => {
  it('refuses without a sealer and leaves the account untouched', async () => {
    const { graph, provider } = setup();
    const result = await createResetPasswordHandler(provider)(ctx);
    expect(result).toMatchObject({ success: false, error: { code: 'RESULT_ENCRYPTION_MISSING' } });
    expect(graph.patch).not.toHaveBeenCalled();
  });

  it('stores the password only inside the sealed cipher', async () => {
    const { provider } = setup();
    const cipher: SealedCipher = { v: 1, kid: 'k', iv: 'iv', tag: 'tag', data: 'data' } as unknown as SealedCipher;
    const seal = vi.fn(async () => cipher);
    const result = await createResetPasswordHandler(provider, { sealer: { seal } })(ctx);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ sealed: true, cipher, scriptId: 'password-reset' });
    expect(JSON.stringify(result.data)).not.toMatch(/temporaryPassword/);
    const sealedPayload = (seal.mock.calls[0] as unknown as [{ outputJson: { temporaryPassword: string } }])[0];
    expect(sealedPayload.outputJson.temporaryPassword).toHaveLength(16);
  });

  it('reports a Graph failure without sealing anything', async () => {
    const { graph, provider } = setup();
    graph.patch.mockRejectedValue(new GraphApiError(404, 'Request_ResourceNotFound', 'User not found'));
    const seal = vi.fn();
    const result = await createResetPasswordHandler(provider, { sealer: { seal } })(ctx);
    expect(result).toMatchObject({ success: false, error: { code: 'PASSWORD_RESET_FAILED' } });
    expect(seal).not.toHaveBeenCalled();
  });
});
