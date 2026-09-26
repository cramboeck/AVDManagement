/**
 * Jobs fuer Azure-VMs: Start, Stop (deallocate), Neustart, Groesse aendern,
 * Bereitstellung aus einer Vorlage des Katalogs.
 *
 * Bereitstellung: das Cockpit erzeugt das Administratorpasswort selbst,
 * gibt es an ARM und legt es versiegelt im Jobergebnis ab (Anzeige nur mit
 * Begruendung, wie bei LAPS). Vorschau = Validierung durch ARM plus
 * Kostenschaetzung.
 */

import { randomInt } from 'node:crypto';
import type { AzureVmDetail, SealedCipher, VmCostEstimate } from '@zerostress/types';
import { registerJob, type JobContext, type JobResult, type PreviewContext, type PreviewResult } from './job-types.js';
import type { ProviderContext } from '../providers/resource-provider.js';
import type { DeploymentOutcome, DeploymentValidation } from '../providers/vm-provider.js';
import { buildTemplateParameters, getVmTemplate, managedParameterNames, TemplateInputError, type LoadedTemplate } from '../azure/templates.js';

export interface VmOperations {
  getVm(ctx: ProviderContext, vmResourceId: string): Promise<AzureVmDetail | null>;
  startVm(ctx: ProviderContext, vmResourceId: string): Promise<void>;
  stopVm(ctx: ProviderContext, vmResourceId: string): Promise<void>;
  restartVm(ctx: ProviderContext, vmResourceId: string): Promise<void>;
  resizeVm(ctx: ProviderContext, vmResourceId: string, vmSize: string): Promise<void>;
  ensureResourceGroup(ctx: ProviderContext, subscriptionId: string, name: string, location: string, tags: Record<string, string>): Promise<void>;
  validateDeployment(ctx: ProviderContext, subscriptionId: string, resourceGroup: string, deploymentName: string, template: Record<string, unknown>, parameters: Record<string, { value: unknown }>): Promise<DeploymentValidation>;
  deploy(ctx: ProviderContext, subscriptionId: string, resourceGroup: string, deploymentName: string, template: Record<string, unknown>, parameters: Record<string, { value: unknown }>): Promise<DeploymentOutcome>;
  estimateCost(vmSize: string, location: string, osType: 'Windows' | 'Linux'): Promise<VmCostEstimate | null>;
  seal(payload: { output: string | null; outputJson: Record<string, unknown> | null; detectionError: string | null; remediationError: string | null }): Promise<SealedCipher>;
}

export interface VmActionPayload {
  vmResourceId: string;
  vmName: string;
}

export interface VmResizePayload extends VmActionPayload {
  vmSize: string;
}

export interface VmDeployPayload {
  templateId: string;
  subscriptionId: string;
  subscriptionName: string;
  resourceGroup: string;
  location: string;
  parameters: Record<string, unknown>;
}

const RESOURCE_ID = /^\/subscriptions\/[0-9a-fA-F-]{36}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Compute\/virtualMachines\/[^/]+$/i;
const RESOURCE_GROUP = /^[A-Za-z0-9._()-]{1,90}$/;
const LOCATION = /^[a-z0-9]{3,30}$/;
const SUBSCRIPTION = /^[0-9a-fA-F-]{36}$/;
const VM_SIZE = /^[A-Za-z0-9_]{3,40}$/;

function failure(code: string, error: unknown): JobResult {
  return { success: false, error: { code, message: error instanceof Error ? error.message : String(error), retryable: false } };
}

function requireResourceId(id: string): string {
  if (!RESOURCE_ID.test(id)) throw new Error('vmResourceId ist keine VM-Ressourcen-Id');
  return id;
}

/** Zufaelliges Passwort mit allen vier Zeichenklassen, ohne mehrdeutige Zeichen. */
export function generatePassword(length = 20): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!#$%&*+-=?@';
  const all = upper + lower + digits + special;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function deploymentName(vmName: string, jobId: string): string {
  return `zsc-${vmName.toLowerCase().replace(/[^a-z0-9-]/g, '')}-${jobId.slice(0, 8)}`.slice(0, 64);
}

