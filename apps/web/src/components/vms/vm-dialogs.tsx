'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { SealedResult } from '@/components/devices/sealed-result';
import { LoadingSpinner } from '@/components/ui/loading';
import type { AzureResourceGroup, AzureSubnet, AzureVm, Job, ScriptRunResult, VmCostEstimate, VmSizeOption, VmTemplateSummary } from '@zerostress/types';

export type VmAction = 'start' | 'stop' | 'restart';

const titles: Record<VmAction, string> = { start: 'VM starten', stop: 'VM stoppen (deallocate)', restart: 'VM neu starten' };
const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';

/** Start, Stop, Neustart: direkt der Job mit Vorschau. */
export function VmActionDialog({ tenantId, vm, action, onClose, onCompleted }: { tenantId: string; vm: Pick<AzureVm, 'id' | 'name'>; action: VmAction; onClose: () => void; onCompleted: () => void }) {
  return (
    <JobActionDialog
      title={`${titles[action]}: ${vm.name}`}
      description="Die Vorschau zeigt den aktuellen Zustand; die Aktion steht im Audit."
      confirmLabel={action === 'start' ? 'Starten' : action === 'stop' ? 'Stoppen' : 'Neu starten'}
      tone={action === 'start' ? 'default' : 'destructive'}
      createJob={() => api.post<Job>(`/tenants/${tenantId}/vms/actions/${action}`, { vmResourceId: vm.id, vmName: vm.name })}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}

/** Groesse aendern: Auswahl aus den in der Region verfuegbaren Groessen, dann Job. */
export function ResizeDialog({ tenantId, vm, onClose, onCompleted }: { tenantId: string; vm: Pick<AzureVm, 'id' | 'name' | 'subscriptionId' | 'location' | 'vmSize' | 'osType'>; onClose: () => void; onCompleted: () => void }) {
  const [size, setSize] = useState(vm.vmSize);
  const [submitted, setSubmitted] = useState(false);
  const sizes = useQuery({ queryKey: ['vm-sizes', tenantId, vm.subscriptionId, vm.location], queryFn: () => api.get<{ items: VmSizeOption[] }>(`/tenants/${tenantId}/vms/meta/sizes?subscriptionId=${vm.subscriptionId}&location=${vm.location}`), staleTime: 60 * 60 * 1000 });
  const cost = useQuery({ queryKey: ['vm-cost', size, vm.location, vm.osType], queryFn: () => api.get<{ estimate: VmCostEstimate | null }>(`/tenants/${tenantId}/vms/meta/cost?vmSize=${encodeURIComponent(size)}&location=${vm.location}&osType=${vm.osType === 'Linux' ? 'Linux' : 'Windows'}`), enabled: !!size, staleTime: 60 * 60 * 1000 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitted) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitted]);

  if (submitted) {
    return <JobActionDialog title={`Groesse aendern: ${vm.name}`} description={`${vm.vmSize} -> ${size}. Eine laufende VM wird dafuer neu gestartet.`} confirmLabel="Groesse aendern" tone="destructive" createJob={() => api.post<Job>(`/tenants/${tenantId}/vms/actions/resize`, { vmResourceId: vm.id, vmName: vm.name, vmSize: size })} onClose={onClose} onCompleted={onCompleted} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="vm-resize-title">
        <div className="border-b px-4 py-3">
          <h2 id="vm-resize-title" className="font-medium">
            Groesse aendern: {vm.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Aktuell {vm.vmSize} in {vm.location}. Listenpreise ohne Rabatt, nur zur Einordnung.</p>
        </div>
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (size && size !== vm.vmSize) setSubmitted(true);
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Neue Groesse</span>
            {sizes.isLoading ? (
              <LoadingSpinner size="sm" />
            ) : (
              <select className={inputClass} value={size} onChange={(e) => setSize(e.target.value)}>
                {(sizes.data?.items ?? []).map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} · {s.cores} vCPU · {Math.round(s.memoryMb / 1024)} GB RAM
                  </option>
                ))}
              </select>
            )}
          </label>
          <p className="text-xs text-muted-foreground">{cost.data?.estimate ? `ca. ${cost.data.estimate.monthly.toFixed(0)} ${cost.data.estimate.currency}/Monat bei Dauerbetrieb (${cost.data.estimate.productName})` : cost.isFetching ? 'Preis wird geladen...' : 'Kein Listenpreis fuer diese Groesse gefunden.'}</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Abbrechen
            </button>
            <button type="submit" disabled={!size || size === vm.vmSize} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              Weiter zur Vorschau
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeployForm {
  templateId: string;
  subscriptionId: string;
  subscriptionName: string;
  resourceGroup: string;
  newResourceGroup: string;
  location: string;
  subnetId: string;
  vmName: string;
  vmSize: string;
  osImage: string;
  osDiskType: string;
  osDiskSizeGb: number;
  adminUsername: string;
  joinEntraId: boolean;
  licenseType: string;
  tags: string;
}

