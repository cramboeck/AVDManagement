/**
 * Job-Store Implementation mit Drizzle
 */

import { eq, and, or, desc, lt, like, inArray, sql, type SQL } from 'drizzle-orm';
import { db, jobs, mspUsers } from '../db/index.js';
import { JOB_PAYLOAD_FILTER_KEYS, targetCountOf, type JobListOptions, type JobStore } from '@zerostress/core';
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
      approvals: job.approvals ?? [],
      secondApproval: job.secondApproval ?? null,
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
    if (updates.approvals !== undefined) updateData.approvals = updates.approvals;
    if (updates.secondApproval !== undefined) updateData.secondApproval = updates.secondApproval;

    if (Object.keys(updateData).length === 0) return;

    await db.update(jobs).set(updateData).where(eq(jobs.id, id));
  }

  async findById(id: JobId): Promise<Job | null> {
    const row = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!row) return null;

    const [job] = await this.withCreators([row]);
    return job;
  }

  async findByTenant(tenantId: TenantId, options?: JobListOptions): Promise<Job[]> {
    const conditions: SQL[] = [eq(jobs.tenantId, tenantId)];
    if (options?.status) {
      conditions.push(eq(jobs.status, options.status));
    }
    if (options?.type) conditions.push(eq(jobs.type, options.type));
    if (options?.typePrefix) conditions.push(like(jobs.type, `${options.typePrefix.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`));
    // Payload-Filter nur fuer bekannte Schluessel; Schluessel und Wert gehen als Parameter an Postgres
    for (const key of JOB_PAYLOAD_FILTER_KEYS) {
      const value = options?.payload?.[key];
      if (value) conditions.push(sql`${jobs.payload} ->> ${key} = ${value}`);
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

  // Aeltere Passwort-Resets speicherten das temporaere Passwort im Klartext; einmalig entfernen
  async scrubPlaintextPasswords(): Promise<number> {
    const scrubbed = await db
      .update(jobs)
      .set({ result: sql`(${jobs.result} - 'temporaryPassword') || '{"passwordScrubbed": true}'::jsonb` })
      .where(and(eq(jobs.type, 'identity.reset-password'), sql`${jobs.result} ? 'temporaryPassword'`))
      .returning({ id: jobs.id });
    return scrubbed.length;
  }

  // Freigaben, die niemand bestaetigt hat, nicht ewig offen lassen
  async cancelExpiredPending(olderThan: Date, secondApprovalOlderThan: Date = olderThan): Promise<number> {
    const cancelled = await db
      .update(jobs)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
        error: 'Preview expired without approval',
      })
      .where(and(eq(jobs.status, 'pending_approval'), lt(jobs.createdAt, olderThan)))
      .returning({ id: jobs.id });
    const cancelledSecond = await db
      .update(jobs)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
        error: 'Second approval not given in time',
      })
      .where(and(eq(jobs.status, 'pending_second_approval'), lt(jobs.createdAt, secondApprovalOlderThan)))
      .returning({ id: jobs.id });

    return cancelled.length + cancelledSecond.length;
  }

  // Jobs, die der Worker nie abgeschlossen hat (z. B. Neustart, Redis weg), nicht ewig "laufen" lassen
  /**
   * Haengende Jobs beenden. Laufende nach ihrem Start, eingereihte nach dem
   * Anlegen plus Freigabefenster: eine zweite Freigabe darf Stunden nach dem
   * Anlegen kommen, der Job ist dann frisch eingereiht und nicht "alt".
   */
  async failStaleActive(runningStartedBefore: Date, queuedCreatedBefore: Date = runningStartedBefore): Promise<number> {
    const failed = await db
      .update(jobs)
      .set({
        status: 'failed',
        completedAt: new Date(),
        error: 'Job was not completed by the worker within the expected time',
      })
      .where(
        or(
          and(eq(jobs.status, 'running'), lt(sql`coalesce(${jobs.startedAt}, ${jobs.createdAt})`, runningStartedBefore)),
          and(eq(jobs.status, 'queued'), lt(jobs.createdAt, queuedCreatedBefore))
        )
      )
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
      targetCount: targetCountOf(row.payload as Record<string, unknown>),
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      result: row.result as Record<string, unknown> | null,
      error: row.error as Job['error'],
      retryCount: row.retryCount,
      maxRetries: row.maxRetries,
      correlationId: row.correlationId as Job['correlationId'],
      preview: row.preview as Job['preview'],
      approvals: (row.approvals as Job['approvals'] | null) ?? [],
      secondApproval: (row.secondApproval as Job['secondApproval'] | null) ?? { required: false, reason: null },
    };
  }
}
