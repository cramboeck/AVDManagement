/**
 * VM-Provider (Azure Resource Manager, Microsoft.Compute)
 *
 * Bestand aller VMs ueber die Subscriptions eines Tenants, Detail mit
 * Instanzzustand, Netzwerkkarten und Datentraegern, Aktionen (Start, Stop,
 * Neustart, Groesse) und Bereitstellung aus ARM-Vorlagen mit Validierung.
 * Braucht die Azure-Rolle Virtual Machine Contributor (Aktionen) und fuer
 * Bereitstellungen Contributor auf der Ressourcengruppe.
 */

import type { AzureResourceGroup, AzureSubnet, AzureVm, AzureVmDetail, AzureVmDisk, AzureVmNic, VmPowerState, VmSizeOption } from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { ArmClient, type ArmResponse } from './arm-client.js';
import { ArmApiError } from '../errors.js';

const COMPUTE_API = '2024-03-01';
const NETWORK_API = '2023-09-01';
const RESOURCES_API = '2021-04-01';
const SUBSCRIPTIONS_API = '2022-12-01';
export const DEPLOYMENT_TIMEOUT_MS = 30 * 60 * 1000;

interface ArmVm {
  id: string;
  name: string;
  location: string;
  tags?: Record<string, string>;
  identity?: { type?: string };
  properties?: {
    hardwareProfile?: { vmSize?: string };
    provisioningState?: string;
    licenseType?: string;
    timeCreated?: string;
    securityProfile?: { securityType?: string };
    osProfile?: { computerName?: string; windowsConfiguration?: unknown; linuxConfiguration?: unknown };
    storageProfile?: {
      imageReference?: { publisher?: string; offer?: string; sku?: string; version?: string; id?: string };
      osDisk?: { name?: string; diskSizeGB?: number; osType?: string; managedDisk?: { storageAccountType?: string } };
      dataDisks?: Array<{ name?: string; diskSizeGB?: number; managedDisk?: { storageAccountType?: string } }>;
    };
    networkProfile?: { networkInterfaces?: Array<{ id: string }> };
    instanceView?: { statuses?: Array<{ code?: string; displayStatus?: string }>; computerName?: string };
  };
  resources?: Array<{ name?: string; properties?: { type?: string; publisher?: string } }>;
}

interface ArmNic {
  id: string;
  name: string;
  properties?: { macAddress?: string; ipConfigurations?: Array<{ properties?: { privateIPAddress?: string; subnet?: { id?: string }; publicIPAddress?: { id?: string } } }> };
}

interface ArmDeployment {
  properties?: { provisioningState?: string; outputs?: Record<string, { value?: unknown }>; error?: { code?: string; message?: string; details?: Array<{ message?: string }> } };
}

export interface DeploymentValidation {
  ok: boolean;
  error: string | null;
  resources: string[];
}

export interface DeploymentOutcome {
  provisioningState: string;
  outputs: Record<string, unknown>;
  error: string | null;
}

export function parseResourceId(id: string): { subscriptionId: string; resourceGroup: string; name: string } {
  const m = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/[^/]+\/[^/]+\/([^/]+)/i.exec(id);
  return { subscriptionId: m?.[1] ?? '', resourceGroup: m?.[2] ?? '', name: m?.[3] ?? id };
}

export function powerStateOf(statuses: Array<{ code?: string }> | undefined): VmPowerState {
  const code = statuses?.map((s) => s.code ?? '').find((c) => c.startsWith('PowerState/')) ?? '';
  const state = code.slice('PowerState/'.length).toLowerCase();
  return (['running', 'stopped', 'deallocated', 'starting', 'stopping', 'deallocating'] as VmPowerState[]).find((s) => s === state) ?? 'unknown';
}

function imageOf(r: { publisher?: string; offer?: string; sku?: string; id?: string } | undefined): string | null {
  if (!r) return null;
  if (r.id) return r.id.split('/').slice(-1)[0] ?? r.id;
  return [r.publisher, r.offer, r.sku].filter(Boolean).join(' / ') || null;
}

