/**
 * Tests fuer TokenProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const acquireTokenByClientCredential = vi.fn();

vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: vi.fn().mockImplementation(() => ({
    acquireTokenByClientCredential,
  })),
}));

import { TokenProvider, resolveResourceScope } from '../src/auth/token-provider.js';

describe('resolveResourceScope', () => {
  it('maps Graph permission names to the Graph .default scope', () => {
    expect(resolveResourceScope(['User.Read.All', 'Directory.Read.All'])).toBe(
      'https://graph.microsoft.com/.default'
    );
  });

  it('keeps a full resource URL and normalises it to .default', () => {
    expect(resolveResourceScope(['https://management.azure.com/.default'])).toBe(
      'https://management.azure.com/.default'
    );
    expect(resolveResourceScope(['https://graph.microsoft.com/User.Read.All'])).toBe(
      'https://graph.microsoft.com/.default'
    );
  });

  it('defaults to Graph when no scopes are given', () => {
    expect(resolveResourceScope([])).toBe('https://graph.microsoft.com/.default');
  });

  it('rejects scopes that span multiple resources', () => {
    expect(() =>
      resolveResourceScope(['User.Read.All', 'https://management.azure.com/.default'])
    ).toThrow(/multiple resources/);
  });
});

describe('TokenProvider', () => {
  const config = { clientId: 'client', clientSecret: 'secret', tenantId: 'partner' };
  let provider: TokenProvider;

  beforeEach(() => {
    acquireTokenByClientCredential.mockReset();
    acquireTokenByClientCredential.mockResolvedValue({
      accessToken: 'token-1',
      expiresOn: new Date(Date.now() + 3600_000),
    });
    provider = new TokenProvider(config);
  });

  it('requests a client-credential token with the resource .default scope only', async () => {
    const token = await provider.getAccessToken('tenant-a', ['User.Read.All', 'Directory.Read.All']);

    expect(token).toBe('token-1');
    expect(acquireTokenByClientCredential).toHaveBeenCalledTimes(1);
    expect(acquireTokenByClientCredential).toHaveBeenCalledWith({
      scopes: ['https://graph.microsoft.com/.default'],
    });
  });

  it('reuses a cached token for the same tenant and resource regardless of permission list', async () => {
    await provider.getAccessToken('tenant-a', ['User.Read.All']);
    await provider.getAccessToken('tenant-a', ['Directory.Read.All', 'Organization.Read.All']);

    expect(acquireTokenByClientCredential).toHaveBeenCalledTimes(1);
  });

  it('keeps tokens per tenant and per resource apart', async () => {
    await provider.getAccessToken('tenant-a', ['User.Read.All']);
    await provider.getAccessToken('tenant-b', ['User.Read.All']);
    await provider.getAccessToken('tenant-a', ['https://management.azure.com/.default']);

    expect(acquireTokenByClientCredential).toHaveBeenCalledTimes(3);
  });

  it('surfaces token acquisition failures', async () => {
    acquireTokenByClientCredential.mockRejectedValueOnce(
      new Error('invalid_client: AADSTS700016: Application not found in the directory')
    );

    await expect(provider.getAccessToken('tenant-c', ['User.Read.All'])).rejects.toThrow(
      /AADSTS700016/
    );
  });

  it('re-acquires after invalidateTokens', async () => {
    await provider.getAccessToken('tenant-a', ['User.Read.All']);
    provider.invalidateTokens('tenant-a');
    await provider.getAccessToken('tenant-a', ['User.Read.All']);

    expect(acquireTokenByClientCredential).toHaveBeenCalledTimes(2);
  });
});
