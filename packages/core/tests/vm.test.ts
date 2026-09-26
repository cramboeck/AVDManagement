/**
 * Tests fuer Vorlagenkatalog, VM-Provider-Helfer und VM-Jobs
 */

import { describe, it, expect, vi } from 'vitest';
import { buildTemplateParameters, getVmTemplate, loadVmTemplates, managedParameterNames, TemplateInputError } from '../src/azure/templates.js';
import { parseResourceId, powerStateOf } from '../src/providers/vm-provider.js';
import { generatePassword, registerVmJobs, type VmOperations } from '../src/jobs/vm-job-handlers.js';
import { getRegisteredJob } from '../src/jobs/job-types.js';
import type { AzureVmDetail, CorrelationId, JobId, MspId, TenantId, UserId } from '@zerostress/types';

const base = { jobId: 'job-abcdef12' as JobId, tenantId: 't' as TenantId, mspId: 'm' as MspId, userId: 'u' as UserId, correlationId: 'c' as CorrelationId, attempt: 0 };
const vmId = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-avd/providers/Microsoft.Compute/virtualMachines/AVD-01';
const subnetId = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet/subnets/clients';

const vm: AzureVmDetail = {
  id: vmId, name: 'AVD-01', subscriptionId: '11111111-1111-1111-1111-111111111111', resourceGroup: 'rg-avd', location: 'westeurope', vmSize: 'Standard_D2s_v5', osType: 'Windows', powerState: 'running', provisioningState: 'Succeeded', computerName: 'AVD-01', imageReference: 'MicrosoftWindowsDesktop / windows-11 / win11-24h2-avd', timeCreated: null, tags: { hostpool: 'hp1' }, isSessionHost: true,
  nics: [], disks: [], statuses: [], licenseType: 'Windows_Client', securityType: 'TrustedLaunch', extensions: [], identity: 'SystemAssigned',
};

describe('template catalogue', () => {
  it('loads the windows template with parameters and managed password', () => {
    const templates = loadVmTemplates();
    expect(templates.map((t) => t.id)).toContain('windows-vm');
    const t = getVmTemplate('windows-vm')!;
    expect(t.parameters.find((p) => p.name === 'adminPassword')?.managed).toBe(true);
    expect(managedParameterNames(t)).toEqual(['adminPassword']);
    expect(t.resources).toContain('Microsoft.Compute/virtualMachines');
  });

  it('validates inputs against the template', () => {
    const t = getVmTemplate('windows-vm')!;
    const params = buildTemplateParameters(t, { vmName: 'CLIENT-01', subnetId, osDiskSizeGb: '256', tags: { owner: 'it' } });
    expect(params.vmName).toEqual({ value: 'CLIENT-01' });
    expect(params.vmSize).toEqual({ value: 'Standard_D2s_v5' });
    expect(params.osDiskSizeGb).toEqual({ value: 256 });
    expect(params.joinEntraId).toEqual({ value: true });
    expect(params.adminPassword).toBeUndefined();
    expect(() => buildTemplateParameters(t, { vmName: 'this-name-is-far-too-long', subnetId })).toThrow(TemplateInputError);
    expect(() => buildTemplateParameters(t, { vmName: 'ok', subnetId: 'nope' })).toThrow(/subnetId/);
    expect(() => buildTemplateParameters(t, { vmName: 'ok', subnetId, osImage: 'ubuntu' })).toThrow(/osImage/);
    expect(() => buildTemplateParameters(t, { vmName: 'ok', subnetId, adminUsername: 'administrator' })).toThrow(/reservierter/);
    expect(() => buildTemplateParameters(t, { vmName: 'ok', subnetId, evil: 'x' })).toThrow(/Unbekannter Parameter/);
  });
});

