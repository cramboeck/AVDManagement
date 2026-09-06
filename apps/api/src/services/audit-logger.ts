/**
 * Audit-Logger Implementation
 */

import { db, auditEntries } from '../db/index.js';
import type { AuditLogger } from '@zerostress/core';
import type { MspId, TenantId, UserId, CorrelationId } from '@zerostress/types';

interface AuditLogEntry {
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
  ipAddress?: string;
  userAgent?: string;
}

export class DrizzleAuditLogger implements AuditLogger {
  async log(entry: AuditLogEntry): Promise<void> {
    await db.insert(auditEntries).values({
      mspId: entry.mspId,
      tenantId: entry.tenantId,
      userId: entry.userId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetDisplayName: entry.targetDisplayName,
      beforeState: entry.beforeState,
      afterState: entry.afterState,
      result: entry.result,
      errorMessage: entry.errorMessage,
      correlationId: entry.correlationId,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    });
  }
}
