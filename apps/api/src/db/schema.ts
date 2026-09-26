/**
 * Datenbank-Schema mit Drizzle ORM
 */

import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, integer, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';

// MSP-Organisationen
export const mspOrganizations = pgTable('msp_organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  branding: jsonb('branding'),
  customDomain: varchar('custom_domain', { length: 255 }),
  subscriptionTier: varchar('subscription_tier', { length: 50 }).notNull().default('starter'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// MSP-Benutzer (Konsolen-Admins)
export const mspUsers = pgTable('msp_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  entraObjectId: varchar('entra_object_id', { length: 36 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('readonly'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Verwaltete Tenants
export const managedTenants = pgTable('managed_tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  microsoftTenantId: varchar('microsoft_tenant_id', { length: 36 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  primaryDomain: varchar('primary_domain', { length: 255 }).notNull(),
  authMethod: varchar('auth_method', { length: 20 }).notNull(),
  connectionStatus: varchar('connection_status', { length: 30 }).notNull().default('consent-required'),
  missingScopes: jsonb('missing_scopes').default([]),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
});

// Gespiegelte Benutzer
export const syncedUsers = pgTable('synced_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  tenantId: uuid('tenant_id').notNull().references(() => managedTenants.id),
  microsoftId: varchar('microsoft_id', { length: 36 }).notNull(),
  userPrincipalName: varchar('user_principal_name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  mail: varchar('mail', { length: 255 }),
  accountEnabled: boolean('account_enabled'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

// Jobs
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  tenantId: uuid('tenant_id').notNull().references(() => managedTenants.id),
  type: varchar('type', { length: 100 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  priority: varchar('priority', { length: 20 }).notNull().default('normal'),
  createdBy: uuid('created_by').notNull().references(() => mspUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  result: jsonb('result'),
  error: jsonb('error'),
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3),
  correlationId: uuid('correlation_id').notNull(),
  parentJobId: uuid('parent_job_id'),
  preview: jsonb('preview'),
});

// Audit-Eintraege (unveraenderlich)
export const auditEntries = pgTable('audit_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  tenantId: uuid('tenant_id').references(() => managedTenants.id),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  userId: uuid('user_id').notNull().references(() => mspUsers.id),
  action: varchar('action', { length: 100 }).notNull(),
  targetType: varchar('target_type', { length: 50 }).notNull(),
  targetId: varchar('target_id', { length: 100 }).notNull(),
  targetDisplayName: varchar('target_display_name', { length: 255 }),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  result: varchar('result', { length: 20 }).notNull(),
  errorMessage: text('error_message'),
  correlationId: uuid('correlation_id').notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
});

// Sync-State fuer Delta-Queries
export const syncStates = pgTable('sync_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  tenantId: uuid('tenant_id').notNull().references(() => managedTenants.id),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  deltaToken: text('delta_token'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncStatus: varchar('last_sync_status', { length: 20 }).notNull(),
  errorMessage: text('error_message'),
});

// KI-Erklaerungen zu CVEs. Global, weil sie ausschliesslich aus
// oeffentlichen Daten entstehen und keine Tenant-Bezuege enthalten.
export const cveExplanations = pgTable('cve_explanations', {
  cveId: varchar('cve_id', { length: 32 }).primaryKey(),
  language: varchar('language', { length: 8 }).notNull(),
  model: varchar('model', { length: 64 }).notNull(),
  inputHash: varchar('input_hash', { length: 64 }).notNull(),
  content: jsonb('content').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Bestands-Snapshot je Tenant und Bestandsart (Geraete, Schwachstellen).
// Ein Datensatz je Paar; der Stand liegt als Ganzes im Payload, ein
// fehlgeschlagener Sync laesst ihn stehen. Wird mit dem Tenant geloescht.
export const inventorySnapshots = pgTable(
  'inventory_snapshots',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => managedTenants.id, { onDelete: 'cascade' }),
    mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
    kind: varchar('kind', { length: 40 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    payload: jsonb('payload'),
    itemCount: integer('item_count').notNull().default(0),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    error: text('error'),
    unavailable: boolean('unavailable').notNull().default(false),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.kind] }),
  })
);

// Alerts aus dem Anmelde-Regelwerk. Ein Datensatz je Fingerabdruck und Tenant;
// wiederholte Treffer erhoehen occurrences statt neue Zeilen anzulegen.
export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => managedTenants.id, { onDelete: 'cascade' }),
    ruleId: varchar('rule_id', { length: 40 }).notNull(),
    severity: varchar('severity', { length: 10 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('open'),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    summary: text('summary').notNull(),
    userId: varchar('user_id', { length: 36 }),
    userPrincipalName: varchar('user_principal_name', { length: 255 }),
    evidence: jsonb('evidence').notNull().default({}),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    occurrences: integer('occurrences').notNull().default(1),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by').references(() => mspUsers.id),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueFingerprint: uniqueIndex('alerts_tenant_fingerprint').on(table.tenantId, table.fingerprint),
  })
);

