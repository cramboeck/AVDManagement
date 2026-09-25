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

// ============================================
// AVD-Typen (Azure Virtual Desktop)
// ============================================

export type HostPoolId = Brand<string, 'HostPoolId'>;
export type SessionHostId = Brand<string, 'SessionHostId'>;
export type UserSessionId = Brand<string, 'UserSessionId'>;
export type AzureSubscriptionId = Brand<string, 'AzureSubscriptionId'>;
export type AzureResourceId = Brand<string, 'AzureResourceId'>;

// Host-Pool-Typ
export type HostPoolType = 'Personal' | 'Pooled';

// Load-Balancer-Typ fuer Pooled Host Pools
export type LoadBalancerType = 'BreadthFirst' | 'DepthFirst' | 'Persistent';

// Bevorzugter Application-Group-Typ
export type PreferredAppGroupType = 'Desktop' | 'RailApplications' | 'None';

// Session-Host-Status
export type SessionHostStatus =
  | 'Available'
  | 'Unavailable'
  | 'Shutdown'
  | 'Disconnected'
  | 'Upgrading'
  | 'UpgradeFailed'
  | 'NoHeartbeat'
  | 'NotJoinedToDomain'
  | 'DomainTrustRelationshipLost'
  | 'SxSStackListenerNotReady'
  | 'FSLogixNotHealthy'
  | 'NeedsAssistance';

// Session-Host-Health-Status
export type SessionHostHealthStatus =
  | 'Healthy'
  | 'Unhealthy'
  | 'NeedsAssistance'
  | 'SessionHostNotJoined';

// Benutzer-Session-Zustand
export type UserSessionState =
  | 'Active'
  | 'Disconnected'
  | 'Pending'
  | 'LogOff'
  | 'UserProfileDiskMounted';

// Host Pool (gespiegelt aus Azure)
export interface SyncedHostPool {
  id: HostPoolId;
  tenantId: TenantId;
  mspId: MspId;
  azureResourceId: AzureResourceId;
  azureSubscriptionId: AzureSubscriptionId;
  resourceGroupName: string;
  name: string;
  friendlyName: string | null;
  description: string | null;
  hostPoolType: HostPoolType;
  loadBalancerType: LoadBalancerType;
  maxSessionLimit: number;
  preferredAppGroupType: PreferredAppGroupType;
  validationEnvironment: boolean;
  startVMOnConnect: boolean;
  customRdpProperty: string | null;
  personalDesktopAssignmentType: 'Automatic' | 'Direct' | null;
  vmTemplate: string | null;
  sessionHostCount: number;
  activeSessionCount: number;
  syncedAt: Date;
}

// Session Host (gespiegelt aus Azure)
export interface SyncedSessionHost {
  id: SessionHostId;
  tenantId: TenantId;
  mspId: MspId;
  hostPoolId: HostPoolId;
  azureResourceId: AzureResourceId;
  vmResourceId: AzureResourceId | null;
  name: string;
  status: SessionHostStatus;
  healthStatus: SessionHostHealthStatus;
  allowNewSession: boolean;
  sessions: number;
  assignedUser: string | null;
  lastHeartbeat: Date | null;
  osVersion: string | null;
  sxSStackVersion: string | null;
  lastUpdateTime: Date | null;
  statusTimestamp: Date | null;
  vmId: string | null;
  resourceId: string;
  syncedAt: Date;
}

// Benutzer-Session
export interface UserSession {
  id: UserSessionId;
  sessionHostId: SessionHostId;
  hostPoolId: HostPoolId;
  userPrincipalName: string;
  activeDirectoryUserName: string | null;
  sessionState: UserSessionState;
  createTime: Date;
  applicationType: 'Desktop' | 'RemoteApp';
}

// Host-Pool-Zusammenfassung fuer Dashboard
export interface HostPoolSummary {
  id: HostPoolId;
  name: string;
  friendlyName: string | null;
  hostPoolType: HostPoolType;
  totalHosts: number;
  availableHosts: number;
  unavailableHosts: number;
  shutdownHosts: number;
  hostsInDrainMode: number;
  totalSessions: number;
  maxSessions: number;
  utilizationPercent: number;
}

// Session-Host-Aktion
export type SessionHostAction =
  | 'start'
  | 'stop'
  | 'restart'
  | 'enable-drain'
  | 'disable-drain';

// Job-Payloads fuer AVD-Aktionen
export interface StartSessionHostPayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  vmResourceId: string;
}

export interface StopSessionHostPayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  vmResourceId: string;
  force: boolean;
}

export interface SetDrainModePayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  allowNewSession: boolean;
}

export interface DisconnectSessionPayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  sessionId: string;
  userPrincipalName: string;
}

export interface LogoffSessionPayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  sessionId: string;
  userPrincipalName: string;
  force: boolean;
}

export interface SendMessagePayload {
  hostPoolId: string;
  hostPoolName: string;
  sessionHostId: string;
  sessionHostName: string;
  sessionId: string;
  userPrincipalName: string;
  messageTitle: string;
  messageBody: string;
}
