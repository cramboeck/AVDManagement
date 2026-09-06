/**
 * Graph-Client mit Throttling-Handling
 *
 * Throttling ist Normalbetrieb, kein Fehlerfall.
 * Graph 429 mit Retry-After, exponentielles Backoff.
 */

import { GraphApiError } from '../errors.js';

export interface GraphClientConfig {
  getAccessToken: (tenantId: string, scopes: string[]) => Promise<string>;
  baseUrl?: string;
  defaultRetries?: number;
  defaultTimeoutMs?: number;
}

export interface GraphRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
}

export interface GraphResponse<T> {
  value: T;
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
  '@odata.count'?: number;
}

export class GraphClient {
  private readonly baseUrl: string;
  private readonly defaultRetries: number;
  private readonly defaultTimeoutMs: number;
  private readonly getAccessToken: (tenantId: string, scopes: string[]) => Promise<string>;

  constructor(config: GraphClientConfig) {
    this.baseUrl = config.baseUrl ?? 'https://graph.microsoft.com/v1.0';
    this.defaultRetries = config.defaultRetries ?? 3;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30000;
    this.getAccessToken = config.getAccessToken;
  }

  async request<T>(
    tenantId: string,
    path: string,
    scopes: string[],
    options: GraphRequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      headers = {},
      retries = this.defaultRetries,
      timeoutMs = this.defaultTimeoutMs,
    } = options;

    const accessToken = await this.getAccessToken(tenantId, scopes);
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          if (response.status === 204) {
            return undefined as T;
          }
          return (await response.json()) as T;
        }

        const errorBody = await this.parseErrorBody(response);
        const graphError = new GraphApiError(
          response.status,
          errorBody.code ?? 'Unknown',
          errorBody.message ?? response.statusText,
          this.parseRetryAfter(response),
          undefined
        );

        if (!graphError.isRetryable || attempt === retries) {
          throw graphError;
        }

        lastError = graphError;
        await this.delay(this.calculateBackoff(attempt, graphError.retryAfterSeconds));
      } catch (error) {
        if (error instanceof GraphApiError) {
          throw error;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeoutMs}ms`);
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
        }

        if (attempt === retries) {
          throw lastError;
        }

        await this.delay(this.calculateBackoff(attempt));
      }
    }

    throw lastError ?? new Error('Unexpected error in GraphClient');
  }

  async get<T>(
    tenantId: string,
    path: string,
    scopes: string[],
    options?: Omit<GraphRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(tenantId, path, scopes, { ...options, method: 'GET' });
  }

  async post<T>(
    tenantId: string,
    path: string,
    scopes: string[],
    body: unknown,
    options?: Omit<GraphRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(tenantId, path, scopes, { ...options, method: 'POST', body });
  }

  async patch<T>(
    tenantId: string,
    path: string,
    scopes: string[],
    body: unknown,
    options?: Omit<GraphRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(tenantId, path, scopes, { ...options, method: 'PATCH', body });
  }

  async delete(
    tenantId: string,
    path: string,
    scopes: string[],
    options?: Omit<GraphRequestOptions, 'method' | 'body'>
  ): Promise<void> {
    await this.request<void>(tenantId, path, scopes, { ...options, method: 'DELETE' });
  }

  private async parseErrorBody(
    response: Response
  ): Promise<{ code?: string; message?: string }> {
    try {
      const body = await response.json();
      return body.error ?? body;
    } catch {
      return { message: response.statusText };
    }
  }

  private parseRetryAfter(response: Response): number | undefined {
    const header = response.headers.get('Retry-After');
    if (!header) return undefined;

    const seconds = parseInt(header, 10);
    if (!isNaN(seconds)) return seconds;

    const date = Date.parse(header);
    if (!isNaN(date)) {
      return Math.max(0, Math.ceil((date - Date.now()) / 1000));
    }

    return undefined;
  }

  private calculateBackoff(attempt: number, retryAfterSeconds?: number): number {
    if (retryAfterSeconds !== undefined) {
      return retryAfterSeconds * 1000;
    }
    const baseDelay = 1000;
    const maxDelay = 60000;
    return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
