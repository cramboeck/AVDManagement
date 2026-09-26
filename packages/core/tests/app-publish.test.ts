/**
 * Tests fuer die Upload-Pipeline und den Job apps.publish
 */

import { describe, it, expect, vi } from 'vitest';
import { publishWin32App } from '../src/providers/app-provider.js';
import { GRAPH_BETA } from '../src/providers/remediation-provider.js';
import { registerAppPublishJobs, type PublishOperations } from '../src/jobs/app-publish-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import { normalizeManifest } from '../src/apps/manifest.js';
import { GraphClient } from '../src/providers/graph-client.js';
import type { AppPackage, CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const ctx = { tenantId: 't' as TenantId, correlationId: 'c' };
const opened = {
  metadata: {
    fileName: 'IntunePackage.intunewin',
    setupFile: 'setup.msi',
    unencryptedContentSize: 1000,
    encryptionInfo: { encryptionKey: 'k', macKey: 'm', initializationVector: 'iv', mac: 'mac', profileIdentifier: 'ProfileVersion1', fileDigest: 'd', fileDigestAlgorithm: 'SHA256' },
  },
  payload: Buffer.alloc(13 * 1024 * 1024, 1),
};

describe('publishWin32App', () => {
  it('runs the nine steps in order and uploads three blocks', async () => {
    let fileState = 0;
    const graph = {
      post: vi.fn(async (_t: string, path: string) => {
        if (path.endsWith('/mobileApps')) return { id: 'app-1' };
        if (path.endsWith('/contentVersions')) return { id: '1' };
        if (path.endsWith('/files')) return { id: 'f1', uploadState: 'azureStorageUriRequestPending', azureStorageUri: null };
        if (path.endsWith('/commit')) return undefined;
        throw new Error(`unexpected post ${path}`);
      }),
      get: vi.fn(async () => {
        fileState += 1;
        if (fileState === 1) return { id: 'f1', uploadState: 'azureStorageUriRequestSuccess', azureStorageUri: 'https://blob.example/x?sv=1' };
        if (fileState === 2) return { id: 'f1', uploadState: 'commitFilePending', azureStorageUri: null };
        return { id: 'f1', uploadState: 'commitFileSuccess', azureStorageUri: null };
      }),
      patch: vi.fn(async () => undefined),
    };
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201 })) as unknown as typeof fetch;
    const steps: string[] = [];

    const result = await publishWin32App(graph as unknown as GraphClient, ['DeviceManagementApps.ReadWrite.All'], ctx, { displayName: 'X' }, opened, (s) => steps.push(s), { sleep: async () => undefined, fetchImpl });

    expect(result).toEqual({ appId: 'app-1', contentVersion: '1' });
    expect(graph.post.mock.calls[0][1]).toBe(`${GRAPH_BETA}/deviceAppManagement/mobileApps`);
    expect(graph.post.mock.calls[2][3]).toMatchObject({ '@odata.type': '#microsoft.graph.mobileAppContentFile', size: 1000, sizeEncrypted: opened.payload.length });
    const blockCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c: unknown[]) => String(c[0]).includes('comp=block&'));
    expect(blockCalls).toHaveLength(3);
    expect(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0])).toContain('comp=blocklist');
    const commit = graph.post.mock.calls.find((c) => String(c[1]).endsWith('/commit'))!;
    expect(commit[3]).toEqual({ fileEncryptionInfo: expect.objectContaining({ encryptionKey: 'k', profileIdentifier: 'ProfileVersion1' }) });
    expect(JSON.stringify(commit[3])).not.toContain('@odata.type');
    expect(graph.patch.mock.calls[0][3]).toEqual({ '@odata.type': '#microsoft.graph.win32LobApp', committedContentVersion: '1' });
    expect(steps.at(-1)).toBe('Content-Version festgeschrieben');
  });

  it('fails fast when Intune reports an upload error', async () => {
    const graph = {
      post: vi.fn(async (_t: string, path: string) => (path.endsWith('/mobileApps') ? { id: 'app-1' } : path.endsWith('/contentVersions') ? { id: '1' } : { id: 'f1', uploadState: 'azureStorageUriRequestFailed', azureStorageUri: null })),
      get: vi.fn(),
      patch: vi.fn(),
    };
    await expect(publishWin32App(graph as unknown as GraphClient, [], ctx, {}, opened, undefined, { sleep: async () => undefined })).rejects.toThrow(/lehnte die Datei ab/);
  });
});

