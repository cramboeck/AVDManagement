/**
 * API-Client fuer das Frontend
 */

import type { ProblemDetails } from '@zerostress/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: ProblemDetails
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isThrottled(): boolean {
    return this.status === 429;
  }

  get userMessage(): string {
    if (this.isThrottled) {
      return 'Zu viele Anfragen. Bitte warte einen Moment.';
    }
    if (this.isUnauthorized) {
      return 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.';
    }
    if (this.isForbidden) {
      return 'Du hast keine Berechtigung fuer diese Aktion.';
    }
    return this.problem.detail ?? this.problem.title;
  }
}

async function getAccessToken(): Promise<string | null> {
  // In Produktion: MSAL oder Auth-Provider
  // Fuer Entwicklung: Token aus localStorage
  return localStorage.getItem('access_token');
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const problem: ProblemDetails = await response.json().catch(() => ({
      type: 'https://api.zerostress.io/problems/unknown',
      title: response.statusText,
      status: response.status,
    }));

    throw new ApiError(response.status, problem);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),

  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: <T>(path: string) =>
    apiFetch<T>(path, {
      method: 'DELETE',
    }),
};