function toVm(vm: ArmVm): AzureVm {
  const parsed = parseResourceId(vm.id);
  const p = vm.properties ?? {};
  const os = p.storageProfile?.osDisk?.osType ?? (p.osProfile?.windowsConfiguration ? 'Windows' : p.osProfile?.linuxConfiguration ? 'Linux' : null);
  const extensions = (vm.resources ?? []).map((r) => r.properties?.type ?? r.name ?? '');
  return {
    id: vm.id,
    name: vm.name,
    subscriptionId: parsed.subscriptionId,
    resourceGroup: parsed.resourceGroup,
    location: vm.location,
    vmSize: p.hardwareProfile?.vmSize ?? 'unknown',
    osType: os === 'Windows' || os === 'Linux' ? os : 'unknown',
    powerState: powerStateOf(p.instanceView?.statuses),
    provisioningState: p.provisioningState ?? null,
    computerName: p.instanceView?.computerName ?? p.osProfile?.computerName ?? null,
    imageReference: imageOf(p.storageProfile?.imageReference),
    timeCreated: p.timeCreated ?? null,
    tags: vm.tags ?? {},
    isSessionHost: extensions.some((e) => /DSC|AVD|SessionHost|HostPool/i.test(e)) || Object.keys(vm.tags ?? {}).some((k) => /hostpool|avd/i.test(k)),
  };
}

export class VmProvider extends BaseResourceProvider {
  readonly name = 'vm';
  readonly requiredScopes = ['https://management.azure.com/.default'];
  readonly requiredAzureRoles = ['Reader', 'Virtual Machine Contributor', 'Contributor (Ressourcengruppe, fuer Bereitstellungen)'];

  constructor(private readonly armClient: ArmClient) {
    super();
  }

  async listSubscriptions(ctx: ProviderContext): Promise<Array<{ subscriptionId: string; displayName: string }>> {
    this.validateContext(ctx);
    const res = await this.armClient.get<ArmResponse<Array<{ subscriptionId: string; displayName: string; state: string }>>>(ctx.tenantId as string, '/subscriptions', { apiVersion: SUBSCRIPTIONS_API });
    return res.value.filter((s) => s.state === 'Enabled').map((s) => ({ subscriptionId: s.subscriptionId, displayName: s.displayName }));
  }

