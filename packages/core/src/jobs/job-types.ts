/**
 * Job-Typen und -Definitionen
 */

import { GraphApiError, ArmApiError } from '../errors.js';
import type {
  TenantId,
  MspId,
  UserId,
  JobId,
  CorrelationId,
  JobPriority,
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
  // Darf auch im Nur-Lese-Betrieb laufen: nur Jobs, die nichts im Tenant
  // anlegen oder aendern, oder die eine fruehere Aenderung der Konsole
  // zuruecknehmen (z. B. Admin-Rechte entziehen). Standard: nein.
  allowedInReadOnly?: boolean;
}

export interface CreateJobInput {
  type: string;
  tenantId: TenantId;
  mspId: MspId;
  userId: UserId;
  userEmail?: string;
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
  createdAt: string;
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

/**
 * Einheitliche Fehlerabbildung fuer Jobs aus Graph- und ARM-Fehlern.
 * Wiederholt wird nur bei 429: der Aufruf wurde dann abgelehnt und nicht
 * ausgefuehrt. Bei 5xx ist offen, ob die Aenderung schon passiert ist.
 */
export function jobFailure(code: string, error: unknown): JobResult {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof GraphApiError || error instanceof ArmApiError) {
    const status = error.statusCode;
    const hint =
      status === 401 || status === 403
        ? 'Berechtigung fehlt'
        : status === 404
          ? 'Ziel nicht gefunden (geloescht oder umbenannt)'
          : status === 429
            ? 'Microsoft drosselt gerade'
            : status >= 500
              ? 'Fehler bei Microsoft; Ergebnis im Tenant pruefen'
              : null;
    return { success: false, error: { code, message: hint ? `${hint} (${status}): ${message}` : message, retryable: status === 429 } };
  }
  return { success: false, error: { code, message, retryable: false } };
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
