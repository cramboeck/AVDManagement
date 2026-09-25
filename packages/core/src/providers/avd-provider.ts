/**
 * AVD-Provider
 *
 * Azure Virtual Desktop Management ueber Azure Resource Manager API.
 * Implementiert Host-Pool-, Session-Host- und Session-Verwaltung.
 */

import type {
  SyncedHostPool,
  SyncedSessionHost,
  UserSession,
  HostPoolSummary,
  AvdOverview,
  HostPoolId,
  SessionHostId,
  AzureResourceId,
  AzureSubscriptionId,
  HostPoolType,
  LoadBalancerType,
  PreferredAppGroupType,
  SessionHostStatus,
  SessionHostHealthStatus,
  UserSessionState,
} from '@zerostress/types';
import {
  BaseResourceProvider,
  type ProviderContext,
} from './resource-provider.js';
import { ArmClient, type ArmResponse, type ArmAsyncOperation } from './arm-client.js';

// Run Command: Ausgabe der Compute-API je Kanal
export interface VmCommandOutput {
  stdout: string | null;
  stderr: string | null;
}

interface RunCommandStatus {
  code: string | null;
  level?: string | null;
  displayStatus?: string | null;
  message: string | null;
}

type RunCommandResponse = { asyncOperationUrl?: string } | { value?: RunCommandStatus[] } | undefined;

interface RunCommandAsyncOperation extends ArmAsyncOperation {
  properties?: { output?: { value?: RunCommandStatus[] } };
}

// Jeder Resource Provider hat eigene API-Versionen; nie die Default-Version
// des ArmClients erben, sondern pro Aufruf explizit setzen
const AVD_API_VERSION = '2024-04-03';
const COMPUTE_API_VERSION = '2024-03-01';
const SUBSCRIPTIONS_API_VERSION = '2022-12-01';

interface AzureHostPool {
  id: string;
  name: string;
  type: string;
  location: string;
  properties: {
    friendlyName?: string;
    description?: string;
    hostPoolType: 'Personal' | 'Pooled';
    personalDesktopAssignmentType?: 'Automatic' | 'Direct';
    loadBalancerType: 'BreadthFirst' | 'DepthFirst' | 'Persistent';
    maxSessionLimit: number;
    preferredAppGroupType: 'Desktop' | 'RailApplications' | 'None';
    validationEnvironment: boolean;
    startVMOnConnect: boolean;
    customRdpProperty?: string;
    vmTemplate?: string;
  };
}

interface AzureSessionHost {
  id: string;
  name: string;
  type: string;
  properties: {
    allowNewSession: boolean;
    assignedUser?: string;
    lastHeartBeat?: string;
    lastUpdateTime?: string;
    osVersion?: string;
    sxSStackVersion?: string;
    sessions: number;
    status: string;
    statusTimestamp?: string;
    resourceId?: string;
    virtualMachineId?: string;
  };
}

interface AzureUserSession {
  id: string;
  name: string;
  type: string;
  properties: {
    userPrincipalName?: string;
    activeDirectoryUserName?: string;
    applicationType: 'Desktop' | 'RemoteApp';
    sessionState: string;
    createTime: string;
  };
}

interface AzureSubscription {
  subscriptionId: string;
  displayName: string;
  state: string;
}

export interface AvdProviderConfig {
  subscriptionIds?: AzureSubscriptionId[];
}

export class AvdProvider extends BaseResourceProvider {
  readonly name = 'avd';
  readonly requiredScopes = ['https://management.azure.com/.default'];

  readonly requiredAzureRoles = [
    'Desktop Virtualization Reader',
    'Desktop Virtualization Contributor',
    'Virtual Machine Contributor',
  ];

  constructor(
    private readonly armClient: ArmClient,
    private readonly config: AvdProviderConfig = {}
  ) {
    super();
  }

  /**
   * Alle Subscriptions abrufen, auf die der Tenant Zugriff hat
   */
  async listSubscriptions(ctx: ProviderContext): Promise<AzureSubscription[]> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const response = await this.armClient.get<ArmResponse<AzureSubscription[]>>(
      tenantId,
      '/subscriptions',
      { apiVersion: SUBSCRIPTIONS_API_VERSION }
    );

