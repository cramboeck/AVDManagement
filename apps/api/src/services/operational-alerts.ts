/**
 * Betriebs-Alerts je Tenant: veraltete Software, volle Postfaecher, VMs
 * ausserhalb der Arbeitszeit
 *
 * Laeuft im Alert-Takt, aber hoechstens einmal je Stunde und Tenant, weil
 * sich die Bestandsdaten langsam aendern. Software und Postfaecher kommen
 * aus den Inventar-Snapshots, VMs live aus ARM, das aber nur ausserhalb
 * der Arbeitszeit, damit tagsueber kein ARM-Aufruf faellig wird.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { evaluateMailboxQuota, evaluateMonitorStates, evaluateOutdatedSoftware, evaluateVmsOutsideHours, isOutsideWorkingHours } from '@zerostress/core';
import type { Alert, AnomalyFinding, TenantId } from '@zerostress/types';
import { db, managedTenants } from '../db/index.js';
import { toManagedTenant } from './tenant-mapper.js';
import { getMspSettings } from './msp-settings.js';
import { getMailOverview } from './inventory.js';
import { getSoftwareOverview } from './software.js';
import { getRemediationProvider, getVmProvider } from './microsoft-clients.js';
import { notify, storeFindings } from './alerting.js';

const MIN_INTERVAL_MS = 60 * 60 * 1000;
const lastRun = new Map<string, number>();

/**
 * Regeln gegen den Tenant auswerten; force ueberspringt die Stundenbremse
 * (manueller Aufruf aus der Oberflaeche).
 */
export async function evaluateOperationalAlerts(target: { id: string; mspId: string; displayName: string }, force = false, now = new Date()): Promise<Alert[]> {
  const settings = (await getMspSettings(target.mspId)).alerts;
  const anyEnabled = settings.outdatedSoftware.enabled || settings.mailboxQuota.enabled || settings.vmOutsideHours.enabled || settings.monitor.enabled;
  if (!anyEnabled) return [];
  const last = lastRun.get(target.id) ?? 0;
  if (!force && now.getTime() - last < MIN_INTERVAL_MS) return [];
  lastRun.set(target.id, now.getTime());

  const row = await db.query.managedTenants.findFirst({ where: eq(managedTenants.id, target.id) });
  if (!row) return [];
  const tenant = toManagedTenant(row);
  const findings: AnomalyFinding[] = [];

  if (settings.outdatedSoftware.enabled) {
    try {
      const overview = await getSoftwareOverview(tenant);
      if (overview.available) findings.push(...evaluateOutdatedSoftware(tenant.id, overview.data.rows, settings.outdatedSoftware, now));
    } catch (error) {
      console.error(`Operational alert (software) failed for tenant ${tenant.id}:`, error instanceof Error ? error.message : String(error));
    }
  }

  if (settings.mailboxQuota.enabled) {
    try {
      const mail = await getMailOverview(tenant);
      // Anonymisierte Berichte tragen keine Namen; ein Alert ohne Postfach waere wertlos
      if (mail.available && !mail.data.anonymised) findings.push(...evaluateMailboxQuota(tenant.id, mail.data.mailboxes, settings.mailboxQuota, now));
    } catch (error) {
      console.error(`Operational alert (mailbox) failed for tenant ${tenant.id}:`, error instanceof Error ? error.message : String(error));
    }
  }

  if (settings.vmOutsideHours.enabled && isOutsideWorkingHours(now, settings.vmOutsideHours)) {
    try {
      const vms = await getVmProvider().listVms({ tenantId: tenant.id as TenantId, correlationId: randomUUID() });
      findings.push(...evaluateVmsOutsideHours(tenant.id, vms.items, settings.vmOutsideHours, now));
    } catch (error) {
      // Kein Azure-Zugriff ist bei reinen M365-Tenants normal
      console.error(`Operational alert (vm) failed for tenant ${tenant.id}:`, error instanceof Error ? error.message : String(error));
    }
  }

  if (settings.monitor.enabled) {
    try {
      const provider = getRemediationProvider();
      const ctx = { tenantId: tenant.id as TenantId, correlationId: randomUUID() };
      const tenantScriptId = await provider.findTenantScriptId(ctx, 'monitor');
      if (tenantScriptId) {
        const states = await provider.listRunStates(ctx, tenantScriptId);
        findings.push(
          ...evaluateMonitorStates(
            tenant.id,
            states.map((s) => ({ managedDeviceId: s.managedDeviceId, deviceName: s.deviceName, reportedAt: s.state.updatedAt ?? s.state.syncedAt, output: s.state.postOutput || s.state.preOutput || null })),
            settings.monitor,
            now
          )
        );
      }
    } catch (error) {
      console.error(`Operational alert (monitor) failed for tenant ${tenant.id}:`, error instanceof Error ? error.message : String(error));
    }
  }

  if (findings.length === 0) return [];
  const created = await storeFindings(target.mspId, target.id, findings);
  if (created.length > 0) {
    await notify(target.displayName, created).catch((error: Error) => console.error(`Alert mail failed for tenant ${target.id}:`, error.message));
  }
  return created;
}
