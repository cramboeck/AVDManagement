/**
 * Job-Store Implementation mit Drizzle
 */

import { eq, and, desc } from 'drizzle-orm';
import { db, jobs } from '../db/index.js';
import type { JobStore } from '@zerostress/core';
import type { Job, JobId, TenantId, JobStatus } from '@zerostress/types';

export class DrizzleJobStore implements JobStore {
  async create(job: Job): Promise<void> {
    await db.insert(jobs).values({
      id: job.id,
      mspId: job.mspId,
      tenantId: job.tenantId,
      type: job.type,
      payload: job.payload,
      status: job.status,
      priority: job.priority,
      createdBy: job.createdBy,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: job.result,
      error: job.error,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      correlationId: job.correlationId,
      preview: job.preview,
    });
  }

  async update(id: JobId, updates: Partial<Job>): Promise<void> {
    const updateData: Record<string, unknown> = {};

    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.startedAt !== undefined) updateData.startedAt = updates.startedAt;
    if (updates.completedAt !== undefined) updateData.completedAt = updates.completedAt;
    if (updates.result !== undefined) updateData.result = updates.result;
    if (updates.error !== undefined) updateData.error = updates.error;
    if (updates.retryCount !== undefined) updateData.retryCount = updates.retryCount;
    if (updates.preview !== undefined) updateData.preview = updates.preview;

    await db.update(jobs).set(updateData).where(eq(jobs.id, id));
  }

  async findById(id: JobId): Promise<Job | null> {
    const row = await db.query.jobs.findFirst({
      where: eq(jobs.id, id),
    });

    if (!row) return null;

    return this.mapRowToJob(row);
  }

  async findByTenant(
    tenantId: TenantId,
    options?: { limit?: number; status?: JobStatus }
  ): Promise<Job[]> {
    const conditions = [eq(jobs.tenantId, tenantId)];

    if (options?.status) {
      conditions.push(eq(jobs.status, options.status));
    }

    const rows = await db.query.jobs.findMany({
      where: and(...conditions),
      orderBy: [desc(jobs.createdAt)],
      limit: options?.limit ?? 50,
    });

    return rows.map(this.mapRowToJob);
  }

  private mapRowToJob(row: typeof jobs.$inferSelect): Job {
    return {
      id: row.id as JobId,
      type: row.type,
      tenantId: row.tenantId as TenantId,
      mspId: row.mspId as Job['mspId'],
      payload: row.payload as Record<string, unknown>,
      status: row.status as JobStatus,
      priority: row.priority as Job['priority'],
      createdBy: row.createdBy as Job['createdBy'],
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      result: row.result as Record<string, unknown> | null,
      error: row.error as Job['error'],
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      correlationId: row.correlationId as Job['correlationId'],
      preview: row.preview as Job['preview'],
    };
  }
}
