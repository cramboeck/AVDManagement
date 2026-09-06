/**
 * ResourceProvider - Basis-Interface fuer alle Microsoft-API-Provider
 */

import type { TenantId, PaginatedResponse } from '@zerostress/types';

export interface ProviderContext {
  tenantId: TenantId;
  correlationId: string;
}

export interface ResourceProvider {
  readonly name: string;
  readonly requiredScopes: string[];
}

export interface DeltaQueryResult<T> {
  items: T[];
  deltaToken: string | null;
  hasMorePages: boolean;
}

export interface DeltaQueryOptions {
  deltaToken?: string;
  pageSize?: number;
}

export interface ListOptions {
  pageSize?: number;
  pageToken?: string;
  filter?: string;
  search?: string;
}

export abstract class BaseResourceProvider implements ResourceProvider {
  abstract readonly name: string;
  abstract readonly requiredScopes: string[];

  protected validateContext(ctx: ProviderContext): void {
    if (!ctx.tenantId) {
      throw new Error('TenantId is required in provider context');
    }
    if (!ctx.correlationId) {
      throw new Error('CorrelationId is required in provider context');
    }
  }
}
