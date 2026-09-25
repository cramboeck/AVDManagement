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
  UserDetail,
  UserGroup,
  UserGroupKind,
  AuthenticationMethod,
  AuthenticationMethodKind,
  AuthenticationMethodsSummary,
  CapabilityResult,
  SignInEvent,
  SignInOutcome,
  SignInQuery,
  DirectoryAuditEvent,
  DirectoryAuditQuery,
  UserStats,
} from '@zerostress/types';
import {
  BaseResourceProvider,
  type ProviderContext,
  type DeltaQueryResult,
  type DeltaQueryOptions,
  type ListOptions,
} from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';
import { GraphApiError } from '../errors.js';

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

interface GraphUserDetail extends GraphUser {
  jobTitle?: string | null;
  department?: string | null;
  officeLocation?: string | null;
  mobilePhone?: string | null;
  businessPhones?: string[];
  city?: string | null;
  country?: string | null;
  usageLocation?: string | null;
  onPremisesSyncEnabled?: boolean | null;
  lastPasswordChangeDateTime?: string | null;
  signInActivity?: {
    lastSignInDateTime?: string | null;
    lastNonInteractiveSignInDateTime?: string | null;
  } | null;
}

interface GraphGroup {
  id: string;
  displayName: string;
  groupTypes?: string[];
  securityEnabled?: boolean;
  mailEnabled?: boolean;
}

interface GraphAuthenticationMethod {
  '@odata.type': string;
  id: string;
  displayName?: string | null;
  phoneNumber?: string | null;
  phoneType?: string | null;
  emailAddress?: string | null;
  model?: string | null;
  deviceTag?: string | null;
  createdDateTime?: string | null;
}

interface GraphSignIn {
  id: string;
  createdDateTime: string;
  userId: string;
  userPrincipalName: string;
  userDisplayName: string;
  appDisplayName: string;
  clientAppUsed?: string | null;
  ipAddress?: string | null;
  isInteractive?: boolean;
  location?: { city?: string | null; state?: string | null; countryOrRegion?: string | null } | null;
  status?: { errorCode?: number; failureReason?: string | null } | null;
  conditionalAccessStatus?: string | null;
  riskLevelDuringSignIn?: string | null;
  authenticationRequirement?: string | null;
  deviceDetail?: {
    operatingSystem?: string | null;
    browser?: string | null;
    isCompliant?: boolean | null;
    isManaged?: boolean | null;
    trustType?: string | null;
  } | null;
}

interface GraphDirectoryAudit {
  id: string;
  activityDateTime: string;
  activityDisplayName: string;
  category: string;
  result?: string | null;
  resultReason?: string | null;
  initiatedBy?: {
    user?: { displayName?: string | null; userPrincipalName?: string | null } | null;
    app?: { displayName?: string | null } | null;
  } | null;
  targetResources?: {
    id?: string | null;
    displayName?: string | null;
    type?: string | null;
    userPrincipalName?: string | null;
    modifiedProperties?: { displayName?: string | null; oldValue?: string | null; newValue?: string | null }[];
  }[];
}

const USER_DETAIL_FIELDS = [
  'id',
  'userPrincipalName',
  'displayName',
  'mail',
  'accountEnabled',
  'userType',
  'createdDateTime',
  'jobTitle',
  'department',
  'officeLocation',
  'mobilePhone',
  'businessPhones',
  'city',
  'country',
  'usageLocation',
  'onPremisesSyncEnabled',
  'lastPasswordChangeDateTime',
].join(',');

// Fehlercodes, die Entra als "unterbrochen" und nicht als Fehlschlag zaehlt
const INTERRUPTED_SIGN_IN_CODES = new Set([
  50140, 50074, 50076, 50072, 50055, 50144, 50097, 50125, 50127, 65001, 16000, 16001, 16003,
]);

const PREMIUM_REQUIRED_CODE = 'Authentication_RequestFromNonPremiumTenantOrB2CTenant';

const AUTH_METHOD_KINDS: Record<string, AuthenticationMethodKind> = {
  '#microsoft.graph.passwordAuthenticationMethod': 'password',
  '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod': 'microsoft-authenticator',
  '#microsoft.graph.phoneAuthenticationMethod': 'phone',
  '#microsoft.graph.fido2AuthenticationMethod': 'fido2',
  '#microsoft.graph.windowsHelloForBusinessAuthenticationMethod': 'windows-hello',
  '#microsoft.graph.softwareOathAuthenticationMethod': 'software-oath',
  '#microsoft.graph.emailAuthenticationMethod': 'email',
  '#microsoft.graph.temporaryAccessPassAuthenticationMethod': 'temporary-access-pass',
};

