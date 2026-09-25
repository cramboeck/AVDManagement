/**
 * Policy-Provider: Richtlinien und Einstellungen eines Tenants, die fuer die
 * Best-Practice-Checks gebraucht werden. Nur lesend.
 */

import type { CapabilityResult } from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';
import { GraphApiError } from '../errors.js';

export interface ConditionalAccessPolicy {
  id: string;
  displayName: string;
  state: 'enabled' | 'disabled' | 'enabledForReportingButNotEnforced' | string;
  conditions: {
    users?: { includeUsers?: string[]; excludeUsers?: string[]; includeGroups?: string[]; excludeGroups?: string[]; includeRoles?: string[]; excludeRoles?: string[] } | null;
    applications?: { includeApplications?: string[]; excludeApplications?: string[] } | null;
    clientAppTypes?: string[] | null;
    signInRiskLevels?: string[] | null;
    userRiskLevels?: string[] | null;
    platforms?: { includePlatforms?: string[] } | null;
  };
  grantControls: {
    operator?: string | null;
    builtInControls?: string[] | null;
    authenticationStrength?: { id: string; displayName?: string } | null;
  } | null;
  sessionControls?: unknown;
}

export interface AuthenticationMethodsSnapshot {
  // Methode -> aktiviert
  methods: Record<string, boolean>;
  // Authenticator: Nummernabgleich erzwungen
  numberMatching: boolean | null;
}

export interface AuthorizationPolicySnapshot {
  allowedToCreateApps: boolean | null;
  allowedToCreateSecurityGroups: boolean | null;
  allowInvitesFrom: string | null;
  guestUserRoleId: string | null;
  // Benutzer duerfen Apps selbst zustimmen
  userConsentAllowed: boolean | null;
  allowEmailVerifiedUsersToJoinOrganization: boolean | null;
}

export interface DomainPasswordPolicy {
  domain: string;
  isDefault: boolean;
  passwordValidityPeriodInDays: number | null;
}

export interface TenantPolicySnapshot {
  conditionalAccess: CapabilityResult<ConditionalAccessPolicy[]>;
  securityDefaultsEnabled: CapabilityResult<boolean>;
  authenticationMethods: CapabilityResult<AuthenticationMethodsSnapshot>;
  authorization: CapabilityResult<AuthorizationPolicySnapshot>;
  globalAdminCount: CapabilityResult<number>;
  domains: CapabilityResult<DomainPasswordPolicy[]>;
  compliancePolicyCount: CapabilityResult<number>;
}

// Rollenvorlage Global Administrator
export const GLOBAL_ADMIN_TEMPLATE_ID = '62e90394-69f5-4237-9190-012177145e10';
// Eingeschraenkte Gastrollen (restricted / most restricted)
export const RESTRICTED_GUEST_ROLE_IDS = ['10dae51f-b6af-4016-8d66-8c2a99b929b3', '2af84b1e-32c8-42b7-82bc-daa82404023b'];

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

function asUnavailable(error: unknown, permission: string): Unavailable | null {
  if (!(error instanceof GraphApiError)) return null;
  if (error.isAuthError) {
    return { available: false, reason: 'permission-missing', missingPermission: permission, detail: error.message };
  }
  if (error.statusCode === 404) {
    return { available: false, reason: 'not-licensed', missingPermission: null, detail: error.message };
  }
  return null;
}

export class PolicyProvider extends BaseResourceProvider {
  readonly name = 'policies';
  readonly requiredScopes = ['Policy.Read.All'];
  private readonly directoryScopes = ['Directory.Read.All'];
  private readonly intuneScopes = ['DeviceManagementConfiguration.ReadWrite.All'];

  constructor(private readonly graphClient: GraphClient) {
    super();
  }

  private async guard<T>(permission: string, load: () => Promise<T>): Promise<CapabilityResult<T>> {
    try {
      return { available: true, data: await load() };
    } catch (error) {
      const unavailable = asUnavailable(error, permission);
      if (unavailable) return unavailable;
      throw error;
    }
  }

