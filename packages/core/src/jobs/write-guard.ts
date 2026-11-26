/**
 * Nur-Lese-Betrieb: entscheidet, ob ein Job fuer einen Tenant angelegt,
 * freigegeben oder ausgefuehrt werden darf.
 *
 * Die Sperre wirkt in der Konsole. Sie ersetzt keine App-Registrierung mit
 * nur lesenden Berechtigungen, verhindert aber Bedienfehler und greift auch
 * fuer Jobs, die vor dem Umschalten angelegt wurden (Pruefung beim Ausfuehren).
 */

import type { MspId, TenantAccessMode, TenantId } from '@zerostress/types';
import type { JobDefinition } from './job-types.js';

export interface AccessState {
  // Ganze Konsole im Nur-Lese-Betrieb (CONSOLE_READ_ONLY)
  consoleReadOnly: boolean;
  tenantMode: TenantAccessMode;
}

export interface WriteGuardInput {
  type: string;
  tenantId: TenantId;
  mspId: MspId;
}

export interface WriteGuardDecision {
  scope: 'console' | 'tenant';
  reason: string;
}

/** Liefert den Grund der Sperre oder null, wenn der Job laufen darf. */
export type WriteGuard = (input: WriteGuardInput, definition: JobDefinition) => Promise<WriteGuardDecision | null>;

export function readOnlyDecision(definition: JobDefinition, state: AccessState): WriteGuardDecision | null {
  if (definition.allowedInReadOnly) return null;
  if (state.consoleReadOnly) {
    return { scope: 'console', reason: `Die Konsole laeuft im Nur-Lese-Betrieb; "${definition.displayName}" ist gesperrt.` };
  }
  if (state.tenantMode === 'read-only') {
    return { scope: 'tenant', reason: `Dieser Tenant ist auf Nur-Lesen gestellt; "${definition.displayName}" ist gesperrt.` };
  }
  return null;
}

/** Baut einen WriteGuard aus Konsolen-Schalter und Tenant-Lookup. */
export function createWriteGuard(consoleReadOnly: () => boolean, tenantMode: (tenantId: TenantId) => Promise<TenantAccessMode>): WriteGuard {
  return async (input, definition) => {
    if (definition.allowedInReadOnly) return null;
    // Konsole zuerst: spart den Datenbankzugriff
    if (consoleReadOnly()) return readOnlyDecision(definition, { consoleReadOnly: true, tenantMode: 'full' });
    return readOnlyDecision(definition, { consoleReadOnly: false, tenantMode: await tenantMode(input.tenantId) });
  };
}
