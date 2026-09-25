/**
 * Gemeinsame Microsoft-Clients der API
 *
 * Provider und Jobs arbeiten durchgehend mit unserer TenantId. Entra
 * braucht als Authority aber die Microsoft-Tenant-ID; die Aufloesung
 * passiert ausschliesslich hier, damit keine Route sie vergessen kann.
 */

import { eq } from 'drizzle-orm';
import {
  TokenProvider,
  GraphClient,
  ArmClient,
  IdentityProvider,
  AvdProvider,
  DeviceProvider,
  SecurityProvider,
  RemediationProvider,
  DEFENDER_API_BASE_URL,
  NotFoundError,
} from '@zerostress/core';
import { db, managedTenants } from '../db/index.js';

const microsoftTenantIds = new Map<string, string>();

export function rememberMicrosoftTenantId(tenantId: string, microsoftTenantId: string): void {
  microsoftTenantIds.set(tenantId, microsoftTenantId);
}

export async function resolveMicrosoftTenantId(tenantId: string): Promise<string> {
  const cached = microsoftTenantIds.get(tenantId);
  if (cached) {
    return cached;
  }

  const tenant = await db.query.managedTenants.findFirst({
    where: eq(managedTenants.id, tenantId),
    columns: { microsoftTenantId: true },
  });

  if (!tenant) {
    throw new NotFoundError('Tenant', tenantId);
  }

  microsoftTenantIds.set(tenantId, tenant.microsoftTenantId);
  return tenant.microsoftTenantId;
}

let tokenProvider: TokenProvider | null = null;

export function getTokenProvider(): TokenProvider {
  if (!tokenProvider) {
    tokenProvider = new TokenProvider({
      clientId: process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      tenantId: process.env.ENTRA_TENANT_ID!,
    });
  }
  return tokenProvider;
}

async function getAccessTokenForManagedTenant(tenantId: string, scopes: string[]): Promise<string> {
  const microsoftTenantId = await resolveMicrosoftTenantId(tenantId);
  return getTokenProvider().getAccessToken(microsoftTenantId, scopes);
}

let graphClient: GraphClient | null = null;
let defenderClient: GraphClient | null = null;
let armClient: ArmClient | null = null;
let identityProvider: IdentityProvider | null = null;
let avdProvider: AvdProvider | null = null;
let deviceProvider: DeviceProvider | null = null;

// Defender-for-Endpoint-API spricht dasselbe OData-Protokoll wie Graph;
// EU-Datenresidenz optional ueber DEFENDER_API_BASE_URL (api-eu.securitycenter.microsoft.com)
export function getDefenderClient(): GraphClient {
  if (!defenderClient) {
    defenderClient = new GraphClient({
      getAccessToken: getAccessTokenForManagedTenant,
      baseUrl: process.env.DEFENDER_API_BASE_URL ?? DEFENDER_API_BASE_URL,
    });
  }
  return defenderClient;
}

export function getDeviceProvider(): DeviceProvider {
  if (!deviceProvider) {
    deviceProvider = new DeviceProvider(getGraphClient(), getDefenderClient());
  }
  return deviceProvider;
}

let remediationProvider: RemediationProvider | null = null;

export function getRemediationProvider(): RemediationProvider {
  if (!remediationProvider) {
    remediationProvider = new RemediationProvider(getGraphClient());
  }
  return remediationProvider;
}

let securityProvider: SecurityProvider | null = null;

export function getSecurityProvider(): SecurityProvider {
  if (!securityProvider) {
    securityProvider = new SecurityProvider(getGraphClient());
  }
  return securityProvider;
}

export function getGraphClient(): GraphClient {
  if (!graphClient) {
    graphClient = new GraphClient({ getAccessToken: getAccessTokenForManagedTenant });
  }
  return graphClient;
}

export function getArmClient(): ArmClient {
  if (!armClient) {
    armClient = new ArmClient({ getAccessToken: getAccessTokenForManagedTenant });
  }
  return armClient;
}

export function getIdentityProvider(): IdentityProvider {
  if (!identityProvider) {
    identityProvider = new IdentityProvider(getGraphClient());
  }
  return identityProvider;
}

export function getAvdProvider(): AvdProvider {
  if (!avdProvider) {
    avdProvider = new AvdProvider(getArmClient());
  }
  return avdProvider;
}
