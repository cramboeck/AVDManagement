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
  totalStorageBytes: number | null;
  freeStorageBytes: number | null;
  physicalMemoryBytes: number | null;
  wifiMacAddress: string | null;
}

export interface DeviceDefenderInfo {
  machineId: string;
  healthStatus: DeviceHealthStatus;
  exposureLevel: DeviceExposureLevel;
  riskScore: DeviceRiskScore;
  onboardingStatus: string | null;
  lastSeenAt: string | null;
  lastIpAddress: string | null;
  lastExternalIpAddress: string | null;
  osPlatform: string | null;
  osBuild: string | null;
  isAadJoined: boolean | null;
  tags: string[];
}

// Netzwerkschnittstellen laut Defender-Sensor (letzter bekannter Stand)
export interface DeviceNetworkInterface {
  ipAddress: string;
  macAddress: string | null;
  type: string | null;
  status: string | null;
}

export interface DeviceNetworkInfo {
  lastIpAddress: string | null;
  lastExternalIpAddress: string | null;
  interfaces: DeviceNetworkInterface[];
}

// Abgeleitete Topologie: oeffentliche IP = Standort, /24 = Subnetz
export interface NetworkTopologyDevice {
  id: string;
  name: string;
  ipAddress: string;
  operatingSystem: string | null;
  lastActivityAt: string | null;
}

export interface NetworkSubnet {
  cidr: string;
  devices: NetworkTopologyDevice[];
}

export interface NetworkSite {
  // null: Defender kennt keine externe Adresse
  externalIp: string | null;
  deviceCount: number;
  subnets: NetworkSubnet[];
}

