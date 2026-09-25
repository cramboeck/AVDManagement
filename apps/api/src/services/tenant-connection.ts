/**
 * Verbindungstest fuer verwaltete Tenants
 *
 * Graph beweist den Admin-Consent (Application Permissions), ARM beweist die
 * RBAC-Zuweisung fuer AVD. Fehlender ARM-Zugriff blockiert die
 * Identity-Features nicht und wird nur als fehlender Scope gemeldet.
 */

import { eq } from 'drizzle-orm';
import { TokenProvider, GraphClient, ArmClient, GraphApiError } from '@zerostress/core';
import type { MissingScope, TenantConnectionStatus } from '@zerostress/types';
import { db, managedTenants } from '../db/index.js';
import { getTokenProvider } from './microsoft-clients.js';

export interface ConnectionTestResult {
  status: TenantConnectionStatus;
  missingScopes: MissingScope[];
  organizationName: string | null;
  subscriptionCount: number;
  detail: string | null;
}

const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];
const REQUEST_OPTIONS = { retries: 0, timeoutMs: 15000 };
const ARM_SUBSCRIPTIONS_API_VERSION = '2022-12-01';

interface GraphOrganizationResponse {
  value: { id: string; displayName: string }[];
}

interface ArmSubscriptionsResponse {
  value: { subscriptionId: string; displayName: string; state: string }[];
}

interface Clients {
  tokens: TokenProvider;
  graph: GraphClient;
  arm: ArmClient;
}

let clients: Clients | null = null;

// Eigene Graph-/ARM-Clients ohne TenantId-Aufloesung: der Test spricht
// den Microsoft-Tenant direkt an, teilt sich aber den TokenProvider
function getClients(): Clients {
  if (!clients) {
    const tokens = getTokenProvider();
    const getAccessToken = (microsoftTenantId: string, scopes: string[]) =>
      tokens.getAccessToken(microsoftTenantId, scopes);
    clients = {
      tokens,
      graph: new GraphClient({ getAccessToken }),
      arm: new ArmClient({ getAccessToken }),
    };
  }
  return clients;
}

export async function testTenantConnection(microsoftTenantId: string): Promise<ConnectionTestResult> {
  const { tokens, graph, arm } = getClients();

  // Nach einem frischen Consent duerfen keine alten Tokens verwendet werden
  tokens.invalidateTokens(microsoftTenantId);

  let organizationName: string | null = null;
  try {
    const org = await graph.get<GraphOrganizationResponse>(
      microsoftTenantId,
      '/organization?$select=id,displayName',
      GRAPH_SCOPES,
      REQUEST_OPTIONS
    );
    organizationName = org.value[0]?.displayName ?? null;
  } catch (error) {
    return graphFailure(error);
  }

  const missingScopes: MissingScope[] = [];
  let subscriptionCount = 0;

  try {
    const subscriptions = await arm.get<ArmSubscriptionsResponse>(microsoftTenantId, '/subscriptions', {
      ...REQUEST_OPTIONS,
      apiVersion: ARM_SUBSCRIPTIONS_API_VERSION,
    });
    subscriptionCount = subscriptions.value.length;

    if (subscriptionCount === 0) {
      missingScopes.push({
        scope: 'Azure RBAC: Reader + Desktop Virtualization Contributor',
        reason: 'Service principal has no access to any subscription; AVD features are unavailable',
      });
    }
  } catch (error) {
    missingScopes.push({
      scope: 'https://management.azure.com/.default',
      reason: `ARM access failed: ${describe(error)}`,
    });
  }

  return {
    status: 'connected',
    missingScopes,
    organizationName,
    subscriptionCount,
    detail: null,
  };
}

export async function persistConnectionTestResult(
  tenantId: string,
  result: ConnectionTestResult
): Promise<void> {
  await db
    .update(managedTenants)
    .set({
      connectionStatus: result.status,
      missingScopes: result.missingScopes,
      ...(result.status === 'connected' ? { lastSyncAt: new Date() } : {}),
    })
    .where(eq(managedTenants.id, tenantId));
}

function graphFailure(error: unknown): ConnectionTestResult {
  const detail = describe(error);
  const base = { organizationName: null, subscriptionCount: 0, detail };

  // 700016: App nicht im Tenant vorhanden, 65001/65002: kein Consent erteilt
  if (/AADSTS(700016|65001|65002)/.test(detail)) {
    return { ...base, status: 'consent-required', missingScopes: [] };
  }

  if (error instanceof GraphApiError && error.isAuthError) {
    return {
      ...base,
      status: 'permissions-insufficient',
      missingScopes: [
        {
          scope: 'Organization.Read.All',
          reason: `Graph returned ${error.statusCode} for /organization; grant application permissions and repeat the admin consent`,
        },
      ],
    };
  }

  return { ...base, status: 'error', missingScopes: [] };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