  /** Alle VMs aller Subscriptions mit Betriebszustand (statusOnly). */
  async listVms(ctx: ProviderContext): Promise<{ items: AzureVm[]; warnings: string[] }> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const subscriptions = await this.listSubscriptions(ctx);
    const items: AzureVm[] = [];
    const warnings: string[] = [];
    for (const sub of subscriptions) {
      try {
        const vms = await this.armClient.getAllPages<ArmVm>(tenantId, `/subscriptions/${sub.subscriptionId}/providers/Microsoft.Compute/virtualMachines?statusOnly=true`, { apiVersion: COMPUTE_API });
        items.push(...vms.map(toVm));
      } catch (error) {
        warnings.push(`${sub.displayName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { items, warnings };
  }

  async getVm(ctx: ProviderContext, vmResourceId: string): Promise<AzureVmDetail | null> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    let vm: ArmVm;
    try {
      vm = await this.armClient.get<ArmVm>(tenantId, `${vmResourceId}?$expand=instanceView`, { apiVersion: COMPUTE_API });
    } catch (error) {
      if (error instanceof ArmApiError && error.statusCode === 404) return null;
      throw error;
    }
    const base = toVm(vm);
    const p = vm.properties ?? {};
    const nics: AzureVmNic[] = [];
    for (const ref of p.networkProfile?.networkInterfaces ?? []) {
      try {
        const nic = await this.armClient.get<ArmNic>(tenantId, ref.id, { apiVersion: NETWORK_API });
        const cfg = nic.properties?.ipConfigurations?.[0]?.properties;
        let publicIp: string | null = null;
        if (cfg?.publicIPAddress?.id) {
          try {
            const pip = await this.armClient.get<{ properties?: { ipAddress?: string } }>(tenantId, cfg.publicIPAddress.id, { apiVersion: NETWORK_API });
            publicIp = pip.properties?.ipAddress ?? null;
          } catch {
            publicIp = null;
          }
        }
        nics.push({ id: nic.id, name: nic.name, privateIp: cfg?.privateIPAddress ?? null, publicIp, subnetId: cfg?.subnet?.id ?? null, macAddress: nic.properties?.macAddress ?? null });
      } catch {
        nics.push({ id: ref.id, name: ref.id.split('/').pop() ?? ref.id, privateIp: null, publicIp: null, subnetId: null, macAddress: null });
      }
    }
    const disks: AzureVmDisk[] = [];
    const os = p.storageProfile?.osDisk;
    if (os) disks.push({ name: os.name ?? 'osdisk', role: 'os', sizeGb: os.diskSizeGB ?? null, storageType: os.managedDisk?.storageAccountType ?? null });
    for (const d of p.storageProfile?.dataDisks ?? []) disks.push({ name: d.name ?? 'datadisk', role: 'data', sizeGb: d.diskSizeGB ?? null, storageType: d.managedDisk?.storageAccountType ?? null });
    return {
      ...base,
      nics,
      disks,
      statuses: (p.instanceView?.statuses ?? []).map((s) => s.displayStatus ?? s.code ?? '').filter(Boolean),
      licenseType: p.licenseType ?? null,
      securityType: p.securityProfile?.securityType ?? null,
      extensions: (vm.resources ?? []).map((r) => r.name?.split('/').pop() ?? '').filter(Boolean),
      identity: vm.identity?.type ?? null,
    };
  }

  private async action(ctx: ProviderContext, vmResourceId: string, verb: 'start' | 'deallocate' | 'restart'): Promise<void> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const result = await this.armClient.post<{ asyncOperationUrl?: string }>(tenantId, `${vmResourceId}/${verb}`, null, { apiVersion: COMPUTE_API });
    if (result?.asyncOperationUrl) await this.armClient.waitForAsyncOperation(tenantId, result.asyncOperationUrl);
  }

  startVm(ctx: ProviderContext, vmResourceId: string): Promise<void> {
    return this.action(ctx, vmResourceId, 'start');
  }

  /** Stop = deallocate: keine Rechenkosten mehr. */
  stopVm(ctx: ProviderContext, vmResourceId: string): Promise<void> {
    return this.action(ctx, vmResourceId, 'deallocate');
  }

  restartVm(ctx: ProviderContext, vmResourceId: string): Promise<void> {
    return this.action(ctx, vmResourceId, 'restart');
  }

  /** Groesse aendern; laufende VMs startet Azure dafuer neu. */
  async resizeVm(ctx: ProviderContext, vmResourceId: string, vmSize: string): Promise<void> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const result = await this.armClient.patch<{ asyncOperationUrl?: string } | ArmVm>(tenantId, vmResourceId, { properties: { hardwareProfile: { vmSize } } }, { apiVersion: COMPUTE_API });
    if (result && 'asyncOperationUrl' in result && result.asyncOperationUrl) await this.armClient.waitForAsyncOperation(tenantId, result.asyncOperationUrl, 15 * 60 * 1000);
  }

  async listSizes(ctx: ProviderContext, subscriptionId: string, location: string): Promise<VmSizeOption[]> {
    this.validateContext(ctx);
    const res = await this.armClient.get<ArmResponse<Array<{ name: string; numberOfCores: number; memoryInMB: number; maxDataDiskCount: number }>>>(ctx.tenantId as string, `/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${encodeURIComponent(location)}/vmSizes`, { apiVersion: COMPUTE_API });
    return res.value
      .filter((s) => /^Standard_[BDEF]/.test(s.name) && !/Promo|_v1$/.test(s.name))
      .map((s) => ({ name: s.name, cores: s.numberOfCores, memoryMb: s.memoryInMB, maxDataDisks: s.maxDataDiskCount }))
      .sort((a, b) => a.cores - b.cores || a.memoryMb - b.memoryMb || a.name.localeCompare(b.name));
  }

  async listResourceGroups(ctx: ProviderContext, subscriptionId: string): Promise<AzureResourceGroup[]> {
    this.validateContext(ctx);
    const groups = await this.armClient.getAllPages<{ name: string; location: string }>(ctx.tenantId as string, `/subscriptions/${subscriptionId}/resourcegroups`, { apiVersion: RESOURCES_API });
    return groups.map((g) => ({ name: g.name, location: g.location })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async listSubnets(ctx: ProviderContext, subscriptionId: string): Promise<AzureSubnet[]> {
    this.validateContext(ctx);
    const vnets = await this.armClient.getAllPages<{ id: string; name: string; location: string; properties?: { subnets?: Array<{ id: string; name: string; properties?: { addressPrefix?: string; addressPrefixes?: string[] } }> } }>(ctx.tenantId as string, `/subscriptions/${subscriptionId}/providers/Microsoft.Network/virtualNetworks`, { apiVersion: NETWORK_API });
    const out: AzureSubnet[] = [];
    for (const v of vnets) {
      const rg = parseResourceId(v.id).resourceGroup;
      for (const s of v.properties?.subnets ?? []) {
        if (/GatewaySubnet|AzureBastionSubnet|AzureFirewallSubnet/i.test(s.name)) continue;
        out.push({ id: s.id, name: s.name, virtualNetwork: v.name, resourceGroup: rg, location: v.location, addressPrefix: s.properties?.addressPrefix ?? s.properties?.addressPrefixes?.[0] ?? null });
      }
    }
    return out.sort((a, b) => a.virtualNetwork.localeCompare(b.virtualNetwork) || a.name.localeCompare(b.name));
  }

  async ensureResourceGroup(ctx: ProviderContext, subscriptionId: string, name: string, location: string, tags: Record<string, string>): Promise<void> {
    this.validateContext(ctx);
    await this.armClient.put(ctx.tenantId as string, `/subscriptions/${subscriptionId}/resourcegroups/${encodeURIComponent(name)}`, { location, tags }, { apiVersion: RESOURCES_API });
  }

  private deploymentPath(subscriptionId: string, resourceGroup: string, deploymentName: string): string {
    return `/subscriptions/${subscriptionId}/resourcegroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.Resources/deployments/${encodeURIComponent(deploymentName)}`;
  }

  /** Vorlage und Parameter von ARM pruefen lassen, ohne etwas anzulegen. */
  async validateDeployment(ctx: ProviderContext, subscriptionId: string, resourceGroup: string, deploymentName: string, template: Record<string, unknown>, parameters: Record<string, { value: unknown }>): Promise<DeploymentValidation> {
    this.validateContext(ctx);
    try {
      const result = await this.armClient.post<{ asyncOperationUrl?: string; properties?: { validatedResources?: Array<{ id?: string }>; error?: { message?: string } }; error?: { message?: string; details?: Array<{ message?: string }> } }>(
        ctx.tenantId as string,
        `${this.deploymentPath(subscriptionId, resourceGroup, deploymentName)}/validate`,
        { properties: { mode: 'Incremental', template, parameters } },
        { apiVersion: RESOURCES_API, timeoutMs: 120000 }
      );
      if (result?.error) return { ok: false, error: [result.error.message, ...(result.error.details ?? []).map((d) => d.message)].filter(Boolean).join(' / '), resources: [] };
      return { ok: true, error: null, resources: (result?.properties?.validatedResources ?? []).map((r) => r.id ?? '').filter(Boolean) };
    } catch (error) {
      if (error instanceof ArmApiError && error.statusCode === 400) return { ok: false, error: error.message, resources: [] };
      throw error;
    }
  }

  /** Bereitstellung anlegen und auf das Ende warten. */
  async deploy(ctx: ProviderContext, subscriptionId: string, resourceGroup: string, deploymentName: string, template: Record<string, unknown>, parameters: Record<string, { value: unknown }>, timeoutMs = DEPLOYMENT_TIMEOUT_MS): Promise<DeploymentOutcome> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    const path = this.deploymentPath(subscriptionId, resourceGroup, deploymentName);
    await this.armClient.put(tenantId, path, { properties: { mode: 'Incremental', template, parameters } }, { apiVersion: RESOURCES_API, timeoutMs: 120000 });
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const d = await this.armClient.get<ArmDeployment>(tenantId, path, { apiVersion: RESOURCES_API });
      const state = d.properties?.provisioningState ?? 'Unknown';
      if (state === 'Succeeded') {
        const outputs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(d.properties?.outputs ?? {})) outputs[k] = v?.value ?? null;
        return { provisioningState: state, outputs, error: null };
      }
      if (state === 'Failed' || state === 'Canceled') {
        const err = d.properties?.error;
        return { provisioningState: state, outputs: {}, error: [err?.code, err?.message, ...(err?.details ?? []).map((x) => x.message)].filter(Boolean).join(': ') || state };
      }
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
    return { provisioningState: 'Running', outputs: {}, error: `Bereitstellung laeuft nach ${Math.round(timeoutMs / 60000)} Minuten noch; im Azure-Portal pruefen` };
  }
}