function prepareDeployment(payload: VmDeployPayload): { template: LoadedTemplate; parameters: Record<string, { value: unknown }>; vmName: string; vmSize: string } {
  const template = getVmTemplate(payload.templateId);
  if (!template) throw new Error(`Vorlage ${payload.templateId} nicht im Katalog`);
  if (!SUBSCRIPTION.test(payload.subscriptionId)) throw new Error('subscriptionId ungueltig');
  if (!RESOURCE_GROUP.test(payload.resourceGroup)) throw new Error('resourceGroup ungueltig');
  if (!LOCATION.test(payload.location)) throw new Error('location ungueltig');
  const parameters = buildTemplateParameters(template, payload.parameters ?? {});
  const vmName = String(parameters.vmName?.value ?? '');
  const vmSize = String(parameters.vmSize?.value ?? '');
  if (!vmName) throw new Error('vmName fehlt');
  return { template, parameters, vmName, vmSize };
}

function costLine(cost: VmCostEstimate | null): string {
  if (!cost) return 'keine Preisangabe verfuegbar';
  return `ca. ${cost.monthly.toFixed(0)} ${cost.currency}/Monat bei Dauerbetrieb (${cost.hourly.toFixed(4)} ${cost.currency}/h, ${cost.productName})`;
}

export function registerVmJobs(ops: VmOperations): void {
  const simple = (type: string, displayName: string, verb: 'start' | 'stop' | 'restart', after: string, warnings: (vm: AzureVmDetail | null) => string[]) => {
    registerJob(
      { type, displayName, maxRetries: 1, timeoutSeconds: 600, concurrencyPerTenant: 3, requiresPreview: true },
      async (ctx: JobContext): Promise<JobResult> => {
        const payload = ctx.payload as unknown as VmActionPayload;
        const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
        try {
          const id = requireResourceId(payload.vmResourceId);
          if (verb === 'start') await ops.startVm(providerCtx, id);
          else if (verb === 'stop') await ops.stopVm(providerCtx, id);
          else await ops.restartVm(providerCtx, id);
          const vm = await ops.getVm(providerCtx, id).catch(() => null);
          return { success: true, data: { vmResourceId: id, vmName: payload.vmName, powerState: vm?.powerState ?? 'unknown' } };
        } catch (error) {
          return failure('VM_ACTION_FAILED', error);
        }
      },
      async (ctx: PreviewContext): Promise<PreviewResult> => {
        const payload = ctx.payload as unknown as VmActionPayload;
        const id = requireResourceId(payload.vmResourceId);
        const vm = await ops.getVm({ tenantId: ctx.tenantId, correlationId: `preview-${ctx.tenantId}` }, id);
        return {
          changes: [{ objectType: 'vm', objectId: id, objectDisplayName: payload.vmName, action: 'update', before: { powerState: vm?.powerState ?? 'unbekannt', vmSize: vm?.vmSize ?? '—' }, after: { powerState: after } }],
          warnings: warnings(vm),
          estimatedDurationSeconds: verb === 'start' ? 90 : 60,
        };
      }
    );
  };

  simple('vm.start', 'VM starten', 'start', 'running', (vm) => (vm?.powerState === 'running' ? ['Die VM laeuft bereits; es aendert sich nichts.'] : ['Ab dem Start fallen wieder Rechenkosten an.']));
  simple('vm.stop', 'VM stoppen (deallocate)', 'stop', 'deallocated', (vm) => [
    ...(vm?.powerState === 'deallocated' ? ['Die VM ist bereits freigegeben; es aendert sich nichts.'] : ['Angemeldete Benutzer werden ohne Vorwarnung getrennt; nicht gespeicherte Arbeit geht verloren.']),
    ...(vm?.isSessionHost ? ['Das ist ein AVD-Sitzungshost: vorher Drain-Modus setzen und Sitzungen abmelden (Virtual Desktop).'] : []),
    'Deallocate gibt die Rechenkapazitaet frei (keine Rechenkosten); Datentraeger und IP bleiben, eine dynamische private IP kann sich aendern.',
  ]);
  simple('vm.restart', 'VM neu starten', 'restart', 'running', (vm) => [
    'Angemeldete Benutzer werden getrennt; nicht gespeicherte Arbeit geht verloren.',
    ...(vm?.isSessionHost ? ['AVD-Sitzungshost: vorher Drain-Modus setzen und Sitzungen abmelden.'] : []),
  ]);

  registerJob(
    { type: 'vm.resize', displayName: 'VM-Groesse aendern', maxRetries: 0, timeoutSeconds: 1200, concurrencyPerTenant: 2, requiresPreview: true },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as VmResizePayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      try {
        const id = requireResourceId(payload.vmResourceId);
        if (!VM_SIZE.test(payload.vmSize)) throw new Error('vmSize ungueltig');
        await ops.resizeVm(providerCtx, id, payload.vmSize);
        const vm = await ops.getVm(providerCtx, id).catch(() => null);
        return { success: true, data: { vmResourceId: id, vmName: payload.vmName, vmSize: vm?.vmSize ?? payload.vmSize, powerState: vm?.powerState ?? 'unknown' } };
      } catch (error) {
        return failure('VM_RESIZE_FAILED', error);
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as VmResizePayload;
      const id = requireResourceId(payload.vmResourceId);
      if (!VM_SIZE.test(payload.vmSize)) throw new Error('vmSize ungueltig');
      const vm = await ops.getVm({ tenantId: ctx.tenantId, correlationId: `preview-${ctx.tenantId}` }, id);
      const [before, after] = await Promise.all([vm ? ops.estimateCost(vm.vmSize, vm.location, vm.osType === 'Linux' ? 'Linux' : 'Windows') : Promise.resolve(null), vm ? ops.estimateCost(payload.vmSize, vm.location, vm.osType === 'Linux' ? 'Linux' : 'Windows') : Promise.resolve(null)]);
      const warnings = ['Eine laufende VM wird fuer die Groessenaenderung neu gestartet; angemeldete Benutzer werden getrennt.'];
      if (vm?.vmSize === payload.vmSize) warnings.push('Die VM hat diese Groesse bereits; es aendert sich nichts.');
      if (vm?.isSessionHost) warnings.push('AVD-Sitzungshost: vorher Drain-Modus setzen und Sitzungen abmelden.');
      warnings.push('Ist die Zielgroesse im Cluster nicht verfuegbar, verlangt Azure ein Deallocate vorher; der Job meldet das als Fehler.');
      return {
        changes: [{ objectType: 'vm', objectId: id, objectDisplayName: payload.vmName, action: 'update', before: { vmSize: vm?.vmSize ?? 'unbekannt', kosten: costLine(before) }, after: { vmSize: payload.vmSize, kosten: costLine(after) } }],
        warnings,
        estimatedDurationSeconds: 300,
      };
    }
  );

  registerJob(
    { type: 'vm.deploy', displayName: 'VM aus Vorlage bereitstellen', maxRetries: 0, timeoutSeconds: 2400, concurrencyPerTenant: 1, requiresPreview: true },
    async (ctx: JobContext): Promise<JobResult> => {
      const payload = ctx.payload as unknown as VmDeployPayload;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: ctx.correlationId };
      let prepared;
      try {
        prepared = prepareDeployment(payload);
      } catch (error) {
        return failure('VM_DEPLOY_INVALID', error instanceof TemplateInputError ? error.problems.join('; ') : error);
      }
      const { template, parameters, vmName } = prepared;
      const managed = managedParameterNames(template);
      const password = managed.length > 0 ? generatePassword() : null;
      const armParameters: Record<string, { value: unknown }> = { ...parameters };
      for (const name of managed) armParameters[name] = { value: password };
      const name = deploymentName(vmName, ctx.jobId);
      try {
        const tags = (parameters.tags?.value as Record<string, string> | undefined) ?? {};
        await ops.ensureResourceGroup(providerCtx, payload.subscriptionId, payload.resourceGroup, payload.location, tags);
        const outcome = await ops.deploy(providerCtx, payload.subscriptionId, payload.resourceGroup, name, template.template, armParameters);
        if (outcome.error) return { success: false, data: { deploymentName: name, provisioningState: outcome.provisioningState }, error: { code: 'VM_DEPLOY_FAILED', message: outcome.error, retryable: false } };
        const adminUsername = String(parameters.adminUsername?.value ?? '');
        const cipher = password ? await ops.seal({ output: null, outputJson: { adminUsername, adminPassword: password, vmName, outputs: outcome.outputs }, detectionError: null, remediationError: null }) : null;
        return {
          success: true,
          data: {
            deploymentName: name,
            templateId: template.id,
            templateVersion: template.version,
            vmName,
            vmResourceId: typeof outcome.outputs.vmResourceId === 'string' ? outcome.outputs.vmResourceId : null,
            privateIp: typeof outcome.outputs.privateIp === 'string' ? outcome.outputs.privateIp : null,
            adminUsername: adminUsername || null,
            sealed: cipher !== null,
            cipher,
            scriptId: 'vm-deploy',
          },
        };
      } catch (error) {
        return failure('VM_DEPLOY_FAILED', error);
      }
    },
    async (ctx: PreviewContext): Promise<PreviewResult> => {
      const payload = ctx.payload as unknown as VmDeployPayload;
      let prepared;
      try {
        prepared = prepareDeployment(payload);
      } catch (error) {
        throw new Error(error instanceof TemplateInputError ? error.problems.join('; ') : error instanceof Error ? error.message : String(error));
      }
      const { template, parameters, vmName, vmSize } = prepared;
      const providerCtx = { tenantId: ctx.tenantId, correlationId: `preview-${ctx.tenantId}` };
      const armParameters: Record<string, { value: unknown }> = { ...parameters };
      for (const name of managedParameterNames(template)) armParameters[name] = { value: 'PreviewOnly-Placeholder-1!' };
      const [validation, cost] = await Promise.all([
        ops.validateDeployment(providerCtx, payload.subscriptionId, payload.resourceGroup, `zsc-validate-${ctx.tenantId.slice(0, 8)}`, template.template, armParameters).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error), resources: [] }) as DeploymentValidation),
        ops.estimateCost(vmSize, payload.location, template.osType),
      ]);
      const warnings: string[] = [];
      if (!validation.ok) warnings.push(`ARM-Validierung fehlgeschlagen: ${validation.error}. Der Job wird abgelehnt, solange das so ist.`);
      warnings.push(`Kosten: ${costLine(cost)}; dazu Datentraeger und Netzwerk.`);
      warnings.push('Das Administratorpasswort erzeugt das Cockpit und legt es versiegelt im Jobergebnis ab; Anzeige nur mit Begruendung, Rolle Engineer und Audit.');
      if (parameters.joinEntraId?.value === true) warnings.push('Entra-ID-Join: Anmeldung mit Entra-Konten braucht die Rolle "Virtual Machine Administrator Login" oder "User Login" auf der VM.');
      const shown: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parameters)) shown[k] = k === 'tags' ? JSON.stringify(v.value) : v.value;
      return {
        changes: [
          {
            objectType: 'vm',
            objectId: `${payload.resourceGroup}/${vmName}`,
            objectDisplayName: vmName,
            action: 'create',
            before: {},
            after: { vorlage: `${template.displayName} ${template.version}`, subscription: payload.subscriptionName, resourceGroup: payload.resourceGroup, location: payload.location, ...shown, ressourcen: template.resources.join(', '), validierung: validation.ok ? 'ok' : 'fehlgeschlagen' },
          },
        ],
        warnings,
        estimatedDurationSeconds: 600,
      };
    }
  );
}
