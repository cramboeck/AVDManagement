/**
 * Job-Queue mit BullMQ
 */

import { Queue, Worker, Job as BullJob } from 'bullmq';
import type { Redis } from 'ioredis';
import type {
  JobId,
  TenantId,
  MspId,
  UserId,
  CorrelationId,
  JobStatus,
  Job,
} from '@zerostress/types';
import {
  type JobData,
  type CreateJobInput,
  type JobResult,
  type PreviewResult,
  getRegisteredJob,
} from './job-types.js';
import { JobError } from '../errors.js';

export interface JobQueueConfig {
  redis: Redis;
  queueName?: string;
  concurrency?: number;
}

export interface JobStore {
  create(job: Job): Promise<void>;
  update(id: JobId, updates: Partial<Job>): Promise<void>;
  findById(id: JobId): Promise<Job | null>;
  findByTenant(tenantId: TenantId, options?: { limit?: number; status?: JobStatus }): Promise<Job[]>;
}

export interface AuditLogger {
  log(entry: {
    mspId: MspId;
    tenantId: TenantId;
    userId: UserId;
    action: string;
    targetType: string;
    targetId: string;
    targetDisplayName: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    result: 'success' | 'failure' | 'partial';
    errorMessage?: string;
    correlationId: CorrelationId;
  }): Promise<void>;
}

export class JobQueue {
  private readonly queue: Queue<JobData>;
  private worker: Worker<JobData, JobResult> | null = null;
  private readonly jobStore: JobStore;
  private readonly auditLogger: AuditLogger;

