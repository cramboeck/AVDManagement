/**
 * ARM-Client fuer Azure Resource Manager API
 *
 * Analog zum GraphClient, aber fuer Azure-Ressourcen (VMs, AVD, etc.)
 * Throttling-Handling mit Retry-After und exponentiellem Backoff.
 */

import { ArmApiError } from '../errors.js';

export interface ArmClientConfig {
  getAccessToken: (tenantId: string, scopes: string[]) => Promise<string>;
  baseUrl?: string;
  defaultRetries?: number;
  defaultTimeoutMs?: number;
  apiVersion?: string;
}

export interface ArmRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  apiVersion?: string;
}

export interface ArmResponse<T> {
  value: T;
  nextLink?: string;
  '@odata.count'?: number;
}

export interface ArmAsyncOperation {
  status: 'Succeeded' | 'Failed' | 'Running' | 'Canceled';
  error?: {
    code: string;
    message: string;
  };
}

const ARM_SCOPES = ['https://management.azure.com/.default'];

export class ArmClient {
  private readonly baseUrl: string;
  private readonly defaultRetries: number;
  private readonly defaultTimeoutMs: number;
  private readonly defaultApiVersion: string;
  private readonly getAccessToken: (tenantId: string, scopes: string[]) => Promise<string>;

  constructor(config: ArmClientConfig) {
    this.baseUrl = config.baseUrl ?? 'https://management.azure.com';
    this.defaultRetries = config.defaultRetries ?? 3;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 60000;
    this.defaultApiVersion = config.apiVersion ?? '2024-04-03';
    this.getAccessToken = config.getAccessToken;
  }

  async request<T>(
    tenantId: string,
    path: string,
    options: ArmRequestOptions = {}
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      headers = {},
      retries = this.defaultRetries,
      timeoutMs = this.defaultTimeoutMs,
      apiVersion = this.defaultApiVersion,
    } = options;

    const accessToken = await this.getAccessToken(tenantId, ARM_SCOPES);

    let url: string;
    if (path.startsWith('http')) {
      url = path;
    } else {
      const separator = path.includes('?') ? '&' : '?';
      url = `${this.baseUrl}${path}${separator}api-version=${apiVersion}`;
    }

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
          if (response.status === 204 || response.status === 202) {
            const asyncOpUrl = response.headers.get('Azure-AsyncOperation');
            if (asyncOpUrl) {
              return { asyncOperationUrl: asyncOpUrl } as T;
            }
            return undefined as T;
          }
          return (await response.json()) as T;
        }

        const errorBody = await this.parseErrorBody(response);
        const armError = new ArmApiError(
          response.status,
          errorBody.code ?? 'Unknown',
          errorBody.message ?? response.statusText,
          this.parseRetryAfter(response)
        );

        if (!armError.isRetryable || attempt === retries) {
          throw armError;
        }

        lastError = armError;
        await this.delay(this.calculateBackoff(attempt, armError.retryAfterSeconds));
      } catch (error) {
        if (error instanceof ArmApiError) {
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

    throw lastError ?? new Error('Unexpected error in ArmClient');
  }

  async get<T>(
    tenantId: string,
    path: string,
    options?: Omit<ArmRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(tenantId, path, { ...options, method: 'GET' });
  }

  async post<T>(
    tenantId: string,
    path: string,
    body?: unknown,
    options?: Omit<ArmRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(tenantId, path, { ...options, method: 'POST', body });
  }

  async patch<T>(
    tenantId: string,
    path: string,
    body: unknown,
    options?: Omit<ArmRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(tenantId, path, { ...options, method: 'PATCH', body });
  }

  async put<T>(
    tenantId: string,
    path: string,
    body: unknown,
    options?: Omit<ArmRequestOptions, 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>(tenantId, path, { ...options, method: 'PUT', body });
  }

  async delete(
    tenantId: string,
    path: string,
    options?: Omit<ArmRequestOptions, 'method' | 'body'>
  ): Promise<void> {
    await this.request<void>(tenantId, path, { ...options, method: 'DELETE' });
  }

  /**
   * Wartet auf Abschluss einer asynchronen ARM-Operation
   * Viele Azure-Operationen (VM Start/Stop) sind asynchron
   */
  async waitForAsyncOperation(
    tenantId: string,
    asyncOperationUrl: string,
    timeoutMs: number = 300000
  ): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 5000;

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.get<ArmAsyncOperation>(tenantId, asyncOperationUrl);

      if (status.status === 'Succeeded') {
        return;
      }

      if (status.status === 'Failed' || status.status === 'Canceled') {
        throw new ArmApiError(
          500,
          status.error?.code ?? 'OperationFailed',
          status.error?.message ?? `Operation ${status.status}`
        );
      }

      await this.delay(pollInterval);
    }

    throw new Error(`Async operation timed out after ${timeoutMs}ms`);
  }

  /**
   * Paginierte Abfrage - holt alle Seiten
   */
  async getAllPages<T>(
    tenantId: string,
    path: string,
    options?: Omit<ArmRequestOptions, 'method' | 'body'>
  ): Promise<T[]> {
    const results: T[] = [];
    let nextLink: string | undefined = path;

    while (nextLink) {
      const response: ArmResponse<T[]> = await this.get<ArmResponse<T[]>>(tenantId, nextLink, options);
      results.push(...response.value);
      nextLink = response.nextLink;
    }

    return results;
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
