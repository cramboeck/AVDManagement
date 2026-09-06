/**
 * ZeroStress Cockpit - Shared Type Definitions
 */

// Branded Types fuer Typsicherheit
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type MspId = Brand<string, 'MspId'>;
export type JobId = Brand<string, 'JobId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type MicrosoftId = Brand<string, 'MicrosoftId'>;

// Rollen fuer RBAC
export type UserRole = 'owner' | 'engineer' | 'readonly';

// MSP-Organisation
export interface MspOrganization {
  id: MspId;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: Date;
}

// MSP-Benutzer (Konsolen-Admin)
export interface MspUser {
  id: UserId;
  mspId: MspId;
  entraObjectId: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
}

// Authentifizierungsmethode fuer Tenants
export type TenantAuthMethod = 'gdap' | 'app-consent';

// Tenant-Verbindungsstatus
export type TenantConnectionStatus =
  | 'connected'
  | 'consent-required'
  | 'permissions-insufficient'
  | 'error';

// Fehlende Scopes
export interface MissingScope {
  scope: string;
  reason: string;
}

// Verwalteter Tenant
export interface ManagedTenant {
  id: TenantId;
  mspId: MspId;
  microsoftTenantId: string;
  displayName: string;
  primaryDomain: string;
  authMethod: TenantAuthMethod;
  connectionStatus: TenantConnectionStatus;
  missingScopes: MissingScope[];
  onboardedAt: Date;
  lastSyncAt: Date | null;
  isActive: boolean;
}

// Gespiegelter Benutzer aus Graph
export interface SyncedUser {
  id: UserId;
  tenantId: TenantId;
  microsoftId: MicrosoftId;
  userPrincipalName: string;
  displayName: string;
  mail: string | null;
  accountEnabled: boolean;
  userType: 'Member' | 'Guest';
  createdAt: Date | null;
  syncedAt: Date;
}

// Lizenz-SKU
export interface LicenseSku {
  skuId: string;
  skuPartNumber: string;
  displayName: string;
}

// Benutzer-Lizenzzuweisung
export interface UserLicense {
  skuId: string;
  skuPartNumber: string;
  assignedAt: Date;
}

// Job-Status
export type JobStatus =
  | 'pending_approval'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobPriority = 'low' | 'normal' | 'high' | 'critical';

// Geplante Aenderung (Preview)
export interface PlannedChange {
  objectType: string;
  objectId: string;
  objectDisplayName: string;
  action: 'create' | 'update' | 'delete';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

// Job-Preview
export interface JobPreview {
  changes: PlannedChange[];
  warnings: string[];
  estimatedDurationSeconds: number;
  expiresAt: Date;
}

// Job-Fehler
export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
}

// Job
export interface Job {
  id: JobId;
  type: string;
  tenantId: TenantId;
  mspId: MspId;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: JobPriority;
  createdBy: UserId;
  createdByEmail: string;
  targetCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  correlationId: CorrelationId;
  preview: JobPreview | null;
}

// Audit-Ergebnis
export type AuditOutcome = 'success' | 'failure' | 'partial';

// Audit-Eintrag
export interface AuditEntry {
  id: string;
  mspId: MspId;
  tenantId: TenantId | null;
  timestamp: string;
  actorId: UserId;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  targetDisplayName: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  outcome: AuditOutcome;
  errorMessage: string | null;
  correlationId: CorrelationId;
}

// Paginierung
export interface PaginatedResponse<T> {
  items: T[];
  nextPageToken: string | null;
  totalCount?: number;
}

// API-Fehler (RFC 9457)
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
}

// Session-Daten
export interface SessionUser {
  id: UserId;
  mspId: MspId;
  email: string;
  displayName: string;
  role: UserRole;
}
