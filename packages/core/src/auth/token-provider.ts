/**
 * Token-Provider fuer Microsoft Graph
 *
 * Unterstuetzt GDAP und App-Consent Authentifizierung.
 */

import { ConfidentialClientApplication } from '@azure/msal-node';

export interface TokenProviderConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

export interface TenantTokenConfig {
  tenantId: string;
  authMethod: 'gdap' | 'app-consent';
  clientId?: string;
  clientSecret?: string;
}

const GRAPH_RESOURCE = 'https://graph.microsoft.com';

/**
 * Client-Credential-Flow akzeptiert nur `<Ressource>/.default`. Die
 * Provider deklarieren ihre Einzelscopes (Dokumentation + Consent-Pruefung),
 * das Token wird immer fuer die gesamte Ressource angefordert.
 */
export function resolveResourceScope(scopes: string[]): string {
  const resources = new Set(
    scopes.map((scope) => (scope.startsWith('https://') ? new URL(scope).origin : GRAPH_RESOURCE))
  );

  if (resources.size === 0) {
    return `${GRAPH_RESOURCE}/.default`;
  }

  if (resources.size > 1) {
    throw new Error(
      `A single token cannot span multiple resources: ${[...resources].join(', ')}`
    );
  }

  const [resource] = resources;
  return `${resource}/.default`;
}

export class TokenProvider {
  private readonly msalClients = new Map<string, ConfidentialClientApplication>();
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();
  private readonly config: TokenProviderConfig;

  constructor(config: TokenProviderConfig) {
    this.config = config;
  }

  /**
   * Access-Token fuer einen Tenant abrufen
   */
  async getAccessToken(tenantId: string, scopes: string[]): Promise<string> {
    const resourceScope = resolveResourceScope(scopes);
    const cacheKey = `${tenantId}:${resourceScope}`;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() + 60000) {
      return cached.token;
    }

    const client = this.getMsalClient(tenantId);

    const result = await client.acquireTokenByClientCredential({
      scopes: [resourceScope],
    });

    if (!result?.accessToken) {
      throw new Error(`Failed to acquire token for tenant ${tenantId}`);
    }

    this.tokenCache.set(cacheKey, {
      token: result.accessToken,
      expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600000,
    });

    return result.accessToken;
  }

  /**
   * Token-Cache fuer einen Tenant invalidieren
   */
  invalidateTokens(tenantId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.tokenCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.tokenCache.delete(key));
    this.msalClients.delete(tenantId);
  }

  private getMsalClient(tenantId: string): ConfidentialClientApplication {
    let client = this.msalClients.get(tenantId);
    if (!client) {
      client = new ConfidentialClientApplication({
        auth: {
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          authority: `https://login.microsoftonline.com/${tenantId}`,
        },
      });
      this.msalClients.set(tenantId, client);
    }
    return client;
  }
}
