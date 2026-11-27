/**
 * Job-Queue mit BullMQ
 */

import { logThrottled } from '../errors.js';
import { Queue, Worker, Job as BullJob, UnrecoverableError } from 'bullmq';
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
  type JobDefinition,
  getRegisteredJob,
} from './job-types.js';
import { JobError, ReadOnlyModeError } from '../errors.js';
import { jobFailure } from './job-types.js';
import type { WriteGuard } from './write-guard.js';
import { targetCountOf } from './approval-policy.js';

export interface JobQueueConfig {
  redis: Redis;
  queueName?: string;
  concurrency?: number;
  // Vier-Augen-Prinzip: entscheidet nach der Vorschau, ob eine zweite Freigabe noetig ist
  approvalPolicy?: (job: Job, preview: PreviewResult) => Promise<{ required: boolean; reason: string | null }>;
  // Nur-Lese-Betrieb: wird beim Anlegen, Freigeben und Ausfuehren geprueft
  writeGuard?: WriteGuard;
  // Grundwartezeit vor einer Job-Wiederholung (exponentiell); Standard 30 s
  retryBackoffMs?: number;
}

// Eine zweite Person braucht Zeit; die Vorschau gilt dann laenger als fuenf Minuten
export const SECOND_APPROVAL_WINDOW_MS = 4 * 60 * 60 * 1000;
// Gueltigkeit einer Vorschau bis zur ersten Freigabe; danach wird sie neu erzeugt statt den Job zu verwerfen
export const PREVIEW_TTL_MS = 15 * 60 * 1000;

export interface JobStore {
  create(job: Job): Promise<void>;
  update(id: JobId, updates: Partial<Job>): Promise<void>;
  findById(id: JobId): Promise<Job | null>;
  findByTenant(tenantId: TenantId, options?: JobListOptions): Promise<Job[]>;
}

/** Filter fuer die Jobliste; Payload-Felder nur aus einer festen Liste (siehe JOB_PAYLOAD_FILTER_KEYS). */
export interface JobListOptions {
  limit?: number;
  status?: JobStatus;
  type?: string;
  typePrefix?: string;
  payload?: Partial<Record<JobPayloadFilterKey, string>>;
}

export const JOB_PAYLOAD_FILTER_KEYS = ['managedDeviceId', 'userId', 'appId', 'scriptId', 'groupId', 'packageId'] as const;
export type JobPayloadFilterKey = (typeof JOB_PAYLOAD_FILTER_KEYS)[number];

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


/** Handler hat das Zeitlimit der Jobdefinition ueberschritten. */
class JobTimeoutError extends Error {}

