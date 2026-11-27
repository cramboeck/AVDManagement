/**
 * Tests: absolute URLs bekommen nur auf vertrauenswuerdigen Hosts ein Token
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveRequestUrl, DEFENDER_ORIGINS, ForeignUrlError } from '../src/providers/request-url.js';
import { GraphClient } from '../src/providers/graph-client.js';
import { ArmClient } from '../src/providers/arm-client.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

describe('resolveRequestUrl', () => {
  it('prefixes relative paths with the base url', () => {
    expect(resolveRequestUrl(GRAPH, '/users?$top=5')).toBe('https://graph.microsoft.com/v1.0/users?$top=5');
  });

  it('accepts nextLinks on the same host, including beta', () => {
    expect(resolveRequestUrl(GRAPH, 'https://graph.microsoft.com/beta/users?$skiptoken=abc')).toContain('/beta/users');
  });

  it('rejects other hosts, look-alike hosts and embedded credentials', () => {
    expect(() => resolveRequestUrl(GRAPH, 'https://evil.example/x')).toThrow(ForeignUrlError);
    expect(() => resolveRequestUrl(GRAPH, 'https://graph.microsoft.com.evil.example/x')).toThrow(ForeignUrlError);
    expect(() => resolveRequestUrl(GRAPH, 'http://graph.microsoft.com/v1.0/users')).toThrow(ForeignUrlError);
    expect(() => resolveRequestUrl(GRAPH, 'https://user:pw@graph.microsoft.com/v1.0/users')).toThrow(ForeignUrlError);
  });

  it('allows regional Defender hosts only when configured', () => {
    const base = 'https://api.securitycenter.microsoft.com';
    expect(resolveRequestUrl(base, 'https://api-eu.securitycenter.microsoft.com/api/machines?$skip=1', DEFENDER_ORIGINS)).toContain('api-eu');
    expect(() => resolveRequestUrl(base, 'https://api-eu.securitycenter.microsoft.com/api/machines')).toThrow(ForeignUrlError);
    expect(() => resolveRequestUrl(base, 'https://api-eu.securitycenter.microsoft.com.evil.example/', DEFENDER_ORIGINS)).toThrow(ForeignUrlError);
  });
});

describe('clients never send a token to a foreign url', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GraphClient refuses before acquiring a token or calling fetch', async () => {
    const getAccessToken = vi.fn(async () => 'secret-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new GraphClient({ getAccessToken });
    await expect(client.get('tenant-1', 'https://evil.example/steal', ['User.Read.All'])).rejects.toBeInstanceOf(ForeignUrlError);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ArmClient refuses a foreign async-operation url', async () => {
    const getAccessToken = vi.fn(async () => 'secret-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new ArmClient({ getAccessToken });
    await expect(client.get('tenant-1', 'https://evil.example/op')).rejects.toBeInstanceOf(ForeignUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
