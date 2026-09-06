/**
 * Job-Typen und -Definitionen
 */

import type {
  TenantId,
  MspId,
  UserId,
  JobId,
  CorrelationId,
  JobStatus,
  JobPriority,
  JobPreview,
  JobError,
  PlannedChange,
} from '@zerostress/types';

export interface JobDefinition {
  type: string;
  displayName: string;
  maxRetries: number;
  timeoutSeconds: number;
  concurrencyPerTenant: number;
  requiresPreview: boolean;
}

export interface CreateJobInput {
  type: string;
  tenantId: TenantId;
  mspId: MspId;
  userId: UserId;
  payload: Record<string, unknown>;
  priority?: JobPriority;
}

export interface JobData {
  id: JobId;
  type: string;
  tenantId: TenantId;
  mspId: MspId;
  userId: UserId;
  payload: Record<string, unknown>;
  priority: JobPriority;
  correlationId: CorrelationId;
  createdAt: Date;
}

export interface JobContext {
  jobId: JobId;
  tenantId: TenantId;
  mspId: MspId;
  userId: UserId;
  correlationId: CorrelationId;
  payload: Record<string, unknown>;
  attempt: number;
}

export interface JobResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: JobError;
}

export interface PreviewContext {
  tenantId: TenantId;
  mspId: MspId;
  userId: UserId;
  payload: Record<string, unknown>;
}

export interface PreviewResult {
  changes: PlannedChange[];
  warnings: string[];
  estimatedDurationSeconds: number;
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;
export type PreviewGenerator = (ctx: PreviewContext) => Promise<PreviewResult>;

export interface RegisteredJob {
  definition: JobDefinition;
  handler: JobHandler;
  previewGenerator?: PreviewGenerator;
}

// Job-Registry
const jobRegistry = new Map<string, RegisteredJob>();

export function registerJob(
  definition: JobDefinition,
  handler: JobHandler,
  previewGenerator?: PreviewGenerator
): void {
  jobRegistry.set(definition.type, {
    definition,
    handler,
    previewGenerator,
  });
}

export function getRegisteredJob(type: string): RegisteredJob | undefined {
  return jobRegistry.get(type);
}

export function getAllRegisteredJobs(): RegisteredJob[] {
  return Array.from(jobRegistry.values());
}
