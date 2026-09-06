/**
 * Job-Handler fuer Identity-Modul
 */

import type { TenantId, MspId, UserId } from '@zerostress/types';
import {
  registerJob,
  type JobContext,
  type JobResult,
  type PreviewContext,
  type PreviewResult,
} from './job-types.js';
import { IdentityProvider } from '../providers/identity-provider.js';
import { GraphClient } from '../providers/graph-client.js';

// Payload-Typen
interface AssignLicensePayload {
  userId: string;
  userDisplayName: string;
  skuId: string;
  skuDisplayName: string;
}

interface RemoveLicensePayload {
  userId: string;
  userDisplayName: string;
  skuId: string;
  skuDisplayName: string;
}

/**
 * Lizenz zuweisen - Job-Handler
 */
export function createAssignLicenseHandler(
  identityProvider: IdentityProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload as AssignLicensePayload;

    try {
      await identityProvider.assignLicense(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.userId,
        payload.skuId
      );

      return {
        success: true,
        data: {
          userId: payload.userId,
          skuId: payload.skuId,
          assignedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'LICENSE_ASSIGNMENT_FAILED',
          message,
          retryable: false,
        },
      };
    }
  };
}

/**
 * Lizenz zuweisen - Preview-Generator
 */
export function createAssignLicensePreviewGenerator(
  identityProvider: IdentityProvider
): (ctx: PreviewContext) => Promise<PreviewResult> {
  return async (ctx: PreviewContext): Promise<PreviewResult> => {
    const payload = ctx.payload as AssignLicensePayload;
    const warnings: string[] = [];

    const currentLicenses = await identityProvider.getUserLicenses(
      { tenantId: ctx.tenantId, correlationId: crypto.randomUUID() },
      payload.userId
    );

    const alreadyAssigned = currentLicenses.some((l) => l.skuId === payload.skuId);
    if (alreadyAssigned) {
      warnings.push(`Benutzer hat die Lizenz "${payload.skuDisplayName}" bereits zugewiesen.`);
    }

    return {
      changes: [
        {
          objectType: 'user-license',
          objectId: `${payload.userId}:${payload.skuId}`,
          objectDisplayName: `${payload.userDisplayName} - ${payload.skuDisplayName}`,
          action: 'create',
          before: {
            licenses: currentLicenses.map((l) => l.skuPartNumber),
          },
          after: {
            licenses: [...currentLicenses.map((l) => l.skuPartNumber), payload.skuDisplayName],
          },
        },
      ],
      warnings,
      estimatedDurationSeconds: 5,
    };
  };
}

/**
 * Lizenz entfernen - Job-Handler
 */
export function createRemoveLicenseHandler(
  identityProvider: IdentityProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload as RemoveLicensePayload;

    try {
      await identityProvider.removeLicense(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.userId,
        payload.skuId
      );

      return {
        success: true,
        data: {
          userId: payload.userId,
          skuId: payload.skuId,
          removedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: {
          code: 'LICENSE_REMOVAL_FAILED',
          message,
          retryable: false,
        },
      };
    }
  };
}

/**
 * Job-Definitionen registrieren
 */
export function registerIdentityJobs(identityProvider: IdentityProvider): void {
  registerJob(
    {
      type: 'identity.assign-license',
      displayName: 'Lizenz zuweisen',
      maxRetries: 2,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    createAssignLicenseHandler(identityProvider),
    createAssignLicensePreviewGenerator(identityProvider)
  );

  registerJob(
    {
      type: 'identity.remove-license',
      displayName: 'Lizenz entfernen',
      maxRetries: 2,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    createRemoveLicenseHandler(identityProvider),
    // Preview-Generator fuer Remove analog zu Assign
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as RemoveLicensePayload;
      return {
        changes: [
          {
            objectType: 'user-license',
            objectId: `${payload.userId}:${payload.skuId}`,
            objectDisplayName: `${payload.userDisplayName} - ${payload.skuDisplayName}`,
            action: 'delete',
            before: { license: payload.skuDisplayName },
            after: { license: null },
          },
        ],
        warnings: [],
        estimatedDurationSeconds: 5,
      };
    }
  );
}
