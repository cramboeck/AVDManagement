/**
 * Graph-Client mit Throttling-Handling
 *
 * Throttling ist Normalbetrieb, kein Fehlerfall.
 * Graph 429 mit Retry-After, exponentielles Backoff.
 */

import { GraphApiError } from '../errors.js';
import { resolveRequestUrl } from './request-url.js';
import { backoffMs, isReadOnlyGraphPost, parseRetryAfter, shouldRetryStatus, shouldRetryTransport } from './retry-policy.js';

export interface GraphClientConfig {
  getAccessToken: (tenantId: string, scopes: string[]) => Promise<string>;
  baseUrl?: string;
  defaultRetries?: number;
  defaultTimeoutMs?: number;
  // Weitere vertrauenswuerdige Hosts fuer absolute URLs (z. B. regionale Defender-Hosts)
  extraOrigins?: RegExp;
}

export interface GraphRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
  // Berichte liefern CSV ueber eine Weiterleitung; dann Text statt JSON lesen
  responseType?: 'json' | 'text';
  // Lesender POST ($batch mit GETs, Berichte): darf bei Zeitueberschreitung und 5xx wiederholt werden
  idempotent?: boolean;
}

export interface GraphBatchRequest {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface GraphBatchResult {
  // 0 = das Paket kam gar nicht an; sonst HTTP-Status der Teilantwort
  status: number;
  body: unknown;
  error?: string;
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
  private readonly extraOrigins?: RegExp;
  private readonly getAccessToken: (tenantId: string, scopes: string[]) => Promise<string>;

  constructor(config: GraphClientConfig) {
    this.baseUrl = config.baseUrl ?? 'https://graph.microsoft.com/v1.0';
    this.defaultRetries = config.defaultRetries ?? 3;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30000;
    this.extraOrigins = config.extraOrigins;
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
      responseType = 'json',
    } = options;

    // Vor dem Token pruefen: eine fremde URL bekommt nie ein Token
    const url = resolveRequestUrl(this.baseUrl, path, this.extraOrigins);
    const idempotent = options.idempotent ?? (method === 'POST' && isReadOnlyGraphPost(url, body) ? true : undefined);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      // Je Versuch neu holen: nach langem Retry-After kann das Token abgelaufen sein (Cache im TokenProvider)
      const accessToken = await this.getAccessToken(tenantId, scopes);
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
          if (responseType === 'text') {
            return (await response.text()) as T;
          }
          // Manche Endpunkte antworten 200 mit leerem Body; das ist kein JSON-Fehler, sondern "nichts da"
          const text = await response.text();
          if (!text.trim()) {
            return undefined as T;
          }
          try {
            return JSON.parse(text) as T;
          } catch {
            throw new GraphApiError(response.status, 'InvalidResponse', `Graph antwortete mit ${response.status}, aber ohne gueltiges JSON (${text.slice(0, 80)})`, undefined, undefined);
          }
        }

        const errorBody = await this.parseErrorBody(response);
        const graphError = new GraphApiError(
          response.status,
          errorBody.code ?? 'Unknown',
          errorBody.message ?? response.statusText,
          parseRetryAfter(response.headers.get('Retry-After')),
          undefined
        );

        if (!shouldRetryStatus(response.status, method, idempotent) || attempt === retries) {
          throw graphError;
        }

        lastError = graphError;
        await this.delay(backoffMs(attempt, graphError.retryAfterSeconds));
      } catch (error) {
        if (error instanceof GraphApiError) {
          throw error;
        }

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeoutMs}ms`);
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
        }

        // Ein POST ohne Antwort kann bei Microsoft schon ausgefuehrt sein: nicht blind wiederholen
        if (attempt === retries || !shouldRetryTransport(method, idempotent)) {
          throw lastError;
        }

        await this.delay(backoffMs(attempt));
      }
    }

    throw lastError ?? new Error('Unexpected error in GraphClient');
  }

  /**
   * JSON-Batch mit Wiederholung gedrosselter Teilanfragen.
   *
   * Teilt in Pakete zu 20, schickt bis zu zwei gleichzeitig und wiederholt
   * Teilantworten mit 429 nach der laengsten Retry-After-Zeit (hoechstens
   * drei Runden). Ein Paket, das insgesamt scheitert, liefert Status 0 je
   * Anfrage; fehlende Rechte (401/403) werden weitergereicht.
   */
  async batch(tenantId: string, scopes: string[], requests: GraphBatchRequest[], options: { maxRounds?: number; parallel?: number } = {}): Promise<Map<string, GraphBatchResult>> {
    const maxRounds = options.maxRounds ?? 3;
    const parallel = Math.max(1, options.parallel ?? 2);
    const results = new Map<string, GraphBatchResult>();
    let pending = requests;

    for (let round = 0; round < maxRounds && pending.length > 0; round++) {
      const chunks: GraphBatchRequest[][] = [];
      for (let i = 0; i < pending.length; i += 20) chunks.push(pending.slice(i, i + 20));
      const throttled: GraphBatchRequest[] = [];
      let waitSeconds = 0;

      for (let i = 0; i < chunks.length; i += parallel) {
        await Promise.all(
          chunks.slice(i, i + parallel).map(async (chunk) => {
            let response: { responses?: Array<{ id: string; status: number; body?: unknown; headers?: Record<string, string> }> };
            try {
              response = await this.post(tenantId, '/$batch', scopes, { requests: chunk }, { idempotent: chunk.every((r) => r.method === 'GET') });
            } catch (error) {
              if (error instanceof GraphApiError && error.isAuthError) throw error;
              for (const r of chunk) results.set(r.id, { status: 0, body: undefined, error: error instanceof Error ? error.message : String(error) });
              return;
            }
            for (const r of response.responses ?? []) {
              if (r.status === 429) {
                const original = chunk.find((c) => c.id === r.id);
                if (original) throttled.push(original);
                const header = r.headers?.['Retry-After'] ?? r.headers?.['retry-after'] ?? null;
                waitSeconds = Math.max(waitSeconds, parseRetryAfter(header) ?? 5);
              }
              results.set(r.id, { status: r.status, body: r.body });
            }
          })
        );
      }

      pending = throttled;
      if (pending.length > 0 && round + 1 < maxRounds) await this.delay(backoffMs(round, waitSeconds));
    }
    return results;
  }

  /**
   * Alle Seiten ueber @odata.nextLink lesen. Mit maxItems bricht die Schleife
   * ab und meldet truncated, statt still abzuschneiden.
   */
  async getAllPages<T>(tenantId: string, path: string, scopes: string[], options: { maxItems?: number; headers?: Record<string, string> } = {}): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: GraphResponse<T[]> = await this.get<GraphResponse<T[]>>(tenantId, next, scopes, options.headers ? { headers: options.headers } : undefined);
      items.push(...(page.value ?? []));
      next = page['@odata.nextLink'];
      if (options.maxItems !== undefined && items.length >= options.maxItems) {
        return { items: items.slice(0, options.maxItems), truncated: Boolean(next) || items.length > options.maxItems };
      }
    }
    return { items, truncated: false };
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



  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