describe('vm helpers', () => {
  it('parses resource ids and power states', () => {
    expect(parseResourceId(vmId)).toEqual({ subscriptionId: '11111111-1111-1111-1111-111111111111', resourceGroup: 'rg-avd', name: 'AVD-01' });
    expect(powerStateOf([{ code: 'ProvisioningState/succeeded' }, { code: 'PowerState/deallocated' }])).toBe('deallocated');
    expect(powerStateOf(undefined)).toBe('unknown');
  });

  it('generates passwords with all character classes', () => {
    for (let i = 0; i < 20; i += 1) {
      const p = generatePassword();
      expect(p).toHaveLength(20);
      expect(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[!#$%&*+\-=?@]/.test(p)).toBe(true);
    }
  });
});

function ops(over: Partial<VmOperations> = {}): VmOperations {
  return {
    getVm: vi.fn(async () => vm),
    startVm: vi.fn(async () => undefined),
    stopVm: vi.fn(async () => undefined),
    restartVm: vi.fn(async () => undefined),
    resizeVm: vi.fn(async () => undefined),
    ensureResourceGroup: vi.fn(async () => undefined),
    validateDeployment: vi.fn(async () => ({ ok: true, error: null, resources: ['nic', 'vm'] })),
    deploy: vi.fn(async () => ({ provisioningState: 'Succeeded', outputs: { vmResourceId: vmId, privateIp: '10.0.1.5' }, error: null })),
    estimateCost: vi.fn(async (size: string) => ({ vmSize: size, location: 'westeurope', currency: 'EUR', hourly: 0.1, monthly: 73, productName: 'Windows', retrievedAt: 'x' })),
    seal: vi.fn(async () => ({ alg: 'aes-256-gcm', keyId: 'k', iv: 'i', tag: 't', data: 'd' })),
    ...over,
  };
}

describe('vm jobs', () => {
  it('stops a session host with warnings and reports the new state', async () => {
    const o = ops({ getVm: vi.fn(async () => ({ ...vm, powerState: 'deallocated' })) });
    registerVmJobs(o);
    const job = getRegisteredJob('vm.stop')!;
    const preview = await job.previewGenerator!({ ...base, payload: { vmResourceId: vmId, vmName: 'AVD-01' } });
    expect(preview.warnings.some((w) => w.includes('Sitzungshost'))).toBe(true);
    const result = await job.handler({ ...base, payload: { vmResourceId: vmId, vmName: 'AVD-01' } });
    expect(result.success).toBe(true);
    expect(o.stopVm).toHaveBeenCalledWith(expect.anything(), vmId);
    const bad = await job.handler({ ...base, payload: { vmResourceId: '/subscriptions/x/evil', vmName: 'x' } });
    expect(bad.error?.code).toBe('VM_ACTION_FAILED');
  });

  it('previews a resize with cost lines', async () => {
    registerVmJobs(ops());
    const preview = await getRegisteredJob('vm.resize')!.previewGenerator!({ ...base, payload: { vmResourceId: vmId, vmName: 'AVD-01', vmSize: 'Standard_D4s_v5' } });
    expect(preview.changes[0].after).toMatchObject({ vmSize: 'Standard_D4s_v5' });
    expect(String(preview.changes[0].after.kosten)).toContain('EUR/Monat');
  });

  it('deploys from the template with a generated, sealed password', async () => {
    const o = ops();
    registerVmJobs(o);
    const job = getRegisteredJob('vm.deploy')!;
    const payload = { templateId: 'windows-vm', subscriptionId: '11111111-1111-1111-1111-111111111111', subscriptionName: 'Prod', resourceGroup: 'rg-clients', location: 'westeurope', parameters: { vmName: 'CLIENT-01', subnetId } };
    const preview = await job.previewGenerator!({ ...base, payload });
    expect(preview.changes[0].after).toMatchObject({ validierung: 'ok', vmName: 'CLIENT-01', location: 'westeurope' });
    const validateCall = (o.validateDeployment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(validateCall[5].adminPassword.value).toBe('PreviewOnly-Placeholder-1!');
    const result = await job.handler({ ...base, payload });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ vmName: 'CLIENT-01', privateIp: '10.0.1.5', sealed: true, adminUsername: 'zscadmin' });
    const deployCall = (o.deploy as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(deployCall[5].adminPassword.value)).toHaveLength(20);
    expect(deployCall[3]).toMatch(/^zsc-client-01-job-abcd/);
    const sealed = (o.seal as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sealed.outputJson.adminPassword).toBe(deployCall[5].adminPassword.value);
    expect(JSON.stringify(result.data)).not.toContain(deployCall[5].adminPassword.value);

    registerVmJobs(ops({ deploy: vi.fn(async () => ({ provisioningState: 'Failed', outputs: {}, error: 'SkuNotAvailable: size not available' })) }));
    const failed = await getRegisteredJob('vm.deploy')!.handler({ ...base, payload });
    expect(failed.error?.message).toMatch(/SkuNotAvailable/);
    const invalid = await getRegisteredJob('vm.deploy')!.handler({ ...base, payload: { ...payload, parameters: { vmName: 'bad name!', subnetId } } });
    expect(invalid.error?.code).toBe('VM_DEPLOY_INVALID');
  });
});
