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
// Identity: Detail, Sicherheit, Protokolle
// ============================================

// Optionale Datenquelle (Lizenz oder Berechtigung koennen fehlen)
export type CapabilityUnavailableReason =
  | 'premium-required'
  | 'permission-missing'
  | 'not-licensed'
  | 'not-onboarded';

export type CapabilityResult<T> =
  | { available: true; data: T }
  | {
      available: false;
      reason: CapabilityUnavailableReason;
      missingPermission: string | null;
      detail: string | null;
    };

export interface UserSignInActivity {
  lastSignInAt: string | null;
  lastNonInteractiveSignInAt: string | null;
}

export interface UserDetail extends SyncedUser {
  jobTitle: string | null;
  department: string | null;
  officeLocation: string | null;
  mobilePhone: string | null;
  businessPhones: string[];
  city: string | null;
  country: string | null;
  usageLocation: string | null;
  onPremisesSyncEnabled: boolean;
  lastPasswordChangeAt: string | null;
  // null, wenn AuditLog.Read.All oder Entra ID P1 fehlt
  signInActivity: UserSignInActivity | null;
}

export type UserGroupKind = 'security' | 'microsoft365' | 'distribution' | 'mail-enabled-security';

export interface UserGroup {
  id: string;
  displayName: string;
  kind: UserGroupKind;
}

export type AuthenticationMethodKind =
  | 'password'
  | 'microsoft-authenticator'
  | 'phone'
  | 'fido2'
  | 'windows-hello'
  | 'software-oath'
  | 'email'
  | 'temporary-access-pass'
  | 'unknown';

export interface AuthenticationMethod {
  id: string;
  kind: AuthenticationMethodKind;
  displayName: string | null;
  detail: string | null;
  isPhishingResistant: boolean;
  countsAsMfa: boolean;
}

export interface AuthenticationMethodsSummary {
  methods: AuthenticationMethod[];
  mfaCapable: boolean;
  phishingResistant: boolean;
}

export type SignInOutcome = 'success' | 'failure' | 'interrupted';

export interface SignInEvent {
  id: string;
  createdAt: string;
  userId: string;
  userPrincipalName: string;
  userDisplayName: string;
  appDisplayName: string;
  clientAppUsed: string | null;
  ipAddress: string | null;
  location: { city: string | null; state: string | null; countryOrRegion: string | null } | null;
  outcome: SignInOutcome;
  errorCode: number;
  failureReason: string | null;
  conditionalAccessStatus: 'success' | 'failure' | 'notApplied' | 'unknown';
  authenticationRequirement: 'singleFactorAuthentication' | 'multiFactorAuthentication' | 'unknown';
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'hidden' | 'unknown';
  isInteractive: boolean;
  device: {
    operatingSystem: string | null;
    browser: string | null;
    isCompliant: boolean | null;
    isManaged: boolean | null;
    trustType: string | null;
  } | null;
}

export interface SignInQuery {
  userId?: string;
  top?: number;
  since?: string;
  failuresOnly?: boolean;
}

