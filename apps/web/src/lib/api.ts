/**
 * API-Client fuer das Frontend
 */

import type { ProblemDetails } from '@zerostress/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
// Sitzung ist ein httpOnly-Cookie; der Header ist der CSRF-Nachweis fuer schreibende Anfragen
const SESSION_HEADERS: Record<string, string> = { 'X-Requested-With': 'ZeroStress' };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: ProblemDetails
  ) {
    // Nie eine leere Meldung: ohne Problem-Details bleibt wenigstens der Statuscode
    super(problem.detail || problem.title || `Anfrage fehlgeschlagen (HTTP ${status})`);
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

function redirectToLoginOn401(status: number): void {
  // Sitzung abgelaufen: zur Anmeldung, aber nicht in einer Schleife von der Login-Seite aus
  if (status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/auth/')) {
    window.location.href = '/login';
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...SESSION_HEADERS,
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  redirectToLoginOn401(response.status);

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

  // Roher Datei-Upload (Body ist die Datei, kein JSON)
  upload: async <T>(path: string, file: File): Promise<T> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream', ...SESSION_HEADERS };
    const response = await fetch(`${API_URL}${path}${path.includes('?') ? '&' : '?'}fileName=${encodeURIComponent(file.name)}`, { method: 'PUT', headers, body: file, credentials: 'include' });
    redirectToLoginOn401(response.status);
    if (!response.ok) {
      const problem: ProblemDetails = await response.json().catch(() => ({ type: 'https://api.zerostress.io/problems/unknown', title: response.statusText, status: response.status }));
      throw new ApiError(response.status, problem);
    }
    return response.json();
  },

  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    }),
};
