/**
 * Datenbank-Schema mit Drizzle ORM
 */

import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

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
