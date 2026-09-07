/**
 * Identity-Provider
 *
 * Benutzer- und Lizenzverwaltung ueber Microsoft Graph.
 * Implementiert Delta-Query fuer effiziente Synchronisation.
 */

import type {
  TenantId,
  SyncedUser,
  UserLicense,
  LicenseSku,
  MicrosoftId,
  UserId,
} from '@zerostress/types';
import {
  BaseResourceProvider,
  type ProviderContext,
  type DeltaQueryResult,
  type DeltaQueryOptions,
  type ListOptions,
} from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';

// Graph-API-Typen
interface GraphUser {
  id: string;
  userPrincipalName: string;
  displayName: string;
  mail: string | null;
  accountEnabled: boolean;
  userType: 'Member' | 'Guest';
  createdDateTime: string | null;
  '@removed'?: { reason: string };
}

interface GraphLicense {
  skuId: string;
  skuPartNumber?: string;
}

interface GraphSubscribedSku {
  skuId: string;
  skuPartNumber: string;
  consumedUnits: number;
  prepaidUnits: {
    enabled: number;
    suspended: number;
    warning: number;
  };
}

export class IdentityProvider extends BaseResourceProvider {
  readonly name = 'identity';
  readonly requiredScopes = [
    'User.Read.All',
    'Directory.Read.All',
  ];

  private readonly licenseScopes = [
    'Organization.Read.All',
  ];

  private readonly licenseWriteScopes = [
    'User.ReadWrite.All',
  ];

  constructor(private readonly graphClient: GraphClient) {
    super();
  }

  /**
   * Benutzer mit Delta-Query abrufen
   * Gibt nur geaenderte Benutzer seit dem letzten Sync zurueck
   */
  async getUsersDelta(
    ctx: ProviderContext,
    options: DeltaQueryOptions = {}
  ): Promise<DeltaQueryResult<SyncedUser>> {
    this.validateContext(ctx);

    const { deltaToken, pageSize = 100 } = options;
    const tenantId = ctx.tenantId as string;

    let url: string;
    if (deltaToken) {
      url = deltaToken;
    } else {
      const params = new URLSearchParams({
        $select: 'id,userPrincipalName,displayName,mail,accountEnabled,userType,createdDateTime',
        $top: String(pageSize),
      });
      url = `/users/delta?${params}`;
    }

    const response = await this.graphClient.get<GraphResponse<GraphUser[]>>(
      tenantId,
      url,
      this.requiredScopes
    );

    const users = response.value
      .filter((u) => !u['@removed'])
      .map((u) => this.mapGraphUserToSyncedUser(ctx.tenantId, u));

    const deletedIds = response.value
      .filter((u) => u['@removed'])
      .map((u) => u.id);

    return {
      items: users,
      deltaToken: response['@odata.deltaLink'] ?? null,
      hasMorePages: !!response['@odata.nextLink'],
    };
  }

  /**
   * Benutzerliste mit Paginierung
   */
  async listUsers(
    ctx: ProviderContext,
    options: ListOptions = {}
  ): Promise<{ items: SyncedUser[]; nextPageToken: string | null }> {
    this.validateContext(ctx);

    const { pageSize = 25, pageToken, filter, search } = options;
    const tenantId = ctx.tenantId as string;

    let url: string;
    if (pageToken) {
      url = pageToken;
    } else {
      const params = new URLSearchParams({
        $select: 'id,userPrincipalName,displayName,mail,accountEnabled,userType,createdDateTime',
        $top: String(pageSize),
        $orderby: 'displayName',
      });

      if (filter) {
        params.set('$filter', filter);
      }

      if (search) {
        params.set('$search', `"displayName:${search}" OR "mail:${search}"`);
      }

      url = `/users?${params}`;
    }

    const response = await this.graphClient.get<GraphResponse<GraphUser[]>>(
      tenantId,
      url,
      this.requiredScopes,
      search ? { headers: { ConsistencyLevel: 'eventual' } } : undefined
    );

    const users = response.value.map((u) =>
      this.mapGraphUserToSyncedUser(ctx.tenantId, u)
    );

    return {
      items: users,
      nextPageToken: response['@odata.nextLink'] ?? null,
    };
  }

