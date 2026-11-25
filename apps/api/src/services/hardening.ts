/**
 * Geraete-Haertung: Zustand des Skripts ZSC-hardening im Tenant und Auswertung
 * der letzten Meldungen je Geraet. Genutzt von der Baselines-Route und den
 * Best-Practice-Checks.
 */

import { randomUUID } from 'node:crypto';
import { HARDENING_CONTROLS, summarizeHardening } from '@zerostress/core';
import type { HardeningStatus, TenantId } from '@zerostress/types';
import { getRemediationProvider } from './microsoft-clients.js';

export async function getHardeningStatus(tenantId: TenantId, correlationId: string = randomUUID()): Promise<HardeningStatus> {
  const ctx = { tenantId, correlationId };
  const provider = getRemediationProvider();
  const schedule = await provider.getScheduleStatus(ctx, 'hardening');
  if (!schedule.tenantScriptId) return { enabled: false, tenantScriptId: null, summary: null, catalog: HARDENING_CONTROLS };
  const enabled = schedule.daily && schedule.allDevices;
  // Auch nach dem Ausschalten bleiben die letzten Meldungen lesbar
  const states = await provider.listRunStates(ctx, schedule.tenantScriptId);
  const summary = summarizeHardening(
    states.map((s) => ({
      managedDeviceId: s.managedDeviceId,
      deviceName: s.deviceName,
      reportedAt: s.state.updatedAt ?? s.state.syncedAt,
      output: s.state.postOutput || s.state.preOutput,
    }))
  );
  return { enabled, tenantScriptId: schedule.tenantScriptId, summary, catalog: HARDENING_CONTROLS };
}