/** Signal an BullMQ: nach Backoff erneut versuchen. */
class RetryableJobError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new JobTimeoutError(`Zeitlimit von ${Math.round(ms / 1000)} s ueberschritten. Der Vorgang kann im Tenant noch laufen; Ergebnis dort pruefen.`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
        attempts: 1,
        // Job-Wiederholung erst nach den Retry-After-Wartezeiten im Client; daher grosszuegig
        backoff: {
          type: 'exponential',
          delay: 30000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
    this.jobStore = jobStore;
    this.auditLogger = auditLogger;
    this.approvalPolicy = config.approvalPolicy;
    this.writeGuard = config.writeGuard;
    this.retryBackoffMs = config.retryBackoffMs ?? 30000;
  }

  private readonly approvalPolicy?: JobQueueConfig['approvalPolicy'];
  private readonly writeGuard?: WriteGuard;
  private readonly retryBackoffMs: number;
  // Laufende Jobs je Tenant und Typ in diesem Prozess
  private readonly running = new Map<string, number>();

  private async acquireSlot(key: string, limit: number): Promise<() => void> {
    const max = Math.max(1, limit || 1);
    while ((this.running.get(key) ?? 0) >= max) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    this.running.set(key, (this.running.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.running.get(key) ?? 1) - 1;
      if (left <= 0) this.running.delete(key);
      else this.running.set(key, left);
    };
  }

  /**
   * Nur-Lese-Sperre pruefen. Ein gesperrter Versuch landet als Fehlschlag im
   * Audit (auch abgelehnte Versuche werden protokolliert) und wirft
   * ReadOnlyModeError.
   */
  private async assertWritable(
    input: { type: string; tenantId: TenantId; mspId: MspId; userId: UserId; payload: Record<string, unknown>; correlationId: CorrelationId },
    definition: JobDefinition
  ): Promise<void> {
    if (!this.writeGuard) return;
    const decision = await this.writeGuard({ type: input.type, tenantId: input.tenantId, mspId: input.mspId }, definition);
    if (!decision) return;
    await this.auditLogger.log({
      mspId: input.mspId,
      tenantId: input.tenantId,
      userId: input.userId,
      action: input.type,
      targetType: this.extractTargetType(input.payload),
      targetId: this.extractTargetId(input.payload),
      targetDisplayName: this.extractTargetDisplayName(input.payload),
      result: 'failure',
      errorMessage: `read-only-mode (${decision.scope})`,
      correlationId: input.correlationId,
    });
    throw new ReadOnlyModeError(decision.reason, decision.scope, input.correlationId);
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

    // Vor dem Anlegen: ein gesperrter Job entsteht gar nicht erst
    await this.assertWritable({ ...input, correlationId }, registered.definition);

    const job: Job = {
      id,
      type: input.type,
      tenantId: input.tenantId,
      mspId: input.mspId,
      payload: input.payload,
      status: registered.definition.requiresPreview ? 'pending_approval' : 'queued',
      priority: input.priority ?? 'normal',
      createdBy: input.userId,
      createdByEmail: input.userEmail ?? '',
      targetCount: targetCountOf(input.payload),
      createdAt: now.toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      retryCount: 0,
      maxRetries: registered.definition.maxRetries,
      correlationId,
      preview: null,
      approvals: [],
      secondApproval: { required: false, reason: null },
    };

    await this.jobStore.create(job);

    if (registered.definition.requiresPreview && registered.previewGenerator) {
      const preview = await this.generatePreview(job, registered.previewGenerator);
      const secondApproval = this.approvalPolicy ? await this.approvalPolicy(job, preview) : { required: false, reason: null };
      await this.jobStore.update(id, {
        preview: {
          ...preview,
          expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
        },
        secondApproval,
      });
    } else {
      await this.enqueue(job);
    }

    return (await this.jobStore.findById(id))!;
  }

  /**
   * Preview bestaetigen und Job ausfuehren
   */
  async approveJob(jobId: JobId, userId: UserId, userEmail = ''): Promise<Job> {
    const job = await this.jobStore.findById(jobId);
    if (!job) {
      throw new JobError(jobId, 'NOT_FOUND', 'Job not found', false);
    }

    if (job.status !== 'pending_approval' && job.status !== 'pending_second_approval') {
      throw new JobError(
        jobId,
        'INVALID_STATE',
        `Cannot approve job in status '${job.status}'`,
        false
      );
    }

    if (job.preview?.expiresAt && new Date(job.preview.expiresAt) < new Date()) {
      if (job.status === 'pending_approval') {
        // Vorschau frisch erzeugen, damit die Freigabe auf dem aktuellen Stand erfolgt
        await this.refreshPreview(jobId);
        throw new JobError(jobId, 'PREVIEW_EXPIRED', 'Die Vorschau war abgelaufen und wurde neu erstellt. Bitte pruefen und erneut freigeben.', false);
      }
      throw new JobError(jobId, 'PREVIEW_EXPIRED', 'Die Vorschau fuer die zweite Freigabe ist abgelaufen; der Job muss neu angelegt werden.', false);
    }

    // Zwischen Anlegen und Freigabe kann der Tenant auf Nur-Lesen gestellt worden sein
    const definition = getRegisteredJob(job.type)?.definition;
    if (definition) await this.assertWritable({ type: job.type, tenantId: job.tenantId, mspId: job.mspId, userId, payload: job.payload, correlationId: job.correlationId }, definition);

    const approvals = [...(job.approvals ?? []), { userId, email: userEmail, at: new Date().toISOString() }];

    if (job.status === 'pending_second_approval') {
      const first = job.approvals?.[0];
      if (first && first.userId === userId) {
        throw new JobError(jobId, 'SAME_APPROVER', 'Die zweite Freigabe muss von einer anderen Person kommen (Vier-Augen-Prinzip)', false);
      }
    } else if (job.secondApproval?.required) {
      // Erste von zwei Freigaben: Vorschau fuer die zweite Person verlaengern, noch nichts ausfuehren
      await this.jobStore.update(jobId, {
        status: 'pending_second_approval',
        approvals,
        preview: job.preview ? { ...job.preview, expiresAt: new Date(Date.now() + SECOND_APPROVAL_WINDOW_MS) } : job.preview,
      });
      return (await this.jobStore.findById(jobId))!;
    }

    await this.jobStore.update(jobId, { status: 'queued', approvals });
    await this.enqueue({ ...job, status: 'queued', approvals });

    return (await this.jobStore.findById(jobId))!;
  }

  /**
   * Vorschau eines wartenden Jobs neu erzeugen (abgelaufen oder auf Wunsch).
   */
  async refreshPreview(jobId: JobId): Promise<Job> {
    const job = await this.jobStore.findById(jobId);
    if (!job) throw new JobError(jobId, 'NOT_FOUND', 'Job not found', false);
    if (job.status !== 'pending_approval') {
      throw new JobError(jobId, 'INVALID_STATE', `Cannot refresh preview in status '${job.status}'`, false);
    }
    const registered = getRegisteredJob(job.type);
    if (!registered?.previewGenerator) return job;
    const preview = await this.generatePreview(job, registered.previewGenerator);
    const secondApproval = this.approvalPolicy ? await this.approvalPolicy(job, preview) : { required: false, reason: null };
    await this.jobStore.update(jobId, { preview: { ...preview, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS) }, secondApproval });
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
    // Ein laufender Handler laesst sich nicht sicher unterbrechen; ehrlich ablehnen statt "abgebrochen" anzuzeigen
    if (job.status === 'running') {
      throw new JobError(jobId, 'ALREADY_RUNNING', 'Der Job laeuft bereits und kann nicht mehr abgebrochen werden.', false);
    }

    await this.jobStore.update(jobId, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    });
    // Eingereihte Jobs auch aus BullMQ entfernen; der Worker prueft zusaetzlich den Status
    const bullJob = await this.queue.getJob(jobId);
    await bullJob?.remove().catch(() => undefined);

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
    options?: JobListOptions
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
        // Abgebrochen, waehrend er in der Queue lag: nichts ausfuehren
        if (job.status === 'cancelled') {
          return { success: false, error: { code: 'CANCELLED', message: 'Job was cancelled before it ran', retryable: false } };
        }

        const registered = getRegisteredJob(job.type);
        if (!registered) {
          throw new Error(`Unknown job type: ${job.type}`);
        }

        // Bereits eingereihte Jobs laufen nach dem Umschalten nicht mehr
        if (this.writeGuard) {
          const decision = await this.writeGuard({ type: job.type, tenantId: job.tenantId, mspId: job.mspId }, registered.definition);
          if (decision) {
            await this.jobStore.update(job.id, { status: 'failed', completedAt: new Date().toISOString(), error: decision.reason });
            await this.auditLogger.log({
              mspId: job.mspId,
              tenantId: job.tenantId,
              userId: job.createdBy,
              action: job.type,
              targetType: this.extractTargetType(job.payload),
              targetId: this.extractTargetId(job.payload),
              targetDisplayName: this.extractTargetDisplayName(job.payload),
              result: 'failure',
              errorMessage: `read-only-mode (${decision.scope})`,
              correlationId: job.correlationId,
            });
            // Kein Retry: UnrecoverableError beendet den BullMQ-Job sofort
            throw new UnrecoverableError(decision.reason);
          }
        }

        const definition = registered.definition;
        const maxAttempts = Math.max(1, definition.maxRetries + 1);
        const isLastAttempt = bullJob.attemptsMade + 1 >= maxAttempts;

        // Limit je Tenant und Jobtyp aus der Definition (z. B. hoechstens 3 Run Commands gleichzeitig)
        const release = await this.acquireSlot(`${job.tenantId}:${job.type}`, definition.concurrencyPerTenant);
        try {
          await this.jobStore.update(job.id, {
            status: 'running',
            startedAt: new Date().toISOString(),
            retryCount: bullJob.attemptsMade,
          });

          let result: JobResult;
          try {
            result = await withTimeout(
              registered.handler({
                jobId: job.id,
                tenantId: job.tenantId,
                mspId: job.mspId,
                userId: job.createdBy,
                correlationId: job.correlationId,
                payload: job.payload,
                attempt: bullJob.attemptsMade,
              }),
              definition.timeoutSeconds * 1000
            );
          } catch (error) {
            const timedOut = error instanceof JobTimeoutError;
            result = timedOut
              ? { success: false, error: { code: 'JOB_TIMEOUT', message: error.message, retryable: false } }
              : jobFailure('HANDLER_ERROR', error);
          }

          if (result.success) {
            await this.jobStore.update(job.id, {
              status: 'completed',
              completedAt: new Date().toISOString(),
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
            return result;
          }

          const message = result.error?.message ?? 'Unknown error';
          // Nur gedrosselte Aufrufe (429) wiederholen, und nur so oft wie die Definition erlaubt
          if (result.error?.retryable && !isLastAttempt) {
            await this.jobStore.update(job.id, { status: 'queued', error: `Wird wiederholt (Versuch ${bullJob.attemptsMade + 2} von ${maxAttempts}): ${message}` });
            throw new RetryableJobError(message);
          }

          await this.jobStore.update(job.id, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            error: message,
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
            errorMessage: message,
            correlationId: job.correlationId,
          });

          // Endgueltig: BullMQ soll nicht noch einmal anfangen
          return result;
        } finally {
          release();
        }
      },
      {
        connection: this.queue.opts.connection as Redis,
        concurrency,
      }
    );

    // Ohne Listener verschluckt BullMQ Verbindungsfehler; der Worker steht dann still
    this.worker.on('error', (error: Error) => {
      logThrottled('Job worker error', error);
    });
    this.worker.on('failed', (bullJob, error: Error) => {
      console.error(`Job ${bullJob?.id ?? 'unknown'} failed:`, error.message);
    });
  }

  /**
   * Zustand von Redis-Verbindung und Worker (fuer /health)
   */
  getHealth(): { redisStatus: string; workerRunning: boolean } {
    const connection = this.queue.opts.connection as Redis;
    return {
      redisStatus: connection.status,
      workerRunning: this.worker !== null && this.worker.isRunning(),
    };
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

    const definition = getRegisteredJob(job.type)?.definition;
    await this.queue.add(job.type, jobData, {
      jobId: job.id,
      priority: priorityMap[job.priority] ?? 3,
      // maxRetries der Definition statt pauschal 3 Versuche
      attempts: Math.max(1, (definition?.maxRetries ?? 0) + 1),
      backoff: { type: 'exponential', delay: this.retryBackoffMs },
    });

    await this.jobStore.update(job.id, { status: 'queued' });
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