  /**
   * Einzelnen Benutzer abrufen
   */
  async getUser(
    ctx: ProviderContext,
    userId: string
  ): Promise<SyncedUser | null> {
    this.validateContext(ctx);

    try {
      const user = await this.graphClient.get<GraphUser>(
        ctx.tenantId as string,
        `/users/${userId}?$select=id,userPrincipalName,displayName,mail,accountEnabled,userType,createdDateTime`,
        this.requiredScopes
      );

      return this.mapGraphUserToSyncedUser(ctx.tenantId, user);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Lizenzen eines Benutzers abrufen
   */
  async getUserLicenses(
    ctx: ProviderContext,
    userId: string
  ): Promise<UserLicense[]> {
    this.validateContext(ctx);

    const response = await this.graphClient.get<GraphResponse<GraphLicense[]>>(
      ctx.tenantId as string,
      `/users/${userId}/licenseDetails`,
      this.requiredScopes
    );

    return response.value.map((l) => ({
      skuId: l.skuId,
      skuPartNumber: l.skuPartNumber ?? '',
      assignedAt: new Date(),
    }));
  }

  /**
   * Verfuegbare Lizenz-SKUs im Tenant abrufen
   */
  async getAvailableSkus(ctx: ProviderContext): Promise<LicenseSku[]> {
    this.validateContext(ctx);

    const response = await this.graphClient.get<GraphResponse<GraphSubscribedSku[]>>(
      ctx.tenantId as string,
      '/subscribedSkus',
      [...this.requiredScopes, ...this.licenseScopes]
    );

    return response.value.map((sku) => ({
      skuId: sku.skuId,
      skuPartNumber: sku.skuPartNumber,
      displayName: this.getSkuDisplayName(sku.skuPartNumber),
    }));
  }

  /**
   * Lizenz einem Benutzer zuweisen
   */
  async assignLicense(
    ctx: ProviderContext,
    userId: string,
    skuId: string
  ): Promise<void> {
    this.validateContext(ctx);

    await this.graphClient.post(
      ctx.tenantId as string,
      `/users/${userId}/assignLicense`,
      [...this.requiredScopes, ...this.licenseWriteScopes],
      {
        addLicenses: [{ skuId }],
        removeLicenses: [],
      }
    );
  }

  /**
   * Lizenz von Benutzer entfernen
   */
  async removeLicense(
    ctx: ProviderContext,
    userId: string,
    skuId: string
  ): Promise<void> {
    this.validateContext(ctx);

    await this.graphClient.post(
      ctx.tenantId as string,
      `/users/${userId}/assignLicense`,
      [...this.requiredScopes, ...this.licenseWriteScopes],
      {
        addLicenses: [],
        removeLicenses: [skuId],
      }
    );
  }

  private mapGraphUserToSyncedUser(tenantId: TenantId, user: GraphUser): SyncedUser {
    return {
      id: user.id as UserId,
      tenantId,
      microsoftId: user.id as MicrosoftId,
      userPrincipalName: user.userPrincipalName,
      displayName: user.displayName,
      mail: user.mail,
      accountEnabled: user.accountEnabled,
      userType: user.userType ?? 'Member',
      createdAt: user.createdDateTime ? new Date(user.createdDateTime) : null,
      syncedAt: new Date(),
    };
  }

  private getSkuDisplayName(skuPartNumber: string): string {
    const skuNames: Record<string, string> = {
      'ENTERPRISEPACK': 'Microsoft 365 E3',
      'ENTERPRISEPREMIUM': 'Microsoft 365 E5',
      'SPE_E3': 'Microsoft 365 E3',
      'SPE_E5': 'Microsoft 365 E5',
      'O365_BUSINESS_ESSENTIALS': 'Microsoft 365 Business Basic',
      'O365_BUSINESS_PREMIUM': 'Microsoft 365 Business Standard',
      'SMB_BUSINESS_PREMIUM': 'Microsoft 365 Business Premium',
      'AAD_PREMIUM': 'Azure AD Premium P1',
      'AAD_PREMIUM_P2': 'Azure AD Premium P2',
      'EMS': 'Enterprise Mobility + Security E3',
      'EMSPREMIUM': 'Enterprise Mobility + Security E5',
      'INTUNE_A': 'Microsoft Intune',
      'WIN10_VDA_E3': 'Windows 10 Enterprise E3',
      'WIN10_VDA_E5': 'Windows 10 Enterprise E5',
      'WINDOWS_STORE': 'Windows Store for Business',
      'FLOW_FREE': 'Power Automate Free',
      'POWERAUTOMATE_ATTENDED_RPA': 'Power Automate per User with Attended RPA',
      'TEAMS_EXPLORATORY': 'Microsoft Teams Exploratory',
      'STREAM': 'Microsoft Stream',
    };

    return skuNames[skuPartNumber] ?? skuPartNumber;
  }
}