  constructor(
    config: JobQueueConfig,
    jobStore: JobStore,
    auditLogger: AuditLogger
  ) {
    this.queue = new Queue<JobData>(config.queueName ?? 'jobs', {
      connection: config.redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
    this.jobStore = jobStore;
    this.auditLogger = auditLogger;
  }

  /**
   * Job erstellen und in Queue einreihen
   */
  async createJob(input: CreateJobInput): Promise<Job> {
    const registered = getRegisteredJob(input.type);
    if (!registered) {
      throw new Error(`Unknown job type: ${input.type}`);
    }

    const id = crypto.randomUUID() as JobId;
    const correlationId = crypto.randomUUID() as CorrelationId;
    const now = new Date();

    const job: Job = {
      id,
      type: input.type,
      tenantId: input.tenantId,
      mspId: input.mspId,
      payload: input.payload,
      status: registered.definition.requiresPreview ? 'preview-pending' : 'pending',
      priority: input.priority ?? 'normal',
      createdBy: input.userId,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      retryCount: 0,
      maxRetries: registered.definition.maxRetries,
      correlationId,
      preview: null,
    };

    await this.jobStore.create(job);

    if (registered.definition.requiresPreview && registered.previewGenerator) {
      const preview = await this.generatePreview(job, registered.previewGenerator);
      await this.jobStore.update(id, {
        status: 'preview-ready',
        preview: {
          ...preview,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
    } else {
      await this.enqueue(job);
    }

    return (await this.jobStore.findById(id))!;
  }

  /**
   * Preview bestaetigen und Job ausfuehren
   */
  async approveJob(jobId: JobId, userId: UserId): Promise<Job> {
    const job = await this.jobStore.findById(jobId);
    if (!job) {
      throw new JobError(jobId, 'NOT_FOUND', 'Job not found', false);
    }

    if (job.status !== 'preview-ready') {
      throw new JobError(
        jobId,
        'INVALID_STATE',
        `Cannot approve job in status '${job.status}'`,
        false
      );
    }

    if (job.preview?.expiresAt && new Date(job.preview.expiresAt) < new Date()) {
      throw new JobError(jobId, 'PREVIEW_EXPIRED', 'Preview has expired', false);
    }

    await this.jobStore.update(jobId, { status: 'approved' });
    await this.enqueue({ ...job, status: 'approved' });

    return (await this.jobStore.findById(jobId))!;
  }

  /**
   * Job abbrechen
   */
  async cancelJob(jobId: JobId): Promise<Job> {
    const job = await this.jobStore.findById(jobId);
    if (!job) {
      throw new JobError(jobId, 'NOT_FOUND', 'Job not found', false);
    }

    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      throw new JobError(
        jobId,
        'INVALID_STATE',
        `Cannot cancel job in status '${job.status}'`,
        false
      );
    }

    await this.jobStore.update(jobId, {
      status: 'cancelled',
      completedAt: new Date(),
    });

    return (await this.jobStore.findById(jobId))!;
  }

  /**
   * Job-Status abrufen
   */
  async getJob(jobId: JobId): Promise<Job | null> {
    return this.jobStore.findById(jobId);
  }

  /**
   * Jobs fuer einen Tenant auflisten
   */
  async listJobs(
    tenantId: TenantId,
    options?: { limit?: number; status?: JobStatus }
  ): Promise<Job[]> {
    return this.jobStore.findByTenant(tenantId, options);
  }

  /**
   * Worker starten
   */
  startWorker(concurrency = 5): void {
    if (this.worker) return;

    this.worker = new Worker<JobData, JobResult>(
      this.queue.name,
      async (bullJob: BullJob<JobData>) => {
        const jobData = bullJob.data;
        const job = await this.jobStore.findById(jobData.id);
        if (!job) {
          throw new Error(`Job ${jobData.id} not found in store`);
        }

        const registered = getRegisteredJob(job.type);
        if (!registered) {
          throw new Error(`Unknown job type: ${job.type}`);
        }

        await this.jobStore.update(job.id, {
          status: 'running',
          startedAt: new Date(),
          retryCount: bullJob.attemptsMade,
        });

        try {
          const result = await registered.handler({
            jobId: job.id,
            tenantId: job.tenantId,
            mspId: job.mspId,
            userId: job.createdBy,
            correlationId: job.correlationId,
            payload: job.payload,
            attempt: bullJob.attemptsMade,
          });

          const now = new Date();

          if (result.success) {
            await this.jobStore.update(job.id, {
              status: 'completed',
              completedAt: now,
              result: result.data ?? {},
            });

            await this.auditLogger.log({
              mspId: job.mspId,
              tenantId: job.tenantId,
              userId: job.createdBy,
              action: job.type,
              targetType: this.extractTargetType(job.payload),
              targetId: this.extractTargetId(job.payload),
              targetDisplayName: this.extractTargetDisplayName(job.payload),
              beforeState: job.preview?.changes[0]?.before,
              afterState: job.preview?.changes[0]?.after,
              result: 'success',
              correlationId: job.correlationId,
            });
          } else {
            await this.jobStore.update(job.id, {
              status: 'failed',
              completedAt: now,
              error: result.error,
            });

            await this.auditLogger.log({
              mspId: job.mspId,
              tenantId: job.tenantId,
              userId: job.createdBy,
              action: job.type,
              targetType: this.extractTargetType(job.payload),
              targetId: this.extractTargetId(job.payload),
              targetDisplayName: this.extractTargetDisplayName(job.payload),
              result: 'failure',
              errorMessage: result.error?.message,
              correlationId: job.correlationId,
            });
          }

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          await this.jobStore.update(job.id, {
            status: 'failed',
            completedAt: new Date(),
            error: {
              code: 'EXECUTION_ERROR',
              message: errorMessage,
              retryable: bullJob.attemptsMade < registered.definition.maxRetries,
            },
          });

          await this.auditLogger.log({
            mspId: job.mspId,
            tenantId: job.tenantId,
            userId: job.createdBy,
            action: job.type,
            targetType: this.extractTargetType(job.payload),
            targetId: this.extractTargetId(job.payload),
            targetDisplayName: this.extractTargetDisplayName(job.payload),
            result: 'failure',
            errorMessage,
            correlationId: job.correlationId,
          });

          throw error;
        }
      },
      {
        connection: this.queue.opts.connection as Redis,
        concurrency,
      }
    );
  }

  /**
   * Worker stoppen
   */
  async stopWorker(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Queue schliessen
   */
  async close(): Promise<void> {
    await this.stopWorker();
    await this.queue.close();
  }

  private async enqueue(job: Job): Promise<void> {
    const jobData: JobData = {
      id: job.id,
      type: job.type,
      tenantId: job.tenantId,
      mspId: job.mspId,
      userId: job.createdBy,
      payload: job.payload,
      priority: job.priority,
      correlationId: job.correlationId,
      createdAt: job.createdAt,
    };

    const priorityMap: Record<string, number> = {
      critical: 1,
      high: 2,
      normal: 3,
      low: 4,
    };

    await this.queue.add(job.type, jobData, {
      jobId: job.id,
      priority: priorityMap[job.priority] ?? 3,
    });

    await this.jobStore.update(job.id, { status: 'pending' });
  }

  private async generatePreview(
    job: Job,
    generator: (ctx: { tenantId: TenantId; mspId: MspId; userId: UserId; payload: Record<string, unknown> }) => Promise<PreviewResult>
  ): Promise<PreviewResult> {
    return generator({
      tenantId: job.tenantId,
      mspId: job.mspId,
      userId: job.createdBy,
      payload: job.payload,
    });
  }

  private extractTargetType(payload: Record<string, unknown>): string {
    return (payload.targetType as string) ?? 'unknown';
  }

  private extractTargetId(payload: Record<string, unknown>): string {
    return (payload.targetId as string) ?? (payload.userId as string) ?? 'unknown';
  }

  private extractTargetDisplayName(payload: Record<string, unknown>): string {
    return (payload.targetDisplayName as string) ?? (payload.userDisplayName as string) ?? 'unknown';
  }
}