// Paketkatalog je MSP: Manifest als typisiertes JSON, Artefakt und Installer
// liegen im Artefaktspeicher, hier nur Referenzen mit Hash.
export const appPackages = pgTable('app_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  manifest: jsonb('manifest').notNull(),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  artifact: jsonb('artifact'),
  installer: jsonb('installer'),
  buildLog: text('build_log'),
  buildError: text('build_error'),
  detectionKeyPath: text('detection_key_path'),
  // winget: zuletzt im Katalog gesehene Version
  latestVersion: varchar('latest_version', { length: 40 }),
  latestCheckedAt: timestamp('latest_checked_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => mspUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Paket x Tenant: welche Intune-App aus welchem Paket entstanden ist
export const appDeployments = pgTable(
  'app_deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
    packageId: uuid('package_id')
      .notNull()
      .references(() => appPackages.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => managedTenants.id, { onDelete: 'cascade' }),
    intuneAppId: varchar('intune_app_id', { length: 64 }),
    contentVersion: varchar('content_version', { length: 64 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    error: text('error'),
    jobId: uuid('job_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniquePackageTenant: uniqueIndex('app_deployments_package_tenant').on(table.packageId, table.tenantId),
  })
);

// Build-Auftraege fuer den Windows-Worker
export const buildJobs = pgTable('build_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  packageId: uuid('package_id')
    .notNull()
    .references(() => appPackages.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  workerId: varchar('worker_id', { length: 100 }),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  log: text('log'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================
// AVD-Tabellen (Azure Virtual Desktop)
// ============================================

// Gespiegelte Host Pools
export const syncedHostPools = pgTable('synced_host_pools', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  tenantId: uuid('tenant_id').notNull().references(() => managedTenants.id),
  azureResourceId: text('azure_resource_id').notNull().unique(),
  azureSubscriptionId: varchar('azure_subscription_id', { length: 36 }).notNull(),
  resourceGroupName: varchar('resource_group_name', { length: 90 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  friendlyName: varchar('friendly_name', { length: 255 }),
  description: text('description'),
  hostPoolType: varchar('host_pool_type', { length: 20 }).notNull(),
  loadBalancerType: varchar('load_balancer_type', { length: 20 }).notNull(),
  maxSessionLimit: integer('max_session_limit').notNull().default(999999),
  preferredAppGroupType: varchar('preferred_app_group_type', { length: 30 }).notNull(),
  validationEnvironment: boolean('validation_environment').notNull().default(false),
  startVmOnConnect: boolean('start_vm_on_connect').notNull().default(false),
  customRdpProperty: text('custom_rdp_property'),
  personalDesktopAssignmentType: varchar('personal_desktop_assignment_type', { length: 20 }),
  vmTemplate: text('vm_template'),
  sessionHostCount: integer('session_host_count').notNull().default(0),
  activeSessionCount: integer('active_session_count').notNull().default(0),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});

// Gespiegelte Session Hosts
export const syncedSessionHosts = pgTable('synced_session_hosts', {
  id: uuid('id').primaryKey().defaultRandom(),
  mspId: uuid('msp_id').notNull().references(() => mspOrganizations.id),
  tenantId: uuid('tenant_id').notNull().references(() => managedTenants.id),
  hostPoolId: uuid('host_pool_id').notNull().references(() => syncedHostPools.id),
  azureResourceId: text('azure_resource_id').notNull().unique(),
  vmResourceId: text('vm_resource_id'),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  healthStatus: varchar('health_status', { length: 30 }).notNull(),
  allowNewSession: boolean('allow_new_session').notNull().default(true),
  sessions: integer('sessions').notNull().default(0),
  assignedUser: varchar('assigned_user', { length: 255 }),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  osVersion: varchar('os_version', { length: 100 }),
  sxsStackVersion: varchar('sxs_stack_version', { length: 50 }),
  lastUpdateTime: timestamp('last_update_time', { withTimezone: true }),
  statusTimestamp: timestamp('status_timestamp', { withTimezone: true }),
  vmId: varchar('vm_id', { length: 100 }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});