const MFA_METHOD_KINDS = new Set<AuthenticationMethodKind>([
  'microsoft-authenticator',
  'phone',
  'fido2',
  'windows-hello',
  'software-oath',
]);

const PHISHING_RESISTANT_KINDS = new Set<AuthenticationMethodKind>(['fido2', 'windows-hello']);

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

  // Anmelde- und Verzeichnisprotokolle: zusaetzlich Entra ID P1 im Tenant noetig
  private readonly auditScopes = ['AuditLog.Read.All', 'Directory.Read.All'];

  private readonly authMethodScopes = ['UserAuthenticationMethod.Read.All'];

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

    const deletedIds: string[] = response.value
      .filter((u) => u['@removed'])
      .map((u) => u.id);

    void deletedIds;

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
      const query = [
        '$select=id,userPrincipalName,displayName,mail,accountEnabled,userType,createdDateTime',
        `$top=${pageSize}`,
      ];

      if (filter) {
        query.push(`$filter=${encodeURIComponent(filter)}`);
      }

      // $search ist eine Advanced Query: braucht ConsistencyLevel=eventual und
      // $count=true, laesst sich aber nicht mit $orderby kombinieren
      if (search) {
        const term = search.replace(/"/g, '');
        query.push(`$search=${encodeURIComponent(`"displayName:${term}" OR "mail:${term}"`)}`);
        query.push('$count=true');
      } else {
        query.push('$orderby=displayName');
      }

      url = `/users?${query.join('&')}`;
    }

    const response = search
      ? await this.graphClient.get<GraphResponse<GraphUser[]>>(
          tenantId,
          url,
          this.requiredScopes,
          { headers: { ConsistencyLevel: 'eventual' } }
        )
      : await this.graphClient.get<GraphResponse<GraphUser[]>>(tenantId, url, this.requiredScopes);

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

  /**
   * Passwort zuruecksetzen
   * Generiert ein temporaeres Passwort, das der Benutzer beim naechsten Login aendern muss
   */
  async resetPassword(
    ctx: ProviderContext,
    userId: string
  ): Promise<{ temporaryPassword: string }> {
    this.validateContext(ctx);

    const temporaryPassword = this.generateSecurePassword();

    await this.graphClient.patch(
      ctx.tenantId as string,
      `/users/${userId}`,
      this.licenseWriteScopes,
      {
        passwordProfile: {
          password: temporaryPassword,
          forceChangePasswordNextSignIn: true,
          forceChangePasswordNextSignInWithMfa: false,
        },
      }
    );

    return { temporaryPassword };
  }

  /**
   * Benutzer deaktivieren (Offboarding)
   * Setzt accountEnabled auf false
   */
  async disableUser(
    ctx: ProviderContext,
    userId: string
  ): Promise<void> {
    this.validateContext(ctx);

    await this.graphClient.patch(
      ctx.tenantId as string,
      `/users/${userId}`,
      this.licenseWriteScopes,
      {
        accountEnabled: false,
      }
    );
  }

  /**
   * Benutzer aktivieren
   * Setzt accountEnabled auf true
   */
  async enableUser(
    ctx: ProviderContext,
    userId: string
  ): Promise<void> {
    this.validateContext(ctx);

    await this.graphClient.patch(
      ctx.tenantId as string,
      `/users/${userId}`,
      this.licenseWriteScopes,
      {
        accountEnabled: true,
      }
    );
  }

  /**
   * Alle Sign-In-Sessions widerrufen
   * Wichtig fuer Offboarding - erzwingt Re-Authentifizierung
   */
  async revokeSignInSessions(
    ctx: ProviderContext,
    userId: string
  ): Promise<void> {
    this.validateContext(ctx);

    await this.graphClient.post(
      ctx.tenantId as string,
      `/users/${userId}/revokeSignInSessions`,
      this.licenseWriteScopes,
      {}
    );
  }

  /**
   * Benutzerkennzahlen (Dashboard). $count braucht ConsistencyLevel=eventual.
   */
  async getUserStats(ctx: ProviderContext): Promise<UserStats> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const count = async (filter?: string): Promise<number> => {
      const params = ['$count=true', '$top=1', '$select=id'];
      if (filter) {
        params.push(`$filter=${encodeURIComponent(filter)}`);
      }
      const response = await this.graphClient.get<GraphResponse<GraphUser[]>>(
        tenantId,
        `/users?${params.join('&')}`,
        this.requiredScopes,
        { headers: { ConsistencyLevel: 'eventual' } }
      );
      return response['@odata.count'] ?? response.value.length;
    };

    const [total, disabled, guests] = await Promise.all([
      count(),
      count('accountEnabled eq false'),
      count("userType eq 'Guest'"),
    ]);

    return { total, disabled, guests };
  }

  /**
   * Benutzerdetail inkl. Anmeldeaktivitaet.
   * signInActivity braucht AuditLog.Read.All und Entra ID P1; fehlt eines,
   * lehnt Graph die ganze Anfrage ab, daher zweiter Versuch ohne das Feld.
   */
  async getUserDetail(ctx: ProviderContext, userId: string): Promise<UserDetail | null> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const path = `/users/${encodeURIComponent(userId)}`;

    let user: GraphUserDetail;
    let signInActivityAvailable = true;

    try {
      user = await this.graphClient.get<GraphUserDetail>(
        tenantId,
        `${path}?$select=${USER_DETAIL_FIELDS},signInActivity`,
        [...this.requiredScopes, ...this.auditScopes]
      );
    } catch (error) {
      if (error instanceof GraphApiError && error.statusCode === 404) {
        return null;
      }
      if (!(error instanceof GraphApiError) || !(error.isAuthError || error.statusCode === 400)) {
        throw error;
      }
      signInActivityAvailable = false;
      try {
        user = await this.graphClient.get<GraphUserDetail>(
          tenantId,
          `${path}?$select=${USER_DETAIL_FIELDS}`,
          this.requiredScopes
        );
      } catch (retryError) {
        if (retryError instanceof GraphApiError && retryError.statusCode === 404) {
          return null;
        }
        throw retryError;
      }
    }

    return {
      ...this.mapGraphUserToSyncedUser(ctx.tenantId, user),
      jobTitle: user.jobTitle ?? null,
      department: user.department ?? null,
      officeLocation: user.officeLocation ?? null,
      mobilePhone: user.mobilePhone ?? null,
      businessPhones: user.businessPhones ?? [],
      city: user.city ?? null,
      country: user.country ?? null,
      usageLocation: user.usageLocation ?? null,
      onPremisesSyncEnabled: user.onPremisesSyncEnabled === true,
      lastPasswordChangeAt: user.lastPasswordChangeDateTime ?? null,
      signInActivity:
        signInActivityAvailable && user.signInActivity
          ? {
              lastSignInAt: user.signInActivity.lastSignInDateTime ?? null,
              lastNonInteractiveSignInAt:
                user.signInActivity.lastNonInteractiveSignInDateTime ?? null,
            }
          : null,
    };
  }

  /**
   * Gruppenmitgliedschaften (direkt)
   */
  async getUserGroups(ctx: ProviderContext, userId: string): Promise<UserGroup[]> {
    this.validateContext(ctx);

    const response = await this.graphClient.get<GraphResponse<GraphGroup[]>>(
      ctx.tenantId as string,
      `/users/${encodeURIComponent(userId)}/memberOf/microsoft.graph.group?$select=id,displayName,groupTypes,securityEnabled,mailEnabled&$top=100`,
      this.requiredScopes
    );

    return response.value.map((group) => ({
      id: group.id,
      displayName: group.displayName,
      kind: classifyGroup(group),
    }));
  }

  /**
   * Registrierte Authentifizierungsmethoden (MFA-Status)
   */
  async getUserAuthenticationMethods(
    ctx: ProviderContext,
    userId: string
  ): Promise<CapabilityResult<AuthenticationMethodsSummary>> {
    this.validateContext(ctx);

    let response: GraphResponse<GraphAuthenticationMethod[]>;
    try {
      response = await this.graphClient.get<GraphResponse<GraphAuthenticationMethod[]>>(
        ctx.tenantId as string,
        `/users/${encodeURIComponent(userId)}/authentication/methods`,
        this.authMethodScopes
      );
    } catch (error) {
      const unavailable = asUnavailable(error, 'UserAuthenticationMethod.Read.All');
      if (unavailable) {
        return unavailable;
      }
      throw error;
    }

    const methods = response.value.map(mapAuthenticationMethod);

    return {
      available: true,
      data: {
        methods,
        mfaCapable: methods.some((m) => m.countsAsMfa),
        phishingResistant: methods.some((m) => m.isPhishingResistant),
      },
    };
  }

  /**
   * Anmeldeprotokoll (tenantweit oder pro Benutzer)
   */
  async listSignIns(
    ctx: ProviderContext,
    query: SignInQuery = {}
  ): Promise<CapabilityResult<SignInEvent[]>> {
    this.validateContext(ctx);

    const top = Math.min(Math.max(query.top ?? 50, 1), 500);
    const filters: string[] = [];
    if (query.userId) {
      filters.push(`userId eq '${escapeODataString(query.userId)}'`);
    }
    if (query.since) {
      filters.push(`createdDateTime ge ${new Date(query.since).toISOString()}`);
    }

    // Fehlschlaege werden clientseitig gefiltert: status/errorCode unterstuetzt
    // in Graph kein "ne", daher groesseres Fenster anfordern
    const requestTop = query.failuresOnly ? Math.min(top * 4, 1000) : top;
    const params = [`$top=${requestTop}`];
    if (filters.length > 0) {
      params.push(`$filter=${encodeURIComponent(filters.join(' and '))}`);
    }

    let response: GraphResponse<GraphSignIn[]>;
    try {
      response = await this.graphClient.get<GraphResponse<GraphSignIn[]>>(
        ctx.tenantId as string,
        `/auditLogs/signIns?${params.join('&')}`,
        this.auditScopes
      );
    } catch (error) {
      const unavailable = asUnavailable(error, 'AuditLog.Read.All');
      if (unavailable) {
        return unavailable;
      }
      throw error;
    }

    let events = response.value.map(mapSignIn);
    if (query.failuresOnly) {
      events = events.filter((e) => e.outcome === 'failure').slice(0, top);
    }

    return { available: true, data: events };
  }

  /**
   * Verzeichnis-Audit (Entra-Aenderungen), tenantweit oder pro Zielbenutzer
   */
  async listDirectoryAudits(
    ctx: ProviderContext,
    query: DirectoryAuditQuery = {}
  ): Promise<CapabilityResult<DirectoryAuditEvent[]>> {
    this.validateContext(ctx);

    const top = Math.min(Math.max(query.top ?? 50, 1), 500);
    const filters: string[] = [];
    if (query.userId) {
      filters.push(`targetResources/any(t:t/id eq '${escapeODataString(query.userId)}')`);
    }
    if (query.since) {
      filters.push(`activityDateTime ge ${new Date(query.since).toISOString()}`);
    }

    const params = [`$top=${top}`];
    if (filters.length > 0) {
      params.push(`$filter=${encodeURIComponent(filters.join(' and '))}`);
    }

    let response: GraphResponse<GraphDirectoryAudit[]>;
    try {
      response = await this.graphClient.get<GraphResponse<GraphDirectoryAudit[]>>(
        ctx.tenantId as string,
        `/auditLogs/directoryAudits?${params.join('&')}`,
        this.auditScopes
      );
    } catch (error) {
      const unavailable = asUnavailable(error, 'AuditLog.Read.All');
      if (unavailable) {
        return unavailable;
      }
      throw error;
    }

    return { available: true, data: response.value.map(mapDirectoryAudit) };
  }

  /**
   * Generiert ein sicheres temporaeres Passwort
   * Erfuellt Azure AD Passwort-Anforderungen
   */
  private generateSecurePassword(): string {
    const length = 16;
    const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowercase = 'abcdefghjkmnpqrstuvwxyz';
    const numbers = '23456789';
    const special = '!@#$%&*';
    const all = uppercase + lowercase + numbers + special;

    let password = '';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += special[Math.floor(Math.random() * special.length)];

    for (let i = 4; i < length; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }

    return password.split('').sort(() => Math.random() - 0.5).join('');
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

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

// 403 wegen fehlender Lizenz oder Berechtigung ist ein Zustand, kein Fehler
function asUnavailable(error: unknown, permission: string): Unavailable | null {
  if (!(error instanceof GraphApiError) || !error.isAuthError) {
    return null;
  }
  if (error.graphErrorCode === PREMIUM_REQUIRED_CODE) {
    return { available: false, reason: 'premium-required', missingPermission: null, detail: error.message };
  }
  return { available: false, reason: 'permission-missing', missingPermission: permission, detail: error.message };
}

function classifyGroup(group: GraphGroup): UserGroupKind {
  if (group.groupTypes?.includes('Unified')) {
    return 'microsoft365';
  }
  if (group.mailEnabled && group.securityEnabled) {
    return 'mail-enabled-security';
  }
  if (group.mailEnabled) {
    return 'distribution';
  }
  return 'security';
}

function mapAuthenticationMethod(method: GraphAuthenticationMethod): AuthenticationMethod {
  const kind = AUTH_METHOD_KINDS[method['@odata.type']] ?? 'unknown';
  let detail: string | null = null;

  switch (kind) {
    case 'phone':
      detail = [method.phoneType, maskTail(method.phoneNumber)].filter(Boolean).join(' ') || null;
      break;
    case 'email':
      detail = maskEmail(method.emailAddress);
      break;
    case 'fido2':
      detail = method.model ?? null;
      break;
    case 'microsoft-authenticator':
      detail = method.deviceTag ?? null;
      break;
  }

  return {
    id: method.id,
    kind,
    displayName: method.displayName ?? null,
    detail,
    isPhishingResistant: PHISHING_RESISTANT_KINDS.has(kind),
    countsAsMfa: MFA_METHOD_KINDS.has(kind),
  };
}

function signInOutcome(errorCode: number): SignInOutcome {
  if (errorCode === 0) {
    return 'success';
  }
  return INTERRUPTED_SIGN_IN_CODES.has(errorCode) ? 'interrupted' : 'failure';
}

function mapSignIn(signIn: GraphSignIn): SignInEvent {
  const errorCode = signIn.status?.errorCode ?? 0;
  return {
    id: signIn.id,
    createdAt: signIn.createdDateTime,
    userId: signIn.userId,
    userPrincipalName: signIn.userPrincipalName,
    userDisplayName: signIn.userDisplayName,
    appDisplayName: signIn.appDisplayName,
    clientAppUsed: signIn.clientAppUsed ?? null,
    ipAddress: signIn.ipAddress ?? null,
    location: signIn.location
      ? {
          city: signIn.location.city ?? null,
          state: signIn.location.state ?? null,
          countryOrRegion: signIn.location.countryOrRegion ?? null,
        }
      : null,
    outcome: signInOutcome(errorCode),
    errorCode,
    failureReason: errorCode === 0 ? null : signIn.status?.failureReason ?? null,
    conditionalAccessStatus: oneOf(
      signIn.conditionalAccessStatus,
      ['success', 'failure', 'notApplied'] as const,
      'unknown'
    ),
    authenticationRequirement: oneOf(
      signIn.authenticationRequirement,
      ['singleFactorAuthentication', 'multiFactorAuthentication'] as const,
      'unknown'
    ),
    riskLevel: oneOf(
      signIn.riskLevelDuringSignIn,
      ['none', 'low', 'medium', 'high', 'hidden'] as const,
      'unknown'
    ),
    isInteractive: signIn.isInteractive ?? true,
    device: signIn.deviceDetail
      ? {
          operatingSystem: signIn.deviceDetail.operatingSystem ?? null,
          browser: signIn.deviceDetail.browser ?? null,
          isCompliant: signIn.deviceDetail.isCompliant ?? null,
          isManaged: signIn.deviceDetail.isManaged ?? null,
          trustType: signIn.deviceDetail.trustType ?? null,
        }
      : null,
  };
}

function mapDirectoryAudit(audit: GraphDirectoryAudit): DirectoryAuditEvent {
  const initiatedByUser = audit.initiatedBy?.user;
  const initiatedByApp = audit.initiatedBy?.app;

  return {
    id: audit.id,
    activityAt: audit.activityDateTime,
    activity: audit.activityDisplayName,
    category: audit.category,
    result: oneOf(audit.result, ['success', 'failure', 'timeout'] as const, 'unknown'),
    resultReason: audit.resultReason || null,
    initiatedBy: initiatedByUser?.userPrincipalName || initiatedByUser?.displayName
      ? {
          kind: 'user',
          displayName: initiatedByUser.displayName ?? null,
          userPrincipalName: initiatedByUser.userPrincipalName ?? null,
        }
      : initiatedByApp?.displayName
        ? { kind: 'app', displayName: initiatedByApp.displayName, userPrincipalName: null }
        : { kind: 'unknown', displayName: null, userPrincipalName: null },
    targets: (audit.targetResources ?? []).map((target) => ({
      id: target.id ?? null,
      displayName: target.displayName ?? null,
      type: target.type ?? null,
      userPrincipalName: target.userPrincipalName ?? null,
      modifiedProperties: (target.modifiedProperties ?? [])
        .filter((p) => p.displayName)
        .map((p) => ({
          name: p.displayName as string,
          oldValue: p.oldValue ?? null,
          newValue: p.newValue ?? null,
        })),
    })),
  };
}

function oneOf<T extends string, F extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: F
): T | F {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function maskTail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const digits = value.replace(/\s+/g, '');
  return `***${digits.slice(-3)}`;
}

function maskEmail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const [local, domain] = value.split('@');
  if (!domain) {
    return '***';
  }
  return `${local.slice(0, 1)}***@${domain}`;
}
