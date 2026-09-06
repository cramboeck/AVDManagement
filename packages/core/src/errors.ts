/**
 * Anwendungsspezifische Fehlerklassen
 */

import type { ProblemDetails } from '@zerostress/types';

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly type: string;
  readonly correlationId?: string;

  constructor(message: string, correlationId?: string) {
    super(message);
    this.name = this.constructor.name;
    this.correlationId = correlationId;
  }

  toProblemDetails(): ProblemDetails {
    return {
      type: `https://api.zerostress.io/problems/${this.type}`,
      title: this.name,
      status: this.statusCode,
      detail: this.message,
      correlationId: this.correlationId,
    };
  }
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  readonly type = 'unauthorized';

  constructor(message = 'Authentication required', correlationId?: string) {
    super(message, correlationId);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  readonly type = 'forbidden';

  constructor(message = 'Access denied', correlationId?: string) {
    super(message, correlationId);
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly type = 'not-found';

  constructor(
    readonly resourceType: string,
    readonly resourceId: string,
    correlationId?: string
  ) {
    super(`${resourceType} '${resourceId}' not found`, correlationId);
  }
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly type = 'conflict';

  constructor(message: string, correlationId?: string) {
    super(message, correlationId);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly type = 'validation-error';

  constructor(
    message: string,
    readonly errors: Record<string, string[]> = {},
    correlationId?: string
  ) {
    super(message, correlationId);
  }

  override toProblemDetails(): ProblemDetails & { errors?: Record<string, string[]> } {
    return {
      ...super.toProblemDetails(),
      errors: this.errors,
    };
  }
}

export class GraphApiError extends AppError {
  readonly type = 'graph-api-error';

  constructor(
    readonly statusCode: number,
    readonly graphErrorCode: string,
    message: string,
    readonly retryAfterSeconds?: number,
    correlationId?: string
  ) {
    super(message, correlationId);
  }

  get isThrottled(): boolean {
    return this.statusCode === 429;
  }

  get isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  get isRetryable(): boolean {
    return this.statusCode >= 500 || this.isThrottled;
  }
}

export class TenantConnectionError extends AppError {
  readonly statusCode = 502;
  readonly type = 'tenant-connection-error';

  constructor(
    readonly tenantId: string,
    readonly reason: 'consent-required' | 'permissions-insufficient' | 'unreachable',
    readonly missingScopes: string[] = [],
    correlationId?: string
  ) {
    const messages: Record<string, string> = {
      'consent-required': `Tenant ${tenantId} requires admin consent`,
      'permissions-insufficient': `Insufficient permissions for tenant ${tenantId}`,
      'unreachable': `Cannot connect to tenant ${tenantId}`,
    };
    super(messages[reason], correlationId);
  }
}

export class JobError extends AppError {
  readonly statusCode = 500;
  readonly type = 'job-error';

  constructor(
    readonly jobId: string,
    readonly errorCode: string,
    message: string,
    readonly retryable: boolean,
    correlationId?: string
  ) {
    super(message, correlationId);
  }
}