  async getSnapshot(ctx: ProviderContext): Promise<TenantPolicySnapshot> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const [conditionalAccess, securityDefaultsEnabled, authenticationMethods, authorization, globalAdminCount, domains, compliancePolicyCount] = await Promise.all([
      this.guard('Policy.Read.All', async () => {
        const response = await this.graphClient.get<GraphResponse<ConditionalAccessPolicy[]>>(tenantId, '/identity/conditionalAccess/policies', this.requiredScopes);
        return response.value;
      }),
      this.guard('Policy.Read.All', async () => {
        const policy = await this.graphClient.get<{ isEnabled: boolean }>(tenantId, '/policies/identitySecurityDefaultsEnforcementPolicy', this.requiredScopes);
        return policy.isEnabled === true;
      }),
      this.guard('Policy.Read.All', async () => {
        const policy = await this.graphClient.get<{
          authenticationMethodConfigurations?: { id: string; state: string; featureSettings?: { numberMatchingRequiredState?: { state?: string } } }[];
        }>(tenantId, '/policies/authenticationMethodsPolicy', this.requiredScopes);
        const methods: Record<string, boolean> = {};
        let numberMatching: boolean | null = null;
        for (const m of policy.authenticationMethodConfigurations ?? []) {
          methods[m.id.toLowerCase()] = m.state === 'enabled';
          if (m.id.toLowerCase() === 'microsoftauthenticator') {
            const state = m.featureSettings?.numberMatchingRequiredState?.state;
            numberMatching = state ? state === 'enabled' : null;
          }
        }
        return { methods, numberMatching };
      }),
      this.guard('Policy.Read.All', async () => {
        const policy = await this.graphClient.get<{
          allowInvitesFrom?: string;
          guestUserRoleId?: string;
          allowEmailVerifiedUsersToJoinOrganization?: boolean;
          permissionGrantPolicyIdsAssignedToDefaultUserRole?: string[];
          defaultUserRolePermissions?: { allowedToCreateApps?: boolean; allowedToCreateSecurityGroups?: boolean };
        }>(tenantId, '/policies/authorizationPolicy', this.requiredScopes);
        const grants = policy.permissionGrantPolicyIdsAssignedToDefaultUserRole ?? [];
        return {
          allowedToCreateApps: policy.defaultUserRolePermissions?.allowedToCreateApps ?? null,
          allowedToCreateSecurityGroups: policy.defaultUserRolePermissions?.allowedToCreateSecurityGroups ?? null,
          allowInvitesFrom: policy.allowInvitesFrom ?? null,
          guestUserRoleId: policy.guestUserRoleId ?? null,
          userConsentAllowed: grants.some((g) => /ManagePermissionGrantsForSelf/i.test(g)),
          allowEmailVerifiedUsersToJoinOrganization: policy.allowEmailVerifiedUsersToJoinOrganization ?? null,
        };
      }),
      this.guard('Directory.Read.All', async () => {
        const roles = await this.graphClient.get<GraphResponse<{ id: string }[]>>(
          tenantId,
          `/directoryRoles?$filter=roleTemplateId eq '${GLOBAL_ADMIN_TEMPLATE_ID}'`,
          this.directoryScopes
        );
        const role = roles.value[0];
        if (!role) return 0;
        const members = await this.graphClient.get<GraphResponse<{ id: string }[]>>(tenantId, `/directoryRoles/${role.id}/members?$select=id&$top=999`, this.directoryScopes);
        return members.value.length;
      }),
      this.guard('Directory.Read.All', async () => {
        const response = await this.graphClient.get<GraphResponse<{ id: string; isDefault?: boolean; passwordValidityPeriodInDays?: number | null }[]>>(
          tenantId,
          '/domains?$select=id,isDefault,passwordValidityPeriodInDays',
          this.directoryScopes
        );
        return response.value.map((d) => ({ domain: d.id, isDefault: d.isDefault === true, passwordValidityPeriodInDays: d.passwordValidityPeriodInDays ?? null }));
      }),
      this.guard('DeviceManagementConfiguration.ReadWrite.All', async () => {
        const response = await this.graphClient.get<GraphResponse<{ id: string }[]>>(tenantId, '/deviceManagement/deviceCompliancePolicies?$select=id', this.intuneScopes);
        return response.value.length;
      }),
    ]);

    return { conditionalAccess, securityDefaultsEnabled, authenticationMethods, authorization, globalAdminCount, domains, compliancePolicyCount };
  }
}