describe('apps.publish job', () => {
  const base = { jobId: 'j' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
  const winget: AppPackage = {
    id: 'p1',
    manifest: normalizeManifest({ vendor: 'Google', name: 'Chrome', version: 'latest', installerType: 'store', wingetPackageIdentifier: '9NBLGGH4NNS1' }),
    status: 'ready',
    artifact: null,
    installer: null,
    buildLog: null,
    buildError: null,
    detectionKeyPath: null,
    createdByEmail: 'x',
    createdAt: 'c',
    updatedAt: 'u',
    deployments: [],
  };

  function ops(over: Partial<PublishOperations> = {}): PublishOperations {
    return {
      loadPackage: vi.fn(async () => ({ pkg: winget, artifact: null, detectionPrefix: 'ZSC' })),
      publishWin32: vi.fn(async () => ({ appId: 'a', contentVersion: '1' })),
      publishWinGet: vi.fn(async () => ({ appId: 'wg-1' })),
      recordDeployment: vi.fn(async () => undefined),
      existingDeployment: vi.fn(async () => null),
      ...over,
    };
  }

  it('publishes a store package and records the deployment', async () => {
    const o = ops();
    registerAppPublishJobs(o);
    const job = getRegisteredJob('apps.publish')!;
    const payload = { packageId: 'p1', packageName: 'Chrome', tenantName: 'Contoso' };
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes[0].after).toMatchObject({ type: 'winGetApp', packageIdentifier: '9NBLGGH4NNS1' });
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(o.publishWinGet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ packageIdentifier: '9NBLGGH4NNS1' }));
    expect(o.recordDeployment).toHaveBeenLastCalledWith('m', 'p1', 't', expect.objectContaining({ status: 'published', intuneAppId: 'wg-1' }));
  });

  it('skips already published tenants and records failures', async () => {
    registerAppPublishJobs(ops({ existingDeployment: vi.fn(async () => ({ status: 'published', intuneAppId: 'old' })) }));
    const skipped = await getRegisteredJob('apps.publish')!.handler({ ...base, payload: { packageId: 'p1', packageName: 'Chrome', tenantName: 'Contoso' } });
    expect(skipped.data).toMatchObject({ changed: false });

    const o = ops({ publishWinGet: vi.fn(async () => { throw new Error('Graph 400'); }) });
    registerAppPublishJobs(o);
    const failed = await getRegisteredJob('apps.publish')!.handler({ ...base, payload: { packageId: 'p1', packageName: 'Chrome', tenantName: 'Contoso' } });
    expect(failed.error?.code).toBe('PUBLISH_FAILED');
    expect(o.recordDeployment).toHaveBeenLastCalledWith('m', 'p1', 't', expect.objectContaining({ status: 'failed', error: 'Graph 400' }));
  });

  it('refuses a win32 package without artifact', async () => {
    const draft: AppPackage = { ...winget, manifest: normalizeManifest({ vendor: 'C', name: 'Tool', version: '1', installerType: 'psadt', installerFileName: 'setup.exe' }), status: 'draft' };
    registerAppPublishJobs(ops({ loadPackage: vi.fn(async () => ({ pkg: draft, artifact: null, detectionPrefix: 'ZSC' })) }));
    const result = await getRegisteredJob('apps.publish')!.handler({ ...base, payload: { packageId: 'p1', packageName: 'Tool', tenantName: 'Contoso' } });
    expect(result.error?.message).toMatch(/kein fertiges/);
  });
});
