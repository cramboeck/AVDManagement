/**
 * Graph- und ARM-Client gegen gestubbtes fetch: Wiederholungsregeln,
 * Retry-After, Fehlerpfade (401/403/404/429/5xx) und lang laufende Vorgaenge.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GraphClient } from '../src/providers/graph-client.js';
import { ArmClient } from '../src/providers/arm-client.js';
import { backoffMs, isReadOnlyGraphPost, parseRetryAfter, shouldRetryStatus, MAX_RETRY_WAIT_MS } from '../src/providers/retry-policy.js';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function stubFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more stubbed responses');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

// Ohne echte Wartezeiten
function fastGraph() {
  const client = new GraphClient({ getAccessToken: async () => 'token' });
  (client as unknown as { delay: (ms: number) => Promise<void> }).delay = async () => undefined;
  return client;
}
function fastArm() {
  const client = new ArmClient({ getAccessToken: async () => 'token' });
  (client as unknown as { delay: (ms: number) => Promise<void> }).delay = async () => undefined;
  return client;
}

afterEach(() => vi.unstubAllGlobals());

describe('retry policy', () => {
  it('retries 429 always, 5xx only for idempotent calls', () => {
    expect(shouldRetryStatus(429, 'POST')).toBe(true);
    expect(shouldRetryStatus(503, 'GET')).toBe(true);
    expect(shouldRetryStatus(503, 'POST')).toBe(false);
    expect(shouldRetryStatus(503, 'POST', true)).toBe(true);
    expect(shouldRetryStatus(404, 'GET')).toBe(false);
  });

  it('caps Retry-After and adds bounded jitter', () => {
    expect(backoffMs(0, 600, () => 0)).toBe(MAX_RETRY_WAIT_MS);
    expect(backoffMs(0, 10, () => 1)).toBe(12000);
    expect(backoffMs(3, undefined, () => 0)).toBe(8000);
  });

  it('parses Retry-After as seconds or HTTP date', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThanOrEqual(4);
    expect(parseRetryAfter('soon')).toBeUndefined();
  });

  it('recognises read-only Graph POSTs', () => {
    expect(isReadOnlyGraphPost('https://graph.microsoft.com/beta/deviceManagement/reports/getConfigurationPolicyDeviceSummaryReport', {})).toBe(true);
    expect(isReadOnlyGraphPost('https://graph.microsoft.com/v1.0/$batch', { requests: [{ method: 'GET' }, { method: 'GET' }] })).toBe(true);
    expect(isReadOnlyGraphPost('https://graph.microsoft.com/v1.0/$batch', { requests: [{ method: 'GET' }, { method: 'PATCH' }] })).toBe(false);
    expect(isReadOnlyGraphPost('https://graph.microsoft.com/v1.0/groups', {})).toBe(false);
  });
});

describe('GraphClient', () => {
  it('waits for Retry-After on 429 and then succeeds', async () => {
    const fetchMock = stubFetch(json(429, { error: { code: 'TooManyRequests', message: 'slow down' } }, { 'Retry-After': '2' }), json(200, { value: [1] }));
    const client = fastGraph();
    const delay = vi.spyOn(client as unknown as { delay: (ms: number) => Promise<void> }, 'delay');
    expect(await client.get('t', '/users', [])).toEqual({ value: [1] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delay.mock.calls[0][0]).toBeGreaterThanOrEqual(2000);
  });

  it('does not repeat a POST after a timeout or 5xx (could already have been applied)', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    let fetchMock = stubFetch(abort, json(201, { id: 'dup' }));
    await expect(fastGraph().post('t', '/groups', [], { displayName: 'x' })).rejects.toThrow(/timeout/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock = stubFetch(json(503, { error: { code: 'ServiceUnavailable', message: 'busy' } }), json(201, { id: 'dup' }));
    await expect(fastGraph().post('t', '/groups', [], { displayName: 'x' })).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('repeats a read-only $batch after a timeout', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = stubFetch(abort, json(200, { responses: [] }));
    expect(await fastGraph().post('t', '/$batch', [], { requests: [{ id: '1', method: 'GET', url: '/users' }] })).toEqual({ responses: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces 401, 403 and 404 immediately without retry', async () => {
    for (const status of [401, 403, 404]) {
      const fetchMock = stubFetch(json(status, { error: { code: 'X', message: 'no' } }));
      await expect(fastGraph().get('t', '/users/x', [])).rejects.toMatchObject({ statusCode: status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('fetches the token again on each attempt', async () => {
    stubFetch(json(429, {}, { 'Retry-After': '1' }), json(200, {}));
    const getAccessToken = vi.fn(async () => 'token');
    const client = new GraphClient({ getAccessToken });
    (client as unknown as { delay: (ms: number) => Promise<void> }).delay = async () => undefined;
    await client.get('t', '/me', []);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });
});

describe('ArmClient', () => {
  it('returns the async operation url also on 200 (resize) and keeps the body', async () => {
    stubFetch(json(200, { name: 'vm1' }, { 'Azure-AsyncOperation': 'https://management.azure.com/op/1' }));
    expect(await fastArm().patch('t', '/subscriptions/s/vm', {})).toEqual({ name: 'vm1', asyncOperationUrl: 'https://management.azure.com/op/1' });
  });

  it('returns locationUrl for 202 with only a Location header and polls it until done', async () => {
    stubFetch(json(202, undefined, { Location: 'https://management.azure.com/loc/1' }));
    const client = fastArm();
    const started = await client.post<{ locationUrl?: string }>('t', '/subscriptions/s/deployments/d/validate', {});
    expect(started.locationUrl).toBe('https://management.azure.com/loc/1');

    stubFetch(json(202, undefined, { 'Retry-After': '1' }), json(200, { properties: { validatedResources: [{ id: 'r1' }] } }));
    expect(await client.waitForLocation('t', started.locationUrl!)).toEqual({ properties: { validatedResources: [{ id: 'r1' }] } });
  });

  it('surfaces a failed validation from the location poll as 400', async () => {
    stubFetch(json(400, { error: { code: 'InvalidTemplate', message: 'bad size' } }));
    await expect(fastArm().waitForLocation('t', 'https://management.azure.com/loc/2')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('treats an empty 200 body as no content instead of re-sending the POST', async () => {
    const fetchMock = stubFetch(new Response('', { status: 200 }));
    expect(await fastArm().post('t', '/subscriptions/s/vm/start', null)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not repeat Run Command after a timeout', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = stubFetch(abort, json(202, undefined));
    await expect(fastArm().post('t', '/subscriptions/s/vm/runCommand', { commandId: 'RunPowerShellScript' })).rejects.toThrow(/timeout/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows nextLink pages and retries a throttled GET', async () => {
    stubFetch(json(200, { value: [1], nextLink: 'https://management.azure.com/next' }), json(429, {}, { 'Retry-After': '1' }), json(200, { value: [2] }));
    expect(await fastArm().getAllPages('t', '/subscriptions')).toEqual([1, 2]);
  });
});
