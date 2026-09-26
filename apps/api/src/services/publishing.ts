/**
 * Veroeffentlichung von Paketen: verbindet Katalog, Artefaktspeicher und
 * AppProvider fuer den Job apps.publish; Rollout legt je Tenant einen Job an.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { PublishOperations } from '@zerostress/core';
import type { Job, TenantId } from '@zerostress/types';
import { db, managedTenants } from '../db/index.js';
import { getAppProvider } from './microsoft-clients.js';
import { getPackage, upsertDeployment, getDeployment, openFile, detectionPrefix } from './packages.js';
import { getJobQueue } from './job-queue.js';
import { rememberMicrosoftTenantId } from './microsoft-clients.js';

export const MAX_IN_MEMORY_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export const publishOperations: PublishOperations = {
  async loadPackage(mspId, packageId) {
    const pkg = await getPackage(mspId, packageId);
    if (!pkg) return null;
    let artifact: Buffer | null = null;
    if (pkg.artifact) {
      // Der Upload haelt das Artefakt im Speicher; groessere Pakete brauchen den Stream-Upload (Backlog)
      if (pkg.artifact.sizeBytes > MAX_IN_MEMORY_ARTIFACT_BYTES) {
        throw new Error(`Artefakt ist ${Math.round(pkg.artifact.sizeBytes / 1024 / 1024)} MB; mehr als ${MAX_IN_MEMORY_ARTIFACT_BYTES / 1024 / 1024} MB werden noch nicht hochgeladen`);
      }
      const opened = await openFile(mspId, packageId, 'artifact');
      artifact = opened ? await readAll(opened.stream) : null;
    }
    return { pkg, artifact, detectionPrefix: detectionPrefix() };
  },
  publishWin32: (ctx, payload, opened, onProgress) => getAppProvider().publishWin32(ctx, payload, opened, onProgress),
  publishWinGet: (ctx, payload) => getAppProvider().publishWinGet(ctx, payload),
  recordDeployment: (mspId, packageId, tenantId, patch) => upsertDeployment(mspId, packageId, tenantId, patch),
  async existingDeployment(packageId, tenantId) {
    const row = await getDeployment(packageId, tenantId);
    return row ? { status: row.status, intuneAppId: row.intuneAppId } : null;
  },
};

/**
 * Je Tenant einen Job apps.publish anlegen; optional sofort freigeben.
 */
export async function startRollout(input: { mspId: string; userId: string; userEmail: string; packageId: string; tenantIds: string[]; autoApprove: boolean }): Promise<Job[]> {
  const pkg = await getPackage(input.mspId, input.packageId);
  if (!pkg) throw new Error('Package not found');
  const tenants = await db
    .select({ id: managedTenants.id, displayName: managedTenants.displayName, microsoftTenantId: managedTenants.microsoftTenantId, connectionStatus: managedTenants.connectionStatus })
    .from(managedTenants)
    .where(and(eq(managedTenants.mspId, input.mspId), eq(managedTenants.isActive, true), inArray(managedTenants.id, input.tenantIds)));
  const queue = getJobQueue();
  const jobs: Job[] = [];
  const packageName = `${pkg.manifest.vendor} ${pkg.manifest.name} ${pkg.manifest.version}`;
  for (const tenant of tenants) {
    if (tenant.connectionStatus !== 'connected') continue;
    rememberMicrosoftTenantId(tenant.id, tenant.microsoftTenantId);
    const job = await queue.createJob({
      type: 'apps.publish',
      tenantId: tenant.id as TenantId,
      mspId: input.mspId as Job['mspId'],
      userId: input.userId as Job['createdBy'],
      userEmail: input.userEmail,
      payload: { packageId: input.packageId, packageName, tenantName: tenant.displayName, targetType: 'app', targetId: input.packageId, targetDisplayName: `${packageName} -> ${tenant.displayName}` },
    });
    await upsertDeployment(input.mspId, input.packageId, tenant.id, { status: 'pending', jobId: job.id, error: null });
    jobs.push(input.autoApprove && job.status === 'pending_approval' ? await queue.approveJob(job.id, input.userId as Job['createdBy']) : job);
  }
  return jobs;
}