    return response.value.filter((s) => s.state === 'Enabled');
  }

  /**
   * Alle Host Pools abrufen (ueber alle Subscriptions)
   */
  async listHostPools(
    ctx: ProviderContext,
    _options: { pageSize?: number; pageToken?: string } = {}
  ): Promise<{ items: SyncedHostPool[]; nextPageToken: string | null; warnings: string[] }> {
    this.validateContext(ctx);

    const { pools, warnings } = await this.collectHostPools(ctx);

    return {
      items: pools.map(({ pool, hosts }) => this.mapAzureHostPoolToSynced(ctx, pool, hosts.length)),
      nextPageToken: null,
      warnings,
    };
  }

  /**
   * Kennzahlen ueber alle Host Pools des Tenants (Dashboard)
   */
  async getAvdOverview(ctx: ProviderContext): Promise<AvdOverview> {
    this.validateContext(ctx);

    const { pools, warnings } = await this.collectHostPools(ctx);
    const overview: AvdOverview = {
      hostPools: pools.length,
      totalHosts: 0,
      availableHosts: 0,
      unavailableHosts: 0,
      shutdownHosts: 0,
      drainingHosts: 0,
      activeSessions: 0,
      maxSessions: 0,
      warnings,
    };

    for (const { pool, hosts } of pools) {
      let available = 0;
      for (const host of hosts) {
        const status = host.properties.status;
        overview.totalHosts += 1;
        overview.activeSessions += host.properties.sessions ?? 0;
        if (status === 'Available') {
          available += 1;
        } else if (status === 'Shutdown') {
          overview.shutdownHosts += 1;
        } else {
          overview.unavailableHosts += 1;
        }
        if (!host.properties.allowNewSession) {
          overview.drainingHosts += 1;
        }
      }
      overview.availableHosts += available;
      overview.maxSessions += available * (pool.properties.maxSessionLimit ?? 0);
    }

    return overview;
  }

  // Host Pools samt Hosts ueber alle erreichbaren Subscriptions einsammeln.
  // Einzelne nicht erreichbare Subscriptions werden zu Warnungen; scheitern
  // alle, ist es ein Fehler und kein Teilergebnis.
  private async collectHostPools(
    ctx: ProviderContext
  ): Promise<{ pools: { pool: AzureHostPool; hosts: AzureSessionHost[] }[]; warnings: string[] }> {
    const tenantId = ctx.tenantId as string;

    const subscriptions = this.config.subscriptionIds?.length
      ? this.config.subscriptionIds
      : await this.listSubscriptions(ctx).then((subs) =>
          subs.map((s) => s.subscriptionId as AzureSubscriptionId)
        );

    if (subscriptions.length === 0) {
      return {
        pools: [],
        warnings: [
          'The service principal has no access to any Azure subscription. Assign Reader and Desktop Virtualization Contributor on the AVD subscription.',
        ],
      };
    }

    const pools: { pool: AzureHostPool; hosts: AzureSessionHost[] }[] = [];
    const warnings: string[] = [];
    const failures: unknown[] = [];

    for (const subscriptionId of subscriptions) {
      try {
        const subscriptionPools = await this.armClient.getAllPages<AzureHostPool>(
          tenantId,
          `/subscriptions/${subscriptionId}/providers/Microsoft.DesktopVirtualization/hostPools`,
          { apiVersion: AVD_API_VERSION }
        );

        for (const pool of subscriptionPools) {
          const hosts = await this.listSessionHostsForPool(ctx, pool.id);
          pools.push({ pool, hosts });
        }
      } catch (error) {
        failures.push(error);
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Subscription ${subscriptionId}: ${message}`);
      }
    }

    if (failures.length === subscriptions.length) {
      throw failures[0];
    }

    return { pools, warnings };
  }

  /**
   * Einzelnen Host Pool abrufen
   */
  async getHostPool(
    ctx: ProviderContext,
    resourceId: string
  ): Promise<SyncedHostPool | null> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    try {
      const pool = await this.armClient.get<AzureHostPool>(
        tenantId,
        resourceId,
        { apiVersion: AVD_API_VERSION }
      );

      const sessionHosts = await this.listSessionHostsForPool(ctx, pool.id);
      return this.mapAzureHostPoolToSynced(ctx, pool, sessionHosts.length);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Session Hosts eines Host Pools abrufen
   */
  async listSessionHosts(
    ctx: ProviderContext,
    hostPoolResourceId: string
  ): Promise<SyncedSessionHost[]> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const sessionHosts = await this.armClient.getAllPages<AzureSessionHost>(
      tenantId,
      `${hostPoolResourceId}/sessionHosts`,
      { apiVersion: AVD_API_VERSION }
    );

    const hostPoolId = this.extractHostPoolId(hostPoolResourceId);
    return sessionHosts.map((sh) =>
      this.mapAzureSessionHostToSynced(ctx, sh, hostPoolId)
    );
  }

  private async listSessionHostsForPool(
    ctx: ProviderContext,
    hostPoolResourceId: string
  ): Promise<AzureSessionHost[]> {
    const tenantId = ctx.tenantId as string;
    return this.armClient.getAllPages<AzureSessionHost>(
      tenantId,
      `${hostPoolResourceId}/sessionHosts`,
      { apiVersion: AVD_API_VERSION }
    );
  }

  /**
   * Einzelnen Session Host abrufen
   */
  async getSessionHost(
    ctx: ProviderContext,
    hostPoolResourceId: string,
    sessionHostName: string
  ): Promise<SyncedSessionHost | null> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    try {
      const sessionHost = await this.armClient.get<AzureSessionHost>(
        tenantId,
        `${hostPoolResourceId}/sessionHosts/${sessionHostName}`,
        { apiVersion: AVD_API_VERSION }
      );

      const hostPoolId = this.extractHostPoolId(hostPoolResourceId);
      return this.mapAzureSessionHostToSynced(ctx, sessionHost, hostPoolId);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * User Sessions eines Session Hosts abrufen
   */
  async listUserSessions(
    ctx: ProviderContext,
    hostPoolResourceId: string,
    sessionHostName: string
  ): Promise<UserSession[]> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const sessions = await this.armClient.getAllPages<AzureUserSession>(
      tenantId,
      `${hostPoolResourceId}/sessionHosts/${sessionHostName}/userSessions`,
      { apiVersion: AVD_API_VERSION }
    );

    const hostPoolId = this.extractHostPoolId(hostPoolResourceId);
    const sessionHostId = this.extractSessionHostId(sessionHostName);

    return sessions.map((s) =>
      this.mapAzureUserSessionToSynced(s, hostPoolId, sessionHostId)
    );
  }

  /**
   * Drain-Modus setzen (allowNewSession)
   */
  async setDrainMode(
    ctx: ProviderContext,
    hostPoolResourceId: string,
    sessionHostName: string,
    allowNewSession: boolean
  ): Promise<void> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    await this.armClient.patch(
      tenantId,
      `${hostPoolResourceId}/sessionHosts/${sessionHostName}`,
      { properties: { allowNewSession } },
      { apiVersion: AVD_API_VERSION }
    );
  }

  /**
   * Benutzer-Session trennen (disconnect)
   */
  async disconnectSession(
    ctx: ProviderContext,
    hostPoolResourceId: string,
    sessionHostName: string,
    sessionId: string
  ): Promise<void> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    await this.armClient.post(
      tenantId,
      `${hostPoolResourceId}/sessionHosts/${sessionHostName}/userSessions/${sessionId}/disconnect`,
      null,
      { apiVersion: AVD_API_VERSION }
    );
  }

  /**
   * Benutzer-Session beenden (logoff)
   */
  async logoffSession(
    ctx: ProviderContext,
    hostPoolResourceId: string,
    sessionHostName: string,
    sessionId: string,
    force: boolean = false
  ): Promise<void> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const url = `${hostPoolResourceId}/sessionHosts/${sessionHostName}/userSessions/${sessionId}`;
    const params = force ? '?force=true' : '';

    await this.armClient.delete(tenantId, `${url}${params}`, { apiVersion: AVD_API_VERSION });
  }

  /**
   * Nachricht an Benutzer-Session senden
   */
  async sendMessage(
    ctx: ProviderContext,
    hostPoolResourceId: string,
    sessionHostName: string,
    sessionId: string,
    messageTitle: string,
    messageBody: string
  ): Promise<void> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    await this.armClient.post(
      tenantId,
      `${hostPoolResourceId}/sessionHosts/${sessionHostName}/userSessions/${sessionId}/sendMessage`,
      { messageTitle, messageBody },
      { apiVersion: AVD_API_VERSION }
    );
  }

  /**
   * VM starten (Session Host)
   */
  async startVm(ctx: ProviderContext, vmResourceId: string): Promise<void> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const result = await this.armClient.post<{ asyncOperationUrl?: string }>(
      tenantId,
      `${vmResourceId}/start`,
      null,
      { apiVersion: COMPUTE_API_VERSION }
    );

    if (result?.asyncOperationUrl) {
      await this.armClient.waitForAsyncOperation(tenantId, result.asyncOperationUrl);
    }
  }

  /**
   * VM stoppen (deallocate - keine Kosten)
   */
  async stopVm(ctx: ProviderContext, vmResourceId: string): Promise<void> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const result = await this.armClient.post<{ asyncOperationUrl?: string }>(
      tenantId,
      `${vmResourceId}/deallocate`,
      null,
      { apiVersion: COMPUTE_API_VERSION }
    );

    if (result?.asyncOperationUrl) {
      await this.armClient.waitForAsyncOperation(tenantId, result.asyncOperationUrl);
    }
  }

  /**
   * VM neustarten
   */
  async restartVm(ctx: ProviderContext, vmResourceId: string): Promise<void> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const result = await this.armClient.post<{ asyncOperationUrl?: string }>(
      tenantId,
      `${vmResourceId}/restart`,
      null,
      { apiVersion: COMPUTE_API_VERSION }
    );

    if (result?.asyncOperationUrl) {
      await this.armClient.waitForAsyncOperation(tenantId, result.asyncOperationUrl);
    }
  }

  /**
   * PowerShell auf einer Azure-VM ueber Run Command (RunPowerShellScript).
   * Synchron aus Sicht des Aufrufers; die Compute-API begrenzt die Ausgabe
   * auf die letzten 4096 Bytes.
   */
  async runCommand(ctx: ProviderContext, vmResourceId: string, scriptLines: string[], timeoutMs = 10 * 60 * 1000): Promise<VmCommandOutput> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const result = await this.armClient.post<RunCommandResponse>(
      tenantId,
      `${vmResourceId}/runCommand`,
      { commandId: 'RunPowerShellScript', script: scriptLines },
      { apiVersion: COMPUTE_API_VERSION, timeoutMs: 60000 }
    );

    let values: RunCommandStatus[] = [];
    if (result && 'asyncOperationUrl' in result && result.asyncOperationUrl) {
      const finished = await this.armClient.waitForAsyncOperationResult<RunCommandAsyncOperation>(tenantId, result.asyncOperationUrl, timeoutMs);
      values = finished.properties?.output?.value ?? [];
    } else if (result && 'value' in result && Array.isArray(result.value)) {
      values = result.value;
    }

    const stdout = values.find((v) => /StdOut/i.test(v.code ?? ''))?.message ?? null;
    const stderr = values.find((v) => /StdErr/i.test(v.code ?? ''))?.message ?? null;
    return { stdout, stderr };
  }

  /**
   * Host-Pool-Zusammenfassung fuer Dashboard
   */
  async getHostPoolSummary(
    ctx: ProviderContext,
    hostPoolResourceId: string
  ): Promise<HostPoolSummary | null> {
    const hostPool = await this.getHostPool(ctx, hostPoolResourceId);
    if (!hostPool) return null;

    const sessionHosts = await this.listSessionHosts(ctx, hostPoolResourceId);

    const availableHosts = sessionHosts.filter((h) => h.status === 'Available').length;
    const unavailableHosts = sessionHosts.filter(
      (h) => h.status === 'Unavailable' || h.status === 'Disconnected'
    ).length;
    const shutdownHosts = sessionHosts.filter((h) => h.status === 'Shutdown').length;
    const hostsInDrainMode = sessionHosts.filter((h) => !h.allowNewSession).length;
    const totalSessions = sessionHosts.reduce((sum, h) => sum + h.sessions, 0);
    const maxSessions = availableHosts * hostPool.maxSessionLimit;
    const utilizationPercent =
      maxSessions > 0 ? Math.round((totalSessions / maxSessions) * 100) : 0;

    return {
      id: hostPool.id,
      name: hostPool.name,
      friendlyName: hostPool.friendlyName,
      hostPoolType: hostPool.hostPoolType,
      totalHosts: sessionHosts.length,
      availableHosts,
      unavailableHosts,
      shutdownHosts,
      hostsInDrainMode,
      totalSessions,
      maxSessions,
      utilizationPercent,
    };
  }

  private mapAzureHostPoolToSynced(
    ctx: ProviderContext,
    pool: AzureHostPool,
    sessionHostCount: number
  ): SyncedHostPool {
    const parts = pool.id.split('/');
    const subscriptionIndex = parts.indexOf('subscriptions');
    const rgIndex = parts.indexOf('resourceGroups');

    return {
      id: pool.id as HostPoolId,
      tenantId: ctx.tenantId,
      mspId: '' as any,
      azureResourceId: pool.id as AzureResourceId,
      azureSubscriptionId: parts[subscriptionIndex + 1] as AzureSubscriptionId,
      resourceGroupName: parts[rgIndex + 1],
      name: pool.name,
      friendlyName: pool.properties.friendlyName ?? null,
      description: pool.properties.description ?? null,
      hostPoolType: pool.properties.hostPoolType as HostPoolType,
      loadBalancerType: pool.properties.loadBalancerType as LoadBalancerType,
      maxSessionLimit: pool.properties.maxSessionLimit,
      preferredAppGroupType: pool.properties.preferredAppGroupType as PreferredAppGroupType,
      validationEnvironment: pool.properties.validationEnvironment,
      startVMOnConnect: pool.properties.startVMOnConnect,
      customRdpProperty: pool.properties.customRdpProperty ?? null,
      personalDesktopAssignmentType: pool.properties.personalDesktopAssignmentType ?? null,
      vmTemplate: pool.properties.vmTemplate ?? null,
      sessionHostCount,
      activeSessionCount: 0,
      syncedAt: new Date(),
    };
  }

  private mapAzureSessionHostToSynced(
    ctx: ProviderContext,
    sh: AzureSessionHost,
    hostPoolId: HostPoolId
  ): SyncedSessionHost {
    return {
      id: sh.id as SessionHostId,
      tenantId: ctx.tenantId,
      mspId: '' as any,
      hostPoolId,
      azureResourceId: sh.id as AzureResourceId,
      vmResourceId: (sh.properties.resourceId as AzureResourceId) ?? null,
      name: sh.name,
      status: sh.properties.status as SessionHostStatus,
      healthStatus: this.deriveHealthStatus(sh.properties.status),
      allowNewSession: sh.properties.allowNewSession,
      sessions: sh.properties.sessions,
      assignedUser: sh.properties.assignedUser ?? null,
      lastHeartbeat: sh.properties.lastHeartBeat
        ? new Date(sh.properties.lastHeartBeat)
        : null,
      osVersion: sh.properties.osVersion ?? null,
      sxSStackVersion: sh.properties.sxSStackVersion ?? null,
      lastUpdateTime: sh.properties.lastUpdateTime
        ? new Date(sh.properties.lastUpdateTime)
        : null,
      statusTimestamp: sh.properties.statusTimestamp
        ? new Date(sh.properties.statusTimestamp)
        : null,
      vmId: sh.properties.virtualMachineId ?? null,
      resourceId: sh.id,
      syncedAt: new Date(),
    };
  }

  private mapAzureUserSessionToSynced(
    session: AzureUserSession,
    hostPoolId: HostPoolId,
    sessionHostId: SessionHostId
  ): UserSession {
    const sessionId = session.name.split('/').pop() ?? session.name;

    return {
      id: sessionId as any,
      sessionHostId,
      hostPoolId,
      userPrincipalName: session.properties.userPrincipalName ?? 'Unknown',
      activeDirectoryUserName: session.properties.activeDirectoryUserName ?? null,
      sessionState: session.properties.sessionState as UserSessionState,
      createTime: new Date(session.properties.createTime),
      applicationType: session.properties.applicationType,
    };
  }

  private deriveHealthStatus(status: string): SessionHostHealthStatus {
    switch (status) {
      case 'Available':
        return 'Healthy';
      case 'Unavailable':
      case 'Disconnected':
      case 'Shutdown':
        return 'Unhealthy';
      case 'NotJoinedToDomain':
        return 'SessionHostNotJoined';
      default:
        return 'NeedsAssistance';
    }
  }

  private extractHostPoolId(resourceId: string): HostPoolId {
    return resourceId as HostPoolId;
  }

  private extractSessionHostId(name: string): SessionHostId {
    return name as SessionHostId;
  }
}