export interface NetworkTopology {
  sites: NetworkSite[];
  // Geraete ohne bekannte interne Adresse (kein Defender oder nie gesehen)
  withoutAddress: NetworkTopologyDevice[];
  snapshot: SnapshotMeta | null;
  generatedAt: string;
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

export type InventoryKind = 'devices' | 'vulnerabilities' | 'groups' | 'mail' | 'apps' | 'sharepoint';

// ============================================
// SharePoint und OneDrive: Websites und externe Freigaben (Graph-Berichte)
// ============================================

export interface SharePointSite {
  siteId: string;
  url: string | null;
  kind: 'team' | 'communication' | 'classic' | 'onedrive' | 'other';
  template: string | null;
  ownerPrincipalName: string | null;
  ownerDisplayName: string | null;
  lastActivityAt: string | null;
  fileCount: number | null;
  activeFileCount: number | null;
  storageUsedBytes: number | null;
  storageAllocatedBytes: number | null;
  // Freigabelinks laut Bericht (je Website)
  secureLinkForGuestCount: number | null;
  secureLinkForMemberCount: number | null;
  anonymousLinkCount: number | null;
  companyLinkCount: number | null;
}

export interface SharingUser {
  userPrincipalName: string;
  lastActivityAt: string | null;
  sharedExternallyFileCount: number;
  sharedInternallyFileCount: number;
  viewedOrEditedFileCount: number;
}

export interface SharePointTotals {
  sites: number;
  teamSites: number;
  storageUsedBytes: number;
  sitesWithAnonymousLinks: number;
  sitesWithGuestLinks: number;
  usersSharingExternally: number;
  filesSharedExternally: number;
  inactiveSites90Days: number;
}

export interface SharePointOverviewSet {
  periodDays: number;
  refreshedAt: string | null;
  anonymised: boolean;
  sites: SharePointSite[];
  sharingUsers: SharingUser[];
  totals: SharePointTotals;
}

export type SharePointOverview = CapabilityResult<SharePointOverviewSet> & { snapshot?: SnapshotMeta };

// ============================================
// Apps (Intune-Anwendungen, Zuweisungen, Installationsstatus)
// ============================================

export type IntuneAppType =
  | 'win32LobApp'
  | 'winGetApp'
  | 'windowsMobileMSI'
  | 'officeSuiteApp'
  | 'windowsMicrosoftEdgeApp'
  | 'microsoftStoreForBusinessApp'
  | 'webApp'
  | 'windowsUniversalAppX'
  | 'other';

export type AppAssignmentIntent = 'required' | 'available' | 'uninstall' | 'availableWithoutEnrollment';
export type AppAssignmentTargetType = 'group' | 'exclusionGroup' | 'allUsers' | 'allDevices';

export interface AppAssignment {
  id: string;
  intent: AppAssignmentIntent;
  targetType: AppAssignmentTargetType;
  groupId: string | null;
  // Aus dem Gruppen-Snapshot aufgeloest; null, wenn unbekannt
  groupName: string | null;
  filterId: string | null;
  filterType: 'include' | 'exclude' | null;
}

export interface AppInstallSummary {
  installed: number;
  failed: number;
  pending: number;
  notInstalled: number;
  notApplicable: number;
}

export interface IntuneApp {
  id: string;
  displayName: string;
  publisher: string | null;
  type: IntuneAppType;
  version: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  isAssigned: boolean;
  assignments: AppAssignment[];
  // null: Bericht nicht verfuegbar
  install: AppInstallSummary | null;
}

export interface AppStats {
  total: number;
  assigned: number;
  withFailures: number;
  win32: number;
  winget: number;
}

export interface AppInventorySet {
  items: IntuneApp[];
  stats: AppStats;
  // Installationszahlen aus dem Intune-Bericht (kann fehlen)
  summaryAvailable: boolean;
}

export type AppInventory = CapabilityResult<AppInventorySet> & { snapshot?: SnapshotMeta };

export type AppInstallState = 'installed' | 'failed' | 'pending' | 'notInstalled' | 'notApplicable' | 'uninstallFailed' | 'unknown';

export interface AppDeviceStatus {
  deviceId: string | null;
  deviceName: string;
  userPrincipalName: string | null;
  installState: AppInstallState;
  installStateDetail: string | null;
  errorCode: string | null;
  // Klartext zu bekannten Intune-Fehlercodes
  errorHint: string | null;
  appVersion: string | null;
  lastModifiedAt: string | null;
}

export interface AppAssignmentInput {
  intent: AppAssignmentIntent;
  targetType: AppAssignmentTargetType;
  groupId: string | null;
  filterId?: string | null;
  filterType?: 'include' | 'exclude' | null;
}

// ============================================
// Exchange Online: Postfaecher und Mailaktivitaet (Graph-Berichte)
// ============================================

export type MailboxRecipientType = 'UserMailbox' | 'SharedMailbox' | 'RoomMailbox' | 'EquipmentMailbox' | 'unknown';

export interface MailboxUsage {
  userPrincipalName: string;
  displayName: string;
  recipientType: MailboxRecipientType;
  isDeleted: boolean;
  createdAt: string | null;
  lastActivityAt: string | null;
  itemCount: number | null;
  storageUsedBytes: number | null;
  warningQuotaBytes: number | null;
  prohibitSendQuotaBytes: number | null;
  prohibitSendReceiveQuotaBytes: number | null;
  // Belegung relativ zur Sendesperre in Prozent
  usagePercent: number | null;
  hasArchive: boolean | null;
  // Aus dem Aktivitaetsbericht des gleichen Zeitraums
  sentCount: number | null;
  receivedCount: number | null;
  readCount: number | null;
}

export interface MailActivityDay {
  date: string;
  sent: number;
  received: number;
  read: number;
}

export interface MailStorageDay {
  date: string;
  storageUsedBytes: number;
}

export interface MailTotals {
  mailboxes: number;
  userMailboxes: number;
  sharedMailboxes: number;
  storageUsedBytes: number;
  over80Percent: number;
  over95Percent: number;
  inactive30Days: number;
  sentInPeriod: number;
  receivedInPeriod: number;
}

export interface MailOverviewSet {
  periodDays: number;
  // Stand des Berichts laut Microsoft (Berichte laufen etwa 48 Stunden nach)
  refreshedAt: string | null;
  // true: der Tenant verbirgt Namen in Berichten (Einstellung "Anzeigenamen verbergen")
  anonymised: boolean;
  totals: MailTotals;
  mailboxes: MailboxUsage[];
  activityByDay: MailActivityDay[];
  storageByDay: MailStorageDay[];
}

export type MailOverview = CapabilityResult<MailOverviewSet> & { snapshot?: SnapshotMeta };

// Postfachdetail: Einstellungen und Posteingangsregeln live aus Graph
// (MailboxSettings.Read / MailboxSettings.ReadWrite)

export type AutoReplyStatus = 'disabled' | 'alwaysEnabled' | 'scheduled';
export type AutoReplyAudience = 'none' | 'contactsOnly' | 'all';

export interface MailboxAutoReply {
  status: AutoReplyStatus;
  externalAudience: AutoReplyAudience;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  internalMessage: string;
  externalMessage: string;
}

export interface MailboxSettingsInfo {
  autoReply: MailboxAutoReply;
  timeZone: string | null;
  language: string | null;
  // user, shared, room, equipment, others, unknown
  userPurpose: string | null;
}

export type InboxRuleActionKind = 'forward' | 'forwardAsAttachment' | 'redirect' | 'delete' | 'move' | 'markAsRead' | 'permanentDelete' | 'other';

export interface InboxRuleAction {
  kind: InboxRuleActionKind;
  recipients: string[];
}

export interface InboxRule {
  id: string;
  displayName: string;
  sequence: number;
  isEnabled: boolean;
  hasError: boolean;
  isReadOnly: boolean;
  actions: InboxRuleAction[];
  conditions: string[];
  // Alle Adressen, an die die Regel weiterleitet oder umleitet
  forwardsTo: string[];
  // Mindestens ein Ziel liegt ausserhalb der Tenant-Domaenen
  forwardsExternally: boolean;
}

export interface MailboxDetail {
  userPrincipalName: string;
  displayName: string;
  userId: string | null;
  mail: string | null;
  aliases: string[];
  accountEnabled: boolean | null;
  // Aus dem Nutzungsbericht (Snapshot), null wenn dort nicht enthalten
  usage: MailboxUsage | null;
  settings: CapabilityResult<MailboxSettingsInfo>;
  rules: CapabilityResult<InboxRule[]>;
}

export interface ForwardingFinding {
  userPrincipalName: string;
  displayName: string;
  rule: InboxRule;
}

export interface ForwardingScan {
  scannedMailboxes: number;
  failedMailboxes: number;
  tenantDomains: string[];
  findings: ForwardingFinding[];
  externalCount: number;
  scannedAt: string;
}

// ============================================
// Apps: Paketkatalog (Stufe C) und Build-Worker (Stufe D)
// ============================================

export type PackageInstallerType = 'msi' | 'exe' | 'psadt' | 'intunewin' | 'winget';
export type PackageArchitecture = 'x64' | 'x86' | 'arm64' | 'neutral';
export type DetectionOperator = 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';

export type AppDetectionRule =
  | { type: 'registry'; keyPath: string; valueName: string | null; detectionType: 'exists' | 'string' | 'version' | 'integer'; operator: DetectionOperator | null; value: string | null; check32BitOn64System: boolean }
  | { type: 'msi'; productCode: string; productVersion: string | null; operator: DetectionOperator | null }
  | { type: 'file'; path: string; fileOrFolderName: string; detectionType: 'exists' | 'version' | 'sizeInMB' | 'modifiedDate' | 'createdDate'; operator: DetectionOperator | null; value: string | null; check32BitOn64System: boolean }
  | { type: 'script'; script: string; enforceSignatureCheck: boolean; runAs32Bit: boolean };

export type ReturnCodeType = 'success' | 'softReboot' | 'hardReboot' | 'retry' | 'failed';

export interface AppManifest {
  schemaVersion: 1;
  vendor: string;
  name: string;
  version: string;
  architecture: PackageArchitecture;
  language: string;
  revision: string;
  installerType: PackageInstallerType;
  // Dateiname des Installers im Paket (msi/exe/psadt), null bei winget
  installerFileName: string | null;
  // msi/exe/intunewin: vollstaendige Intune-Kommandozeilen.
  // psadt: installCommand = stille Parameter des Installers, die der Wrapper
  // anhaengt; uninstallCommand = optionale Deinstallationszeile, die der
  // Wrapper ausfuehrt. Die Intune-Kommandozeile ist bei psadt immer der Wrapper.
  installCommand: string | null;
  uninstallCommand: string | null;
  msiProductCode: string | null;
  processesToClose: string[];
  detection: AppDetectionRule[];
  requirements: {
    minimumWindowsRelease: string | null;
    architecture: 'x64' | 'x86' | 'both';
    minDiskMb: number | null;
    minRamMb: number | null;
  };
  returnCodes: { code: number; type: ReturnCodeType }[];
  restartBehavior: 'basedOnReturnCode' | 'allow' | 'suppress' | 'force';
  installContext: 'system' | 'user';
  description: string;
  publisher: string;
  informationUrl: string | null;
  privacyUrl: string | null;
  owner: string | null;
  notes: string | null;
  // Nur bei installerType winget
  wingetPackageIdentifier: string | null;
}

export type PackageStatus = 'draft' | 'installer-uploaded' | 'queued' | 'building' | 'ready' | 'failed';

export interface StoredFile {
  fileName: string;
  sha256: string;
  sizeBytes: number;
  storageKey: string;
  uploadedAt: string;
}

export interface AppPackage {
  id: string;
  manifest: AppManifest;
  status: PackageStatus;
  // Fertiges .intunewin, fuer winget nicht noetig
  artifact: StoredFile | null;
  // Roh-Installer fuer den Build-Worker
  installer: StoredFile | null;
  buildLog: string | null;
  buildError: string | null;
  // Erkennungsschluessel, den der Worker in das Paket schreibt (psadt)
  detectionKeyPath: string | null;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  deployments: AppDeployment[];
}

export type DeploymentStatus = 'pending' | 'publishing' | 'published' | 'failed' | 'superseded';

export interface AppDeployment {
  id: string;
  packageId: string;
  tenantId: TenantId;
  tenantDisplayName: string;
  intuneAppId: string | null;
  contentVersion: string | null;
  status: DeploymentStatus;
  error: string | null;
  jobId: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export type BuildStatus = 'queued' | 'claimed' | 'building' | 'succeeded' | 'failed';

export interface BuildJob {
  id: string;
  packageId: string;
  status: BuildStatus;
  workerId: string | null;
  claimedAt: string | null;
  finishedAt: string | null;
  log: string | null;
  error: string | null;
  createdAt: string;
}

/**
 * Bauplan, den der Windows-Worker beim Claim erhaelt. Alles, was der
 * Worker braucht, steht hier; er liest weder DB noch Manifest-Rohdaten.
 */
export interface BuildPlan {
  buildId: string;
  packageId: string;
  packageIdentifier: string;
  displayName: string;
  manifest: AppManifest;
  installer: Pick<StoredFile, 'fileName' | 'sha256' | 'sizeBytes'>;
  // psadt: Wrapper erzeugen; plain: Installer unveraendert verpacken
  wrapper: 'psadt' | 'plain';
  // Datei, die IntuneWinAppUtil als Setup-Datei bekommt
  setupFile: string;
  // Registry-Marker in PowerShell-Schreibweise (HKLM:\...), null ohne Wrapper
  markerKeyPath: string | null;
  installerArguments: string;
  uninstallCommand: string | null;
  processesToClose: string[];
  artifactFileName: string;
}

// ============================================
// Remotehilfe (TeamViewer)
// ============================================

export interface RemoteSupportMatch {
  provider: 'teamviewer';
  found: boolean;
  deviceId: string | null;
  alias: string | null;
  online: boolean | null;
  // URI fuer den Client auf dem Technikerrechner
  uri: string | null;
  // Diagnose: wie viele Geraete die Liste hat bzw. wie viele auf den Namen passen
  candidates: number;
}

// ============================================
// Alerts: Auffaelligkeiten bei Anmeldungen (Regelwerk, kein ML)
// ============================================

export type AlertSeverity_ = 'high' | 'medium' | 'low';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export type AnomalyRuleId = 'failed-burst' | 'password-spray' | 'success-after-failures' | 'country-hop' | 'legacy-auth-success' | 'risky-success';

export interface AnomalyFinding {
  ruleId: AnomalyRuleId;
  severity: AlertSeverity_;
  // Stabil je Regel, Benutzer und Tag, damit derselbe Vorfall nicht mehrfach alarmiert
  fingerprint: string;
  title: string;
  summary: string;
  userId: string | null;
  userPrincipalName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  evidence: Record<string, string | number | string[] | null>;
}

export interface Alert {
  id: string;
  tenantId: TenantId;
  ruleId: AnomalyRuleId;
  severity: AlertSeverity_;
  status: AlertStatus;
  title: string;
  summary: string;
  userId: string | null;
  userPrincipalName: string | null;
  evidence: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  notifiedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

// ============================================
// Best-Practice-Checks je Tenant (eigener Katalog aus Microsoft-Doku)
// ============================================

export type SecurityCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'not-applicable';
export type SecurityCheckCategory = 'identity' | 'access' | 'governance' | 'devices' | 'mail';

export interface SecurityCheck {
  id: string;
  category: SecurityCheckCategory;
  title: string;
  status: SecurityCheckStatus;
  // Ein Satz zum Befund
  summary: string;
  // Was zu tun ist
  recommendation: string;
  // Belege, die der Admin nachvollziehen kann (Zahlen, Namen von Richtlinien)
  evidence: Record<string, string | number | boolean | null>;
  docsUrl: string | null;
  // 1 = Hinweis, 3 = wesentlich
  weight: 1 | 2 | 3;
}

export interface SecurityCheckReport {
  checks: SecurityCheck[];
  counts: Record<SecurityCheckStatus, number>;
  // Punkte der bestandenen Checks relativ zu allen bewertbaren
  scorePercent: number | null;
  // Quellen, die nicht lesbar waren, mit Grund
  unavailableSources: { source: string; reason: CapabilityUnavailableReason; missingPermission: string | null; detail: string | null }[];
  generatedAt: string;
}

// ============================================
// Gruppen (Teams, Microsoft 365, Sicherheit, Verteiler)
// ============================================

export type GroupKind = 'team' | 'microsoft365' | 'security' | 'distribution' | 'mail-enabled-security';
export type GroupVisibility = 'Public' | 'Private' | 'HiddenMembership' | 'unknown';

// Auffaelligkeiten, die ein Admin sehen will
export type GroupFlag = 'ownerless' | 'single-owner' | 'public-team' | 'has-guests' | 'dynamic' | 'empty';

export interface GroupSummary {
  id: string;
  displayName: string;
  description: string | null;
  kind: GroupKind;
  visibility: GroupVisibility;
  mail: string | null;
  createdAt: string | null;
  renewedAt: string | null;
  isDynamic: boolean;
  onPremisesSynced: boolean;
  ownerCount: number;
  // null: Zaehlung nicht moeglich (Throttling, Berechtigung)
  memberCount: number | null;
  guestCount: number | null;
  flags: GroupFlag[];
}

export interface GroupStats {
  total: number;
  teams: number;
  microsoft365: number;
  security: number;
  distribution: number;
  ownerless: number;
  withGuests: number;
  publicTeams: number;
  dynamic: number;
}

export interface GroupInventorySet {
  items: GroupSummary[];
  stats: GroupStats;
  // Zaehlungen fehlen bei sehr grossen Tenants ab einer Obergrenze
  countsTruncated: boolean;
}

export type GroupInventory = CapabilityResult<GroupInventorySet> & { snapshot?: SnapshotMeta };

export type GroupMemberType = 'user' | 'guest' | 'group' | 'servicePrincipal' | 'device' | 'other';

export interface GroupMember {
  id: string;
  displayName: string;
  userPrincipalName: string | null;
  type: GroupMemberType;
  accountEnabled: boolean | null;
}

export interface GroupDetail {
  group: GroupSummary;
  owners: GroupMember[];
  members: GroupMember[];
  membersTruncated: boolean;
}

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

// ============================================
// Skriptbibliothek (Intune Remediations auf Abruf)
// ============================================

export type LibraryScriptId = 'update-status' | 'update-scan' | 'system-info' | 'winget-updates' | 'network-info' | 'storage-info' | 'local-admins' | 'battery-info';

// Vom Intune-Client erkannte Software (Inventar, wird woechentlich gemeldet)
export interface DetectedApp {
  id: string;
  displayName: string;
  version: string | null;
  publisher: string | null;
  platform: string | null;
  sizeBytes: number | null;
  source: 'intune' | 'defender';
}

export interface DeviceSoftwareSet {
  items: DetectedApp[];
  intune: CapabilityResult<{ count: number }>;
  defender: CapabilityResult<{ count: number }>;
}

export type DeviceSoftwareInventory = CapabilityResult<DeviceSoftwareSet>;

export interface ScriptLibraryEntry {
  id: LibraryScriptId;
  displayName: string;
  description: string;
  version: string;
  // SHA-256 ueber Version, Erkennungs- und Behebungsskript
  hash: string;
  runAsAccount: 'system';
  // true: das Skript veraendert etwas auf dem Geraet (Behebungsteil vorhanden)
  hasRemediation: boolean;
  // Was die Behebung tut, fuer die Preview
  remediationSummary: string | null;
  expectedDurationSeconds: number;
  // true: Ausgabe enthaelt personenbezogene Daten; Ergebnis wird verschluesselt gespeichert
  containsPersonalData: boolean;
}

// in-sync: Tenant hat genau diese Version; outdated: aeltere Version im Tenant;
// missing: wird beim ersten Lauf angelegt
export type TenantScriptState = 'in-sync' | 'outdated' | 'missing';

export interface TenantScriptStatus extends ScriptLibraryEntry {
  tenantState: TenantScriptState;
  tenantScriptId: string | null;
  tenantHash: string | null;
  tenantModifiedAt: string | null;
}

export type ScriptLibraryStatus = CapabilityResult<TenantScriptStatus[]>;

export type RemediationRunState =
  | 'unknown'
  | 'success'
  | 'fail'
  | 'scriptError'
  | 'pending'
  | 'notApplicable'
  | 'skipped'
  | 'remediationFailed';

export interface ScriptRunResult {
  scriptId: LibraryScriptId;
  version: string;
  hash: string;
  tenantScriptId: string;
  managedDeviceId: string;
  requestedAt: string;
  completedAt: string;
  detectionState: RemediationRunState;
  remediationState: RemediationRunState;
  // Ausgabe der Erkennung nach der Behebung, sonst davor
  output: string | null;
  // Ausgabe, wenn sie gueltiges JSON ist
  outputJson: Record<string, unknown> | null;
  detectionError: string | null;
  remediationError: string | null;
  deviceReportedAt: string | null;
  // true: Wartezeit abgelaufen, gezeigt wird der letzte bekannte Zustand
  possiblyStale: boolean;
  stateSource: 'device' | 'script' | 'run-command';
  // true: output, outputJson und Fehlertexte liegen verschluesselt in cipher
  sealed?: boolean;
  cipher?: SealedCipher | null;
  // true: Klartext nach Aufbewahrungsfrist geloescht
  purged?: boolean;
}

export interface SealedCipher {
  alg: 'aes-256-gcm';
  keyId: string;
  iv: string;
  tag: string;
  data: string;
}

// Entschluesselter Teil eines versiegelten Ergebnisses
export interface RevealedScriptResult {
  output: string | null;
  outputJson: Record<string, unknown> | null;
  detectionError: string | null;
  remediationError: string | null;
}

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

export interface AlertStats {
  open: number;
  high: number;
  medium: number;
  low: number;
}

export interface TenantDashboard {
  tenant: ManagedTenant;
  avd: DashboardTile<AvdOverview>;
  users: DashboardTile<UserStats>;
  security: DashboardTile<SecurityOverview>;
  jobs: DashboardTile<JobStats>;
  alerts: DashboardTile<AlertStats>;
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
