/**
 * Job-Store Implementation mit Drizzle
 */

import { eq, and, desc, lt, inArray, sql } from 'drizzle-orm';
import { db, jobs, mspUsers } from '../db/index.js';
import type { JobStore } from '@zerostress/core';
import type { Job, JobId, TenantId, JobStatus } from '@zerostress/types';

type JobRow = typeof jobs.$inferSelect;

export class DrizzleJobStore implements JobStore {
  async create(job: Job): Promise<void> {
    // Die Queue vergibt die Id; sie muss in der DB identisch sein, sonst
    // finden Preview-Update, Worker und Statusabfragen den Job nicht
    await db.insert(jobs).values({
      id: job.id,
      mspId: job.mspId,
      tenantId: job.tenantId,
      type: job.type,
      payload: job.payload,
      status: job.status,
      priority: job.priority,
      createdBy: job.createdBy,
      createdAt: new Date(job.createdAt),
      startedAt: job.startedAt ? new Date(job.startedAt) : null,
      completedAt: job.completedAt ? new Date(job.completedAt) : null,
      result: job.result,
      error: job.error,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      correlationId: job.correlationId,
      preview: job.preview,
    });
  }

  async update(id: JobId, updates: Partial<Job>): Promise<void> {
    const updateData: Partial<typeof jobs.$inferInsert> = {};

    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.startedAt !== undefined) updateData.startedAt = updates.startedAt ? new Date(updates.startedAt) : null;
    if (updates.completedAt !== undefined) updateData.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
    if (updates.result !== undefined) updateData.result = updates.result;
    if (updates.error !== undefined) updateData.error = updates.error;
    if (updates.retryCount !== undefined) updateData.retryCount = updates.retryCount;
    if (updates.preview !== undefined) updateData.preview = updates.preview;

    if (Object.keys(updateData).length === 0) return;

    await db.update(jobs).set(updateData).where(eq(jobs.id, id));
  }

  async findById(id: JobId): Promise<Job | null> {
    const row = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!row) return null;

    const [job] = await this.withCreators([row]);
    return job;
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

    return this.withCreators(rows);
  }

  // Versiegelte Ergebnisse nach Ablauf der Aufbewahrung loeschen; Metadaten bleiben
  async purgeSealedResults(olderThan: Date): Promise<number> {
    const purged = await db
      .update(jobs)
      .set({ result: sql`(${jobs.result} - 'cipher') || '{"purged": true}'::jsonb` })
      .where(and(sql`${jobs.result} ->> 'sealed' = 'true'`, sql`${jobs.result} ? 'cipher'`, lt(jobs.completedAt, olderThan)))
      .returning({ id: jobs.id });
    return purged.length;
  }

  // Freigaben, die niemand bestaetigt hat, nicht ewig offen lassen
  async cancelExpiredPending(olderThan: Date): Promise<number> {
    const cancelled = await db
      .update(jobs)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
        error: 'Preview expired without approval',
      })
      .where(and(eq(jobs.status, 'pending_approval'), lt(jobs.createdAt, olderThan)))
      .returning({ id: jobs.id });

    return cancelled.length;
  }

  // Jobs, die der Worker nie abgeschlossen hat (z. B. Neustart, Redis weg), nicht ewig "laufen" lassen
  async failStaleActive(olderThan: Date): Promise<number> {
    const failed = await db
      .update(jobs)
      .set({
        status: 'failed',
        completedAt: new Date(),
        error: 'Job was not completed by the worker within the expected time',
      })
      .where(and(inArray(jobs.status, ['queued', 'running']), lt(jobs.createdAt, olderThan)))
      .returning({ id: jobs.id });

    return failed.length;
  }

  private async withCreators(rows: JobRow[]): Promise<Job[]> {
    const creatorIds = Array.from(new Set(rows.map((r) => r.createdBy)));
    const creators = creatorIds.length
      ? await db
          .select({ id: mspUsers.id, email: mspUsers.email })
          .from(mspUsers)
          .where(inArray(mspUsers.id, creatorIds))
      : [];
    const emailById = new Map(creators.map((c) => [c.id, c.email]));

    return rows.map((row) => this.mapRowToJob(row, emailById.get(row.createdBy) ?? ''));
  }

  private mapRowToJob(row: JobRow, createdByEmail: string): Job {
    return {
      id: row.id as JobId,
      type: row.type,
      tenantId: row.tenantId as TenantId,
      mspId: row.mspId as Job['mspId'],
      payload: row.payload as Record<string, unknown>,
      status: row.status as JobStatus,
      priority: row.priority as Job['priority'],
      createdBy: row.createdBy as Job['createdBy'],
      createdByEmail,
      targetCount: 1,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      result: row.result as Record<string, unknown> | null,
      error: row.error as Job['error'],
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      correlationId: row.correlationId as Job['correlationId'],
      preview: row.preview as Job['preview'],
    };
  }
}
