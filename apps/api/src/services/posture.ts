/**
 * Sicherheitslage eines Tenants: Scores, MFA, Alerts und Verteilungen.
 * Jede Quelle einzeln mit Zeitlimit; es werden nur Kennzahlen geliefert,
 * keine personenbezogenen Daten, daher kein Audit-Eintrag pro Aufruf.
 */

import { randomUUID } from 'node:crypto';
import type {
  CapabilityResult,
  DistributionBucket,
  ManagedTenant,
  SecurityPosture,
  SignInsByDay,
  VulnerabilitySeverity,
} from '@zerostress/types';
import { getDeviceProvider, getIdentityProvider, getSecurityProvider } from './microsoft-clients.js';
import { getDeviceInventory, getTenantVulnerabilities } from './inventory.js';

const SIGN_IN_DAYS = 7;
const SIGN_IN_SAMPLE = 500;

const complianceLabels: Record<string, string> = {
  compliant: 'Konform',
  noncompliant: 'Nicht konform',
  inGracePeriod: 'Kulanzfrist',
  conflict: 'Konflikt',
  error: 'Fehler',
  notApplicable: 'Nicht anwendbar',
  unknown: 'Unbekannt',
  'not-managed': 'Nicht in Intune',
};

const exposureLabels: Record<string, string> = {
  High: 'Hoch',
  Medium: 'Mittel',
  Low: 'Niedrig',
  None: 'Keine',
  Unknown: 'Unbekannt',
  'not-onboarded': 'Nicht in Defender',
};

const severityOrder: VulnerabilitySeverity[] = ['Critical', 'High', 'Medium', 'Low', 'Unknown'];

function timeoutError(label: string): CapabilityResult<never> {
  return { available: false, reason: 'not-onboarded', missingPermission: null, detail: `${label} timed out` };
}

async function guarded<T>(label: string, ms: number, load: () => Promise<CapabilityResult<T>>): Promise<CapabilityResult<T>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CapabilityResult<T>>((resolve) => {
    timer = setTimeout(() => resolve(timeoutError(label)), ms);
  });
  try {
    return await Promise.race([load(), timeout]);
  } catch (error) {
    return {
      available: false,
      reason: 'not-onboarded',
      missingPermission: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function bucketise(values: string[], labels: Record<string, string>, order?: string[]): DistributionBucket[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const keys = order ? order.filter((k) => counts.has(k)) : Array.from(counts.keys());
  const rest = Array.from(counts.keys()).filter((k) => !keys.includes(k));
  return [...keys, ...rest].map((key) => ({ key, label: labels[key] ?? key, count: counts.get(key) ?? 0 }));
}

export async function buildSecurityPosture(tenant: ManagedTenant): Promise<SecurityPosture> {
  const ctx = { tenantId: tenant.id, correlationId: randomUUID() };
  const security = getSecurityProvider();
  const devices = getDeviceProvider();
  const identity = getIdentityProvider();

  const [secureScore, exposureScore, mfa, alerts, deviceStats, vulnerabilities, signIns] = await Promise.all([
    guarded('secure-score', 15000, () => security.getSecureScore(ctx)),
    guarded('exposure-score', 10000, () => devices.getExposureScore(ctx)),
    guarded('mfa-registration', 20000, () => security.getMfaRegistration(ctx)),
    guarded('alerts', 10000, () => security.getOpenAlerts(ctx)),
    // Geraete und Schwachstellen kommen aus dem Bestands-Snapshot
    guarded('devices', 25000, async () => {
      const inventory = await getDeviceInventory(tenant);
      if (!inventory.intune.available && !inventory.defender.available) {
        return inventory.intune;
      }
      const items = inventory.items;
      const osVersions = bucketise(
        items.map((d) => [d.operatingSystem, d.osVersion].filter(Boolean).join(' ') || 'Unbekannt'),
        {}
      )
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
      return {
        available: true,
        data: {
          total: items.length,
          compliance: bucketise(
            items.map((d) => d.intune?.complianceState ?? 'not-managed'),
            complianceLabels,
            ['compliant', 'inGracePeriod', 'noncompliant', 'conflict', 'error', 'notApplicable', 'unknown', 'not-managed']
          ),
          exposure: bucketise(
            items.map((d) => d.defender?.exposureLevel ?? 'not-onboarded'),
            exposureLabels,
            ['High', 'Medium', 'Low', 'None', 'Unknown', 'not-onboarded']
          ),
          osVersions,
        },
      };
    }),
    guarded('vulnerabilities', 25000, async () => {
      const result = await getTenantVulnerabilities(tenant);
      if (!result.available) return result;
      return {
        available: true,
        data: {
          bySeverity: bucketise(
            result.data.items.map((v) => v.severity),
            { Critical: 'Kritisch', High: 'Hoch', Medium: 'Mittel', Low: 'Niedrig', Unknown: 'Unbekannt' },
            severityOrder
          ),
          truncated: result.data.truncated,
        },
      };
    }),
    guarded('sign-ins', 15000, async () => {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - (SIGN_IN_DAYS - 1));
      const result = await identity.listSignIns(ctx, { top: SIGN_IN_SAMPLE, since: since.toISOString() });
      if (!result.available) return result;

      const days: SignInsByDay[] = [];
      for (let i = 0; i < SIGN_IN_DAYS; i += 1) {
        const day = new Date(since);
        day.setUTCDate(since.getUTCDate() + i);
        days.push({ day: day.toISOString().slice(0, 10), success: 0, failure: 0, interrupted: 0 });
      }
      const byDay = new Map(days.map((d) => [d.day, d]));
      for (const event of result.data) {
        const entry = byDay.get(event.createdAt.slice(0, 10));
        if (entry) entry[event.outcome] += 1;
      }
      return { available: true, data: { days, sampled: result.data.length >= SIGN_IN_SAMPLE } };
    }),
  ]);

  return {
    secureScore,
    exposureScore,
    mfa,
    alerts,
    devices: deviceStats,
    vulnerabilities,
    signIns,
    generatedAt: new Date().toISOString(),
  };
}
