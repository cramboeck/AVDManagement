/**
 * Vier-Augen-Prinzip: welche Jobs eine zweite Freigabe brauchen
 *
 * Entscheidung aus den MSP-Einstellungen und der Vorschau: entweder ist der
 * Jobtyp gelistet, oder die Zahl der betroffenen Objekte erreicht die
 * Schwelle. Betroffene Objekte = Vorschauzeilen, bei Sammelaktionen die
 * Anzahl Geraete, bei Rollouts die Anzahl Tenants (payload.batchSize).
 */

import type { Job, MspAlertSettings, MspSettings } from '@zerostress/types';
import type { PreviewResult } from './job-types.js';

export const DEFAULT_MSP_SETTINGS: MspSettings = {
  fourEyes: {
    enabled: false,
    minObjects: 10,
    jobTypes: ['device.winget-bulk', 'mailbox.convert', 'mailbox.set-litigation-hold', 'mailbox.set-forwarding', 'vm.deploy', 'identity.disable-user', 'identity.reset-password'],
  },
  alerts: {
    outdatedSoftware: { enabled: false, minDevices: 5 },
    mailboxQuota: { enabled: false, percent: 90 },
    vmOutsideHours: { enabled: false, startHour: 7, endHour: 19, timeZone: 'Europe/Berlin', weekdaysOnly: true, excludeSessionHosts: true, excludeTag: 'zsc-always-on' },
  },
};

function intInRange(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function normalizeAlerts(raw: unknown): MspAlertSettings {
  const d = DEFAULT_MSP_SETTINGS.alerts;
  const input = (raw && typeof raw === 'object' ? raw : {}) as { [K in keyof MspAlertSettings]?: Partial<MspAlertSettings[K]> };
  const os = input.outdatedSoftware ?? {};
  const mq = input.mailboxQuota ?? {};
  const vm = input.vmOutsideHours ?? {};
  const excludeTag = typeof vm.excludeTag === 'string' ? vm.excludeTag.trim().slice(0, 100) : d.vmOutsideHours.excludeTag;
  return {
    outdatedSoftware: { enabled: os.enabled === true, minDevices: intInRange(os.minDevices, 1, 10000, d.outdatedSoftware.minDevices) },
    mailboxQuota: { enabled: mq.enabled === true, percent: intInRange(mq.percent, 50, 100, d.mailboxQuota.percent) },
    vmOutsideHours: {
      enabled: vm.enabled === true,
      startHour: intInRange(vm.startHour, 0, 23, d.vmOutsideHours.startHour),
      endHour: intInRange(vm.endHour, 1, 24, d.vmOutsideHours.endHour),
      timeZone: isValidTimeZone(vm.timeZone) ? vm.timeZone : d.vmOutsideHours.timeZone,
      weekdaysOnly: vm.weekdaysOnly !== false,
      excludeSessionHosts: vm.excludeSessionHosts !== false,
      excludeTag,
    },
  };
}

export function normalizeMspSettings(raw: unknown): MspSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as { fourEyes?: Partial<MspSettings['fourEyes']>; alerts?: unknown };
  const fe: Partial<MspSettings['fourEyes']> = input.fourEyes ?? {};
  return {
    fourEyes: {
      enabled: fe.enabled === true,
      minObjects: intInRange(fe.minObjects, 0, 10000, DEFAULT_MSP_SETTINGS.fourEyes.minObjects),
      jobTypes: Array.isArray(fe.jobTypes) ? fe.jobTypes.filter((t): t is string => typeof t === 'string' && /^[a-z0-9.-]{3,60}$/.test(t)).slice(0, 100) : DEFAULT_MSP_SETTINGS.fourEyes.jobTypes,
    },
    alerts: normalizeAlerts(input.alerts),
  };
}

/** Zahl der Zielobjekte aus der Nutzlast: Ziel-Ids, Geraete, Tenants oder Rollout-Groesse, mindestens 1. */
export function targetCountOf(payload: Record<string, unknown>): number {
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const batch = Number(payload.batchSize ?? 0);
  return Math.max(1, len(payload.targetIds), len(payload.devices), len(payload.tenantIds), Number.isFinite(batch) ? batch : 0);
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
