/**
 * ARM-Client fuer Azure Resource Manager API
 *
 * Analog zum GraphClient, aber fuer Azure-Ressourcen (VMs, AVD, etc.)
 * Throttling-Handling mit Retry-After und exponentiellem Backoff.
 */

import { ArmApiError } from '../errors.js';
import { resolveRequestUrl } from './request-url.js';
import { backoffMs, parseRetryAfter, shouldRetryStatus, shouldRetryTransport } from './retry-policy.js';

export interface ArmClientConfig {
  getAccessToken: (tenantId: string, scopes: string[]) => Promise<string>;
  baseUrl?: string;
  defaultRetries?: number;
  defaultTimeoutMs?: number;
  apiVersion?: string;
}

interface ArmRawResponse {
  status: number;
  body: unknown;
  asyncOperationUrl?: string;
  location?: string;
  retryAfterSeconds?: number;
}

export interface ArmRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  apiVersion?: string;
  // Lesender POST: darf bei Zeitueberschreitung und 5xx wiederholt werden
  idempotent?: boolean;
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

  /**
   * Ein Aufruf mit Wiederholungsregeln (retry-policy.ts). Liefert Status,
   * Body und die Kopfzeilen fuer lang laufende Vorgaenge.
   */
  private async send(tenantId: string, path: string, options: ArmRequestOptions = {}): Promise<ArmRawResponse> {
    const {
      method = 'GET',
      body,
      headers = {},
      retries = this.defaultRetries,
      timeoutMs = this.defaultTimeoutMs,
      apiVersion = this.defaultApiVersion,
      idempotent,
    } = options;

    // Absolute URLs (nextLink, Async-Operation) nur auf dem ARM-Host, siehe request-url.ts
    let url: string;
    if (/^https?:\/\//i.test(path)) {
      url = resolveRequestUrl(this.baseUrl, path);
    } else {
      const separator = path.includes('?') ? '&' : '?';
      url = `${this.baseUrl}${path}${separator}api-version=${apiVersion}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      // Je Versuch neu holen: nach langem Retry-After kann das Token abgelaufen sein
      const accessToken = await this.getAccessToken(tenantId, ARM_SCOPES);
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
          // Erst als Text lesen: 200/202 mit leerem Body ist gueltig und kein JSON-Fehler
          const text = response.status === 204 ? '' : await response.text();
          let parsed: unknown;
          if (text.trim()) {
            try {
              parsed = JSON.parse(text);
            } catch {
              throw new ArmApiError(response.status, 'InvalidResponse', `ARM antwortete mit ${response.status}, aber ohne gueltiges JSON`);
            }
          }
          return {
            status: response.status,
            body: parsed,
            asyncOperationUrl: response.headers.get('Azure-AsyncOperation') ?? undefined,
            location: response.headers.get('Location') ?? undefined,
            retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
          };
        }

        const errorBody = await this.parseErrorBody(response);
        const armError = new ArmApiError(
          response.status,
          errorBody.code ?? 'Unknown',
          errorBody.message ?? response.statusText,
          parseRetryAfter(response.headers.get('Retry-After'))
        );

        if (!shouldRetryStatus(response.status, method, idempotent) || attempt === retries) {
          throw armError;
        }

        lastError = armError;
        await this.delay(backoffMs(attempt, armError.retryAfterSeconds));
      } catch (error) {
        if (error instanceof ArmApiError) {
          throw error;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeoutMs}ms`);
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
        }

        // Ein POST ohne Antwort (z. B. Run Command, VM-Start) kann schon laufen: nicht doppelt senden
        if (attempt === retries || !shouldRetryTransport(method, idempotent)) {
          throw lastError;
        }

        await this.delay(backoffMs(attempt));
      }
    }

    throw lastError ?? new Error('Unexpected error in ArmClient');
  }

  /**
   * Aufruf mit Body als Ergebnis. Laeuft der Vorgang bei Azure noch weiter
   * (Azure-AsyncOperation oder 202 mit Location, auch bei 200/201), steht
   * die Adresse zum Warten in asyncOperationUrl bzw. locationUrl.
   */
  async request<T>(
    tenantId: string,
    path: string,
    options: ArmRequestOptions = {}
  ): Promise<T> {
    const res = await this.send(tenantId, path, options);
    const bodyObject = res.body && typeof res.body === 'object' && !Array.isArray(res.body) ? (res.body as Record<string, unknown>) : null;
    if (res.asyncOperationUrl) {
      return { ...(bodyObject ?? {}), asyncOperationUrl: res.asyncOperationUrl } as T;
    }
    if (res.status === 202 && res.location) {
      return { ...(bodyObject ?? {}), locationUrl: res.location } as T;
    }
    return (res.body === undefined ? undefined : res.body) as T;
  }

  /**
   * Auf einen Vorgang mit Location-Kopfzeile warten: 202 heisst laeuft noch,
   * 200/204 ist das Ergebnis. Fehler kommen als ArmApiError (z. B. 400 bei
   * einer gescheiterten Pruefung).
   */
  async waitForLocation<T>(tenantId: string, locationUrl: string, timeoutMs = 300000): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const res = await this.send(tenantId, locationUrl, { method: 'GET' });
      if (res.status !== 202) return res.body as T;
      await this.delay(Math.min(backoffMs(0, res.retryAfterSeconds ?? 5), 60000));
    }
    throw new Error(`Operation did not finish within ${timeoutMs}ms`);
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
    await this.waitForAsyncOperationResult<ArmAsyncOperation>(tenantId, asyncOperationUrl, timeoutMs);
  }

  /**
   * Wie waitForAsyncOperation, liefert aber den letzten Status samt Nutzlast
   * (Run Command legt seine Ausgabe unter properties.output ab)
   */
  async waitForAsyncOperationResult<T extends ArmAsyncOperation>(
    tenantId: string,
    asyncOperationUrl: string,
    timeoutMs: number = 300000
  ): Promise<T> {
    const startTime = Date.now();
    const pollInterval = 5000;

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.get<T>(tenantId, asyncOperationUrl);

      if (status.status === 'Succeeded') {
        return status;
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



  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
