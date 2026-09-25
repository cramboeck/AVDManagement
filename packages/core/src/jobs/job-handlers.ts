/**
 * Job-Handler fuer Identity-Modul
 */
import {
  registerJob,
  type JobContext,
  type JobResult,
  type PreviewContext,
  type PreviewResult,
} from './job-types.js';
import { IdentityProvider } from '../providers/identity-provider.js';

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
    const payload = ctx.payload as unknown as AssignLicensePayload;

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
    const payload = ctx.payload as unknown as AssignLicensePayload;
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
    const payload = ctx.payload as unknown as RemoveLicensePayload;

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

// Payload fuer Konto-Aktionen
interface UserAccountPayload {
  userId: string;
  userDisplayName: string;
  userPrincipalName: string;
}

interface DisableUserPayload extends UserAccountPayload {
  revokeSessions: boolean;
}

function failure(code: string, error: unknown): JobResult {
  return {
    success: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    },
  };
}

function accountChange(
  payload: UserAccountPayload,
  action: 'update',
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  return {
    objectType: 'user',
    objectId: payload.userId,
    objectDisplayName: `${payload.userDisplayName} (${payload.userPrincipalName})`,
    action,
    before,
    after,
  };
}

/**
 * Benutzer deaktivieren (Offboarding); optional alle Sitzungen widerrufen
 */
export function createDisableUserHandler(
  identityProvider: IdentityProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as DisableUserPayload;
    const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };

    try {
      await identityProvider.disableUser(providerCtx, payload.userId);
      if (payload.revokeSessions) {
        await identityProvider.revokeSignInSessions(providerCtx, payload.userId);
      }
      return {
        success: true,
        data: {
          userId: payload.userId,
          accountEnabled: false,
          sessionsRevoked: payload.revokeSessions,
          disabledAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return failure('USER_DISABLE_FAILED', error);
    }
  };
}

export function createDisableUserPreviewGenerator(
  identityProvider: IdentityProvider
): (ctx: PreviewContext) => Promise<PreviewResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as DisableUserPayload;
    const user = await identityProvider.getUser(
      { tenantId: ctx.tenantId, correlationId: crypto.randomUUID() },
      payload.userId
    );
    const warnings: string[] = [];
    if (user && !user.accountEnabled) {
      warnings.push('Das Konto ist bereits deaktiviert.');
    }
    if (payload.revokeSessions) {
      warnings.push('Alle aktiven Sitzungen und Token des Benutzers werden ungueltig; er wird ueberall abgemeldet.');
    }
    return {
      changes: [
        accountChange(
          payload,
          'update',
          { accountEnabled: user?.accountEnabled ?? true },
          { accountEnabled: false, sessionsRevoked: payload.revokeSessions }
        ),
      ],
      warnings,
      estimatedDurationSeconds: 5,
    };
  };
}

/**
 * Benutzer aktivieren
 */
export function createEnableUserHandler(
  identityProvider: IdentityProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as UserAccountPayload;
    try {
      await identityProvider.enableUser(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.userId
      );
      return {
        success: true,
        data: { userId: payload.userId, accountEnabled: true, enabledAt: new Date().toISOString() },
      };
    } catch (error) {
      return failure('USER_ENABLE_FAILED', error);
    }
  };
}

export function createEnableUserPreviewGenerator(
  identityProvider: IdentityProvider
): (ctx: PreviewContext) => Promise<PreviewResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as UserAccountPayload;
    const user = await identityProvider.getUser(
      { tenantId: ctx.tenantId, correlationId: crypto.randomUUID() },
      payload.userId
    );
    return {
      changes: [
        accountChange(
          payload,
          'update',
          { accountEnabled: user?.accountEnabled ?? false },
          { accountEnabled: true }
        ),
      ],
      warnings: user?.accountEnabled ? ['Das Konto ist bereits aktiv.'] : [],
      estimatedDurationSeconds: 5,
    };
  };
}

/**
 * Alle Sitzungen widerrufen (erzwingt Neuanmeldung auf allen Geraeten)
 */
export function createRevokeSessionsHandler(
  identityProvider: IdentityProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as UserAccountPayload;
    try {
      await identityProvider.revokeSignInSessions(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.userId
      );
      return {
        success: true,
        data: { userId: payload.userId, sessionsRevokedAt: new Date().toISOString() },
      };
    } catch (error) {
      return failure('SESSION_REVOKE_FAILED', error);
    }
  };
}

/**
 * Passwort zuruecksetzen. Das temporaere Passwort steht nur im Job-Ergebnis
 * und muss beim naechsten Login geaendert werden.
 */
export function createResetPasswordHandler(
  identityProvider: IdentityProvider
): (ctx: JobContext) => Promise<JobResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as UserAccountPayload;
    try {
      const { temporaryPassword } = await identityProvider.resetPassword(
        { tenantId: ctx.tenantId, correlationId: ctx.correlationId },
        payload.userId
      );
      return {
        success: true,
        data: {
          userId: payload.userId,
          temporaryPassword,
          forceChangeAtNextSignIn: true,
          resetAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return failure('PASSWORD_RESET_FAILED', error);
    }
  };
}

function simpleAccountPreview(
  action: string,
  warnings: string[]
): (ctx: PreviewContext) => Promise<PreviewResult> {
  return async (ctx) => {
    const payload = ctx.payload as unknown as UserAccountPayload;
    return {
      changes: [accountChange(payload, 'update', {}, { [action]: true })],
      warnings,
      estimatedDurationSeconds: 5,
    };
  };
}

/**
 * Job-Definitionen registrieren
 */
export function registerIdentityJobs(identityProvider: IdentityProvider): void {
  registerJob(
    {
      type: 'identity.disable-user',
      displayName: 'Benutzer deaktivieren',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    createDisableUserHandler(identityProvider),
    createDisableUserPreviewGenerator(identityProvider)
  );

  registerJob(
    {
      type: 'identity.enable-user',
      displayName: 'Benutzer aktivieren',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    createEnableUserHandler(identityProvider),
    createEnableUserPreviewGenerator(identityProvider)
  );

  registerJob(
    {
      type: 'identity.revoke-sessions',
      displayName: 'Sitzungen widerrufen',
      maxRetries: 1,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    createRevokeSessionsHandler(identityProvider),
    simpleAccountPreview('sessionsRevoked', [
      'Der Benutzer wird auf allen Geraeten abgemeldet und muss sich neu anmelden.',
    ])
  );

  registerJob(
    {
      type: 'identity.reset-password',
      displayName: 'Passwort zuruecksetzen',
      maxRetries: 0,
      timeoutSeconds: 30,
      concurrencyPerTenant: 5,
      requiresPreview: true,
    },
    createResetPasswordHandler(identityProvider),
    simpleAccountPreview('passwordReset', [
      'Ein temporaeres Passwort wird erzeugt und einmalig im Job-Ergebnis angezeigt. Der Benutzer muss es beim naechsten Login aendern.',
    ])
  );

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
      const payload = ctx.payload as unknown as RemoveLicensePayload;
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