function parseTags(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(/[,\n]/)) {
    const [k, ...rest] = part.split('=');
    if (k && k.trim() && rest.length > 0) out[k.trim()] = rest.join('=').trim();
  }
  return out;
}

/** Neue VM aus einer Vorlage des Katalogs: Formular, dann Job mit ARM-Validierung und Kosten in der Vorschau. */
export function DeployVmDialog({ tenantId, onClose, onCompleted }: { tenantId: string; onClose: () => void; onCompleted: () => void }) {
  const [form, setForm] = useState<DeployForm>({ templateId: 'windows-vm', subscriptionId: '', subscriptionName: '', resourceGroup: '', newResourceGroup: '', location: '', subnetId: '', vmName: '', vmSize: 'Standard_D2s_v5', osImage: 'windows-11-multisession-24h2', osDiskType: 'StandardSSD_LRS', osDiskSizeGb: 128, adminUsername: 'zscadmin', joinEntraId: true, licenseType: 'Windows_Client', tags: 'managedBy=ZeroStress' });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof DeployForm>(key: K, value: DeployForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const templates = useQuery({ queryKey: ['vm-templates'], queryFn: () => api.get<{ items: VmTemplateSummary[] }>(`/tenants/${tenantId}/vms/meta/templates`), staleTime: Infinity });
  const subscriptions = useQuery({ queryKey: ['vm-subscriptions', tenantId], queryFn: () => api.get<{ items: Array<{ subscriptionId: string; displayName: string }> }>(`/tenants/${tenantId}/vms/meta/subscriptions`), staleTime: 60 * 60 * 1000 });
  const groups = useQuery({ queryKey: ['vm-rgs', tenantId, form.subscriptionId], queryFn: () => api.get<{ items: AzureResourceGroup[] }>(`/tenants/${tenantId}/vms/meta/resource-groups?subscriptionId=${form.subscriptionId}`), enabled: !!form.subscriptionId, staleTime: 10 * 60 * 1000 });
  const subnets = useQuery({ queryKey: ['vm-subnets', tenantId, form.subscriptionId], queryFn: () => api.get<{ items: AzureSubnet[] }>(`/tenants/${tenantId}/vms/meta/subnets?subscriptionId=${form.subscriptionId}`), enabled: !!form.subscriptionId, staleTime: 10 * 60 * 1000 });
  const sizes = useQuery({ queryKey: ['vm-sizes', tenantId, form.subscriptionId, form.location], queryFn: () => api.get<{ items: VmSizeOption[] }>(`/tenants/${tenantId}/vms/meta/sizes?subscriptionId=${form.subscriptionId}&location=${form.location}`), enabled: !!form.subscriptionId && !!form.location, staleTime: 60 * 60 * 1000 });
  const template = templates.data?.items.find((t) => t.id === form.templateId) ?? null;
  const cost = useQuery({ queryKey: ['vm-cost', form.vmSize, form.location, template?.osType ?? 'Windows'], queryFn: () => api.get<{ estimate: VmCostEstimate | null }>(`/tenants/${tenantId}/vms/meta/cost?vmSize=${encodeURIComponent(form.vmSize)}&location=${form.location}&osType=${template?.osType ?? 'Windows'}`), enabled: !!form.vmSize && !!form.location, staleTime: 60 * 60 * 1000 });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitted) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitted]);

  // Standort aus Subnetz oder Ressourcengruppe ableiten, damit alles in einer Region liegt
  useEffect(() => {
    const subnet = subnets.data?.items.find((s) => s.id === form.subnetId);
    if (subnet && subnet.location !== form.location) set('location', subnet.location);
  }, [form.subnetId, form.location, subnets.data]);

  const imageOptions = useMemo(() => (template?.parameters.find((p) => p.name === 'osImage')?.allowedValues ?? []) as string[], [template]);
  const diskTypes = useMemo(() => (template?.parameters.find((p) => p.name === 'osDiskType')?.allowedValues ?? []) as string[], [template]);
  const licenseTypes = useMemo(() => (template?.parameters.find((p) => p.name === 'licenseType')?.allowedValues ?? []) as string[], [template]);
  const resourceGroup = form.resourceGroup === '__new__' ? form.newResourceGroup.trim() : form.resourceGroup;
  const valid = !!template && !!form.subscriptionId && !!resourceGroup && !!form.location && !!form.subnetId && /^[A-Za-z0-9][A-Za-z0-9-]{0,14}$/.test(form.vmName) && !!form.vmSize;

  if (submitted && template) {
    const body = {
      templateId: template.id,
      subscriptionId: form.subscriptionId,
      subscriptionName: form.subscriptionName,
      resourceGroup,
      location: form.location,
      parameters: { vmName: form.vmName, vmSize: form.vmSize, subnetId: form.subnetId, osImage: form.osImage, osDiskType: form.osDiskType, osDiskSizeGb: form.osDiskSizeGb, adminUsername: form.adminUsername, joinEntraId: form.joinEntraId, licenseType: form.licenseType, tags: parseTags(form.tags) },
    };
    return (
      <JobActionDialog
        title={`VM bereitstellen: ${form.vmName}`}
        description="Die Vorschau enthaelt die ARM-Validierung und die Kostenschaetzung. Das Administratorpasswort wird erzeugt und versiegelt im Ergebnis abgelegt."
        confirmLabel="Bereitstellen"
        createJob={() => api.post<Job>(`/tenants/${tenantId}/vms/actions/deploy`, body)}
        renderResult={(job) => <DeployResult tenantId={tenantId} job={job} />}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="vm-deploy-title">
        <div className="border-b px-4 py-3">
          <h2 id="vm-deploy-title" className="font-medium">
            Neue VM aus Vorlage
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Versionierte Vorlage aus dem Repo, Parameter je Kunde, Kosten vor der Freigabe. Kein oeffentlicher Zugang, Trusted Launch, optional Entra-Join.</p>
        </div>
        <form
          className="space-y-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) setSubmitted(true);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Vorlage</span>
              <select className={inputClass} value={form.templateId} onChange={(e) => set('templateId', e.target.value)}>
                {(templates.data?.items ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName} ({t.version})
                  </option>
                ))}
              </select>
              {template && <span className="mt-0.5 block text-xs text-muted-foreground">{template.description}</span>}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Subscription</span>
              <select
                className={inputClass}
                value={form.subscriptionId}
                onChange={(e) => {
                  const s = subscriptions.data?.items.find((x) => x.subscriptionId === e.target.value);
                  setForm((f) => ({ ...f, subscriptionId: e.target.value, subscriptionName: s?.displayName ?? '', resourceGroup: '', subnetId: '', location: '' }));
                }}
              >
                <option value="">waehlen...</option>
                {(subscriptions.data?.items ?? []).map((s) => (
                  <option key={s.subscriptionId} value={s.subscriptionId}>
                    {s.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Ressourcengruppe</span>
              <select
                className={inputClass}
                disabled={!form.subscriptionId}
                value={form.resourceGroup}
                onChange={(e) => {
                  const g = groups.data?.items.find((x) => x.name === e.target.value);
                  setForm((f) => ({ ...f, resourceGroup: e.target.value, location: g?.location ?? f.location }));
                }}
              >
                <option value="">waehlen...</option>
                {(groups.data?.items ?? []).map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name} ({g.location})
                  </option>
                ))}
                <option value="__new__">Neue Ressourcengruppe...</option>
              </select>
              {form.resourceGroup === '__new__' && <input className={`${inputClass} mt-1`} value={form.newResourceGroup} onChange={(e) => set('newResourceGroup', e.target.value)} placeholder="rg-kunde-clients" />}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Subnetz</span>
              <select className={inputClass} disabled={!form.subscriptionId} value={form.subnetId} onChange={(e) => set('subnetId', e.target.value)}>
                <option value="">waehlen...</option>
                {(subnets.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.virtualNetwork} / {s.name} ({s.addressPrefix ?? '?'}, {s.location})
                  </option>
                ))}
              </select>
              <span className="mt-0.5 block text-xs text-muted-foreground">Region: {form.location || 'aus Subnetz oder Ressourcengruppe'}</span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">VM-Name</span>
              <input className={inputClass} value={form.vmName} onChange={(e) => set('vmName', e.target.value.toUpperCase())} placeholder="KUNDE-CL01" maxLength={15} />
              <span className="mt-0.5 block text-xs text-muted-foreground">1-15 Zeichen, auch Computername</span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Groesse</span>
              {form.location && sizes.data ? (
                <select className={inputClass} value={form.vmSize} onChange={(e) => set('vmSize', e.target.value)}>
                  {sizes.data.items.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} · {s.cores} vCPU · {Math.round(s.memoryMb / 1024)} GB
                    </option>
                  ))}
                </select>
              ) : (
                <input className={inputClass} value={form.vmSize} onChange={(e) => set('vmSize', e.target.value)} />
              )}
              <span className="mt-0.5 block text-xs text-muted-foreground">{cost.data?.estimate ? `ca. ${cost.data.estimate.monthly.toFixed(0)} ${cost.data.estimate.currency}/Monat bei Dauerbetrieb` : 'Preis erscheint nach Wahl der Region'}</span>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Betriebssystem</span>
              <select className={inputClass} value={form.osImage} onChange={(e) => set('osImage', e.target.value)}>
                {imageOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Lizenz (Hybrid Benefit)</span>
              <select className={inputClass} value={form.licenseType} onChange={(e) => set('licenseType', e.target.value)}>
                {licenseTypes.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">OS-Festplatte</span>
              <div className="flex gap-2">
                <select className={inputClass} value={form.osDiskType} onChange={(e) => set('osDiskType', e.target.value)}>
                  {diskTypes.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input type="number" min={64} max={2048} className={`${inputClass} w-28`} value={form.osDiskSizeGb} onChange={(e) => set('osDiskSizeGb', Number(e.target.value))} />
              </div>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Lokaler Administrator</span>
              <input className={inputClass} value={form.adminUsername} onChange={(e) => set('adminUsername', e.target.value)} />
              <span className="mt-0.5 block text-xs text-muted-foreground">Passwort erzeugt das Cockpit; Anzeige nur mit Begruendung.</span>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Tags</span>
              <input className={inputClass} value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="kunde=Contoso, kostenstelle=1234" />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.joinEntraId} onChange={(e) => set('joinEntraId', e.target.checked)} />
              Entra-ID-Join (Erweiterung AADLoginForWindows)
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Abbrechen
            </button>
            <button type="submit" disabled={!valid} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              Weiter zur Vorschau
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeployResult({ tenantId, job }: { tenantId: string; job: Job }) {
  const r = job.result as { vmName?: string; privateIp?: string | null; adminUsername?: string | null; sealed?: boolean; deploymentName?: string } | null;
  if (!r) return <p className="text-sm text-muted-foreground">{job.error ?? 'Kein Ergebnis.'}</p>;
  return (
    <div className="space-y-2 text-sm">
      <p>
        <strong>{r.vmName}</strong> bereitgestellt{r.privateIp ? `, private IP ${r.privateIp}` : ''}. Deployment {r.deploymentName}.
      </p>
      {r.sealed && (
        <SealedResult
          tenantId={tenantId}
          jobId={job.id}
          result={job.result as unknown as ScriptRunResult}
          render={(revealed) => {
            const json = revealed.outputJson as { adminUsername?: string; adminPassword?: string } | null;
            return (
              <p className="font-mono text-sm">
                {json?.adminUsername ?? r.adminUsername} / {json?.adminPassword ?? '—'}
              </p>
            );
          }}
        />
      )}
    </div>
  );
}
