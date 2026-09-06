/**
 * Error-Handler Middleware
 *
 * Konvertiert Fehler in RFC 9457 Problem Details Format.
 */

import { type ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AppError, GraphApiError } from '@zerostress/core';
import type { ProblemDetails } from '@zerostress/types';

export const errorHandler: ErrorHandler = (err, c) => {
  const correlationId = c.req.header('X-Correlation-ID') ?? crypto.randomUUID();

  console.error(`[${correlationId}] Error:`, err);

  if (err instanceof AppError) {
    const problem = err.toProblemDetails();
    problem.correlationId = correlationId;
    return c.json(problem, err.statusCode as 400 | 401 | 403 | 404 | 409 | 500 | 502);
  }

  if (err instanceof HTTPException) {
    const problem: ProblemDetails = {
      type: 'https://api.zerostress.io/problems/http-error',
      title: err.message,
      status: err.status,
      correlationId,
    };
    return c.json(problem, err.status);
  }

  if (err instanceof GraphApiError) {
    const problem: ProblemDetails = {
      type: 'https://api.zerostress.io/problems/graph-api-error',
      title: getGraphErrorTitle(err),
      status: err.statusCode,
      detail: err.message,
      correlationId,
    };
    return c.json(problem, err.statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 502);
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  const problem: ProblemDetails = {
    type: 'https://api.zerostress.io/problems/internal-error',
    title: 'Internal Server Error',
    status: 500,
    detail: process.env.NODE_ENV === 'development' ? message : undefined,
    correlationId,
  };

  return c.json(problem, 500);
};

function getGraphErrorTitle(err: GraphApiError): string {
  if (err.isThrottled) {
    return `API rate limit exceeded. Retry after ${err.retryAfterSeconds ?? 60} seconds.`;
  }

  if (err.statusCode === 401) {
    return 'Authentication with Microsoft failed. Please reconnect the tenant.';
  }

  if (err.statusCode === 403) {
    return 'Insufficient permissions. Missing scopes may need to be granted.';
  }

  if (err.statusCode >= 500) {
    return 'Microsoft services are temporarily unavailable. Please try again.';
  }

  return 'Error communicating with Microsoft Graph API';
}