export interface DirectoryAuditModifiedProperty {
  name: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface DirectoryAuditTarget {
  id: string | null;
  displayName: string | null;
  type: string | null;
  userPrincipalName: string | null;
  modifiedProperties: DirectoryAuditModifiedProperty[];
}

export interface DirectoryAuditEvent {
  id: string;
  activityAt: string;
  activity: string;
  category: string;
  result: 'success' | 'failure' | 'timeout' | 'unknown';
  resultReason: string | null;
  initiatedBy: {
    kind: 'user' | 'app' | 'unknown';
    displayName: string | null;
    userPrincipalName: string | null;
  };
  targets: DirectoryAuditTarget[];
}

export interface DirectoryAuditQuery {
  userId?: string;
  top?: number;
  since?: string;
}

// ============================================
// Geraete (Intune + Defender for Endpoint)
// ============================================

export type DeviceComplianceState =
  | 'compliant'
  | 'noncompliant'
  | 'inGracePeriod'
  | 'conflict'
  | 'error'
  | 'notApplicable'
  | 'unknown';

export type DeviceExposureLevel = 'None' | 'Low' | 'Medium' | 'High' | 'Unknown';
export type DeviceRiskScore = 'None' | 'Informational' | 'Low' | 'Medium' | 'High' | 'Unknown';
export type DeviceHealthStatus =
  | 'Active'
  | 'Inactive'
  | 'ImpairedCommunication'
  | 'NoSensorData'
  | 'NoSensorDataImpairedCommunication'
  | 'Unknown';

export interface DeviceIntuneInfo {
  managedDeviceId: string;
  complianceState: DeviceComplianceState;
  lastSyncAt: string | null;
  enrolledAt: string | null;
  ownerType: string | null;
  isEncrypted: boolean | null;
  model: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
  managementAgent: string | null;
}

export interface DeviceDefenderInfo {
  machineId: string;
  healthStatus: DeviceHealthStatus;
  exposureLevel: DeviceExposureLevel;
  riskScore: DeviceRiskScore;
  onboardingStatus: string | null;
  lastSeenAt: string | null;
  lastIpAddress: string | null;
  osPlatform: string | null;
  osBuild: string | null;
  isAadJoined: boolean | null;
  tags: string[];
}

// Zusammengefuehrtes Geraet; id ist die Entra-Geraete-ID oder ein Quell-Praefix
export interface Device {
  id: string;
  name: string;
  azureAdDeviceId: string | null;
  operatingSystem: string | null;
  osVersion: string | null;
  primaryUser: string | null;
  lastActivityAt: string | null;
  intune: DeviceIntuneInfo | null;
  defender: DeviceDefenderInfo | null;
}

export interface DeviceInventory {
  items: Device[];
  intune: CapabilityResult<{ count: number }>;
  defender: CapabilityResult<{ count: number }>;
  // Gesetzt, wenn die Antwort aus dem Bestands-Snapshot stammt
  snapshot?: SnapshotMeta;
}

// ============================================
// Bestands-Snapshot (Cache je Tenant)
// ============================================

export type InventoryKind = 'devices' | 'vulnerabilities';

// missing: noch nie geladen; running: Sync laeuft; ready: Stand vorhanden;
// error: letzter Sync fehlgeschlagen (ein aelterer Stand kann trotzdem vorliegen)
export type SnapshotStatus = 'missing' | 'running' | 'ready' | 'error';

export interface SnapshotMeta {
  kind: InventoryKind;
  status: SnapshotStatus;
  // Zeitpunkt des letzten erfolgreichen Stands
  syncedAt: string | null;
  startedAt: string | null;
  durationMs: number | null;
  itemCount: number;
  error: string | null;
  // Aelter als das Zielintervall dieser Bestandsart
  stale: boolean;
  // Gerade aus Microsoft geladen statt aus dem Snapshot
  live: boolean;
}

export interface TenantInventoryStatus {
  tenantId: TenantId;
  snapshots: SnapshotMeta[];
  generatedAt: string;
}

export interface TenantVulnerabilitySet {
  items: TenantVulnerability[];
  truncated: boolean;
}

export type TenantVulnerabilityList = CapabilityResult<TenantVulnerabilitySet> & { snapshot?: SnapshotMeta };

export type VulnerabilitySeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Unknown';

export interface DeviceVulnerability {
  cveId: string;
  name: string;
  severity: VulnerabilitySeverity;
  cvssScore: number | null;
  publishedAt: string | null;
  updatedAt: string | null;
  publicExploit: boolean;
  exploitVerified: boolean;
  description: string | null;
}

export interface MissingKb {
  id: string;
  name: string;
  osBuild: string | null;
  products: string[];
  url: string | null;
  cveAddressed: number;
  missingSince: string | null;
}

// Verwundbare Software auf einem Geraet, aus den Schwachstellenzeilen abgeleitet
export interface VulnerableSoftware {
  vendor: string | null;
  name: string;
  version: string | null;
  cveCount: number;
  highestSeverity: VulnerabilitySeverity;
  fixingKbIds: string[];
}

export interface DeviceSecurityPosture {
  vulnerabilities: CapabilityResult<DeviceVulnerability[]>;
  missingKbs: CapabilityResult<MissingKb[]>;
  // 'derived': aus den Schwachstellen des Geraets abgeleitet, weil der KB-Endpunkt nicht verfuegbar war
  missingKbsSource: 'defender' | 'derived' | null;
  software: CapabilityResult<VulnerableSoftware[]>;
}

// Schwachstelle aus Sicht des Tenants (Defender)
export interface VulnerabilityDetail {
  cveId: string;
  name: string;
  description: string | null;
  severity: VulnerabilitySeverity;
  cvssScore: number | null;
  cvssVector: string | null;
  exposedMachines: number;
  publishedAt: string | null;
  updatedAt: string | null;
  firstDetectedAt: string | null;
  publicExploit: boolean;
  exploitVerified: boolean;
  exploitInKit: boolean;
  exploitTypes: string[];
  exploitUrls: string[];
  epssFromDefender: number | null;
}

export interface VulnerabilityMachineRef {
  machineId: string;
  name: string;
  osPlatform: string | null;
  rbacGroupName: string | null;
  detectedAt: string | null;
  // Betroffene Software auf diesem Geraet (aus den Schwachstellenzeilen)
  products: { name: string; version: string | null; fixingKbId: string | null }[];
}

export interface TenantVulnerability {
  cveId: string;
  severity: VulnerabilitySeverity;
  deviceCount: number;
  products: string[];
  fixingKbIds: string[];
}

export interface KevEntry {
  dateAdded: string;
  dueDate: string | null;
  requiredAction: string | null;
  knownRansomwareUse: boolean;
  vendorProject: string | null;
  product: string | null;
}

export interface EpssScore {
  probability: number;
  percentile: number;
  date: string;
}

export interface NvdSummary {
  description: string | null;
  cvssScore: number | null;
  cvssSeverity: string | null;
  cvssVector: string | null;
  cweIds: string[];
  publishedAt: string | null;
  lastModifiedAt: string | null;
  references: { url: string; source: string | null; tags: string[] }[];
}

export interface EnrichmentSource<T> {
  status: 'ok' | 'not-listed' | 'error';
  data: T | null;
  reason: string | null;
  fetchedAt: string;
}

export interface CveEnrichment {
  kev: EnrichmentSource<KevEntry>;
  epss: EnrichmentSource<EpssScore>;
  nvd: EnrichmentSource<NvdSummary>;
  msrcUrl: string;
  nvdUrl: string;
}

export interface CveExplanation {
  cveId: string;
  language: string;
  model: string;
  summary: string;
  attackPath: string;
  remediation: string[];
  urgency: 'sofort' | 'diese-woche' | 'naechster-patchzyklus' | 'informativ';
  urgencyReason: string;
  customerNote: string;
  sources: string[];
  generatedAt: string;
}

export interface CveDetail {
  cveId: string;
  defender: CapabilityResult<VulnerabilityDetail>;
  machines: CapabilityResult<VulnerabilityMachineRef[]>;
  enrichment: CveEnrichment;
  explanation: CveExplanation | null;
  explanationAvailable: boolean;
}

// ============================================
// Wiederherstellung: BitLocker- und LAPS-Schluessel
// Metadaten und Geheimnisse sind getrennte Typen; Geheimnisse werden nie
// gelistet, exportiert oder protokolliert.
// ============================================

export interface BitLockerKeyMetadata {
  id: string;
  createdAt: string;
  volumeType: 'operatingSystemVolume' | 'fixedDataVolume' | 'removableDataVolume' | 'unknown';
}

export interface LapsMetadata {
  deviceName: string | null;
  lastBackupAt: string | null;
  refreshAt: string | null;
}

export interface DeviceRecoveryMetadata {
  azureAdDeviceId: string | null;
  bitlocker: CapabilityResult<BitLockerKeyMetadata[]>;
  laps: CapabilityResult<LapsMetadata>;
}

export interface RevealedBitLockerKey {
  id: string;
  key: string;
  volumeType: BitLockerKeyMetadata['volumeType'];
  revealedAt: string;
}

export interface RevealedLocalCredential {
  accountName: string;
  password: string;
  backupAt: string | null;
}

export interface RevealedLaps {
  deviceName: string | null;
  credentials: RevealedLocalCredential[];
  revealedAt: string;
}

// ============================================
// Sicherheitslage (Security Posture)
// ============================================

export interface SecureScoreSummary {
  currentScore: number;
  maxScore: number;
  percent: number;
  createdAt: string;
  // Vergleichswerte von Microsoft (alle Tenants, gleiche Groesse, Branche)
  comparisons: { basis: string; averagePercent: number }[];
  // Verbesserungsmassnahmen mit dem groessten Punktgewinn (aus den Control-Profilen)
  topImprovements: SecureScoreImprovement[];
}

export interface SecureScoreImprovement {
  control: string;
  title: string;
  category: string;
  currentScore: number;
  maxScore: number;
  scoreGain: number;
  implementationStatus: string | null;
  userImpact: string | null;
  implementationCost: string | null;
  actionUrl: string | null;
  remediation: string | null;
}

export interface ExposureScoreSummary {
  score: number;
  measuredAt: string | null;
}

export interface MfaRegistrationSummary {
  totalUsers: number;
  mfaRegistered: number;
  mfaCapable: number;
  passwordlessCapable: number;
  ssprRegistered: number;
  admins: number;
  adminsWithoutMfa: number;
}

export type AlertSeverity = 'high' | 'medium' | 'low' | 'informational' | 'unknown';

export interface OpenAlertsSummary {
  total: number;
  bySeverity: Record<AlertSeverity, number>;
  newest: { id: string; title: string; severity: AlertSeverity; createdAt: string; source: string | null }[];
}

export interface DistributionBucket {
  key: string;
  label: string;
  count: number;
}

export interface SignInsByDay {
  day: string;
  success: number;
  failure: number;
  interrupted: number;
}

export interface SecurityPosture {
  secureScore: CapabilityResult<SecureScoreSummary>;
  exposureScore: CapabilityResult<ExposureScoreSummary>;
  mfa: CapabilityResult<MfaRegistrationSummary>;
  alerts: CapabilityResult<OpenAlertsSummary>;
  devices: CapabilityResult<{
    total: number;
    compliance: DistributionBucket[];
    exposure: DistributionBucket[];
    osVersions: DistributionBucket[];
  }>;
  vulnerabilities: CapabilityResult<{ bySeverity: DistributionBucket[]; truncated: boolean }>;
  signIns: CapabilityResult<{ days: SignInsByDay[]; sampled: boolean }>;
  generatedAt: string;
}

// ============================================
// Dashboard
// ============================================

export type DashboardTileStatus = 'ok' | 'unavailable' | 'error';

export interface DashboardTile<T> {
  status: DashboardTileStatus;
  data: T | null;
  // Maschinenlesbarer Grund bei unavailable/error (z. B. premium-required, timeout)
  reason: string | null;
}

export interface AvdOverview {
  hostPools: number;
  totalHosts: number;
  availableHosts: number;
  unavailableHosts: number;
  shutdownHosts: number;
  drainingHosts: number;
  activeSessions: number;
  maxSessions: number;
  warnings: string[];
}

export interface UserStats {
  total: number;
  disabled: number;
  guests: number;
}

export interface SecurityOverview {
  windowHours: number;
  signIns: number;
  failures: number;
  usersWithFailures: number;
  legacyAuthSuccesses: number;
  riskySuccesses: number;
}

export interface JobStats {
  pendingApproval: number;
  running: number;
  failedLast24h: number;
  completedLast24h: number;
}

export interface TenantDashboard {
  tenant: ManagedTenant;
  avd: DashboardTile<AvdOverview>;
  users: DashboardTile<UserStats>;
  security: DashboardTile<SecurityOverview>;
  jobs: DashboardTile<JobStats>;
  // Anzahl der Punkte, die Aufmerksamkeit brauchen (Sortierschluessel)
  attention: number;
  generatedAt: string;
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
