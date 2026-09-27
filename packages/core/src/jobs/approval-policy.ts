/**
 * Vier-Augen-Prinzip: welche Jobs eine zweite Freigabe brauchen
 *
 * Entscheidung aus den MSP-Einstellungen und der Vorschau: entweder ist der
 * Jobtyp gelistet, oder die Zahl der betroffenen Objekte erreicht die
 * Schwelle. Betroffene Objekte = Vorschauzeilen, bei Sammelaktionen die
 * Anzahl Geraete, bei Rollouts die Anzahl Tenants (payload.batchSize).
 */

import type { Job, MspSettings } from '@zerostress/types';
import type { PreviewResult } from './job-types.js';

export const DEFAULT_MSP_SETTINGS: MspSettings = {
  fourEyes: {
    enabled: false,
    minObjects: 10,
    jobTypes: ['device.winget-bulk', 'mailbox.convert', 'mailbox.set-litigation-hold', 'mailbox.set-forwarding', 'vm.deploy', 'identity.disable-user', 'identity.reset-password'],
  },
};

export function normalizeMspSettings(raw: unknown): MspSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as { fourEyes?: Partial<MspSettings['fourEyes']> };
  const fe: Partial<MspSettings['fourEyes']> = input.fourEyes ?? {};
  const minObjects = Number(fe.minObjects);
  return {
    fourEyes: {
      enabled: fe.enabled === true,
      minObjects: Number.isInteger(minObjects) && minObjects >= 0 && minObjects <= 10000 ? minObjects : DEFAULT_MSP_SETTINGS.fourEyes.minObjects,
      jobTypes: Array.isArray(fe.jobTypes) ? fe.jobTypes.filter((t): t is string => typeof t === 'string' && /^[a-z0-9.-]{3,60}$/.test(t)).slice(0, 100) : DEFAULT_MSP_SETTINGS.fourEyes.jobTypes,
    },
  };
}

export function affectedObjects(job: Pick<Job, 'payload'>, preview: Pick<PreviewResult, 'changes'>): number {
  const payload = job.payload;
  const batch = Number(payload.batchSize ?? 0);
  const devices = Array.isArray(payload.devices) ? payload.devices.length : 0;
  const tenants = Array.isArray(payload.tenantIds) ? payload.tenantIds.length : 0;
  return Math.max(preview.changes.length, Number.isFinite(batch) ? batch : 0, devices, tenants);
}

export function evaluateFourEyes(settings: MspSettings, job: Pick<Job, 'type' | 'payload'>, preview: Pick<PreviewResult, 'changes'>): { required: boolean; reason: string | null } {
  if (!settings.fourEyes.enabled) return { required: false, reason: null };
  if (settings.fourEyes.jobTypes.includes(job.type)) return { required: true, reason: `Jobtyp ${job.type} verlangt eine zweite Freigabe` };
  const objects = affectedObjects(job, preview);
  if (settings.fourEyes.minObjects > 0 && objects >= settings.fourEyes.minObjects) {
    return { required: true, reason: `${objects} betroffene Objekte (Schwelle ${settings.fourEyes.minObjects})` };
  }
  return { required: false, reason: null };
}
