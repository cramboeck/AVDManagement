/**
 * Skriptbibliothek
 *
 * Die PowerShell-Skripte liegen als Dateien unter packages/core/scripts und
 * sind die einzige Quelle: kein Freitext, keine Skripte aus der Datenbank.
 * Jedes Skript ist ueber Version und Hash identifizierbar; beides landet im
 * Audit und in der Beschreibung des Remediation-Objekts im Kundentenant,
 * damit Drift erkennbar ist.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { LibraryScriptId, ScriptLibraryEntry } from '@zerostress/types';

export const SCRIPT_PREFIX = 'ZSC-';
export const SCRIPT_PUBLISHER = 'ZeroStress Cockpit';

interface ScriptDefinition {
  id: LibraryScriptId;
  displayName: string;
  description: string;
  version: string;
  detectionFile: string;
  remediationFile: string | null;
  remediationSummary: string | null;
  expectedDurationSeconds: number;
}

export interface LoadedScript extends ScriptLibraryEntry {
  detectionScript: string;
  remediationScript: string | null;
}

const definitions: ScriptDefinition[] = [
  {
    id: 'update-status',
    displayName: 'Update-Stand',
    description:
      'Liest ausstehende Windows-Updates aus dem lokalen Update-Cache (ohne Online-Scan), meldet Neustartbedarf und die letzten Such- und Installationszeitpunkte.',
    version: '1.0.0',
    detectionFile: 'update-status.detect.ps1',
    remediationFile: null,
    remediationSummary: null,
    expectedDurationSeconds: 180,
  },
  {
    id: 'update-scan',
    displayName: 'Update-Scan starten',
    description:
      'Fuehrt einen Online-Scan gegen die konfigurierte Updatequelle aus (Windows Update, WSUS oder Windows Update for Business) und meldet das Ergebnis. Installiert nichts.',
    version: '1.0.0',
    detectionFile: 'update-scan.detect.ps1',
    remediationFile: 'update-scan.remediate.ps1',
    remediationSummary: 'Startet einen Online-Update-Scan und schreibt das Ergebnis nach %ProgramData%\\ZeroStress\\update-scan.json.',
    expectedDurationSeconds: 300,
  },
  {
    id: 'system-info',
    displayName: 'Systeminfo',
    description:
      'Technischer Zustand: Betriebssystem, Laufzeit, Neustartbedarf, Systemlaufwerk, Speicher, Firmware, TPM, Secure Boot, BitLocker- und Defender-Status. Ohne Benutzerdaten.',
    version: '1.0.0',
    detectionFile: 'system-info.detect.ps1',
    remediationFile: null,
    remediationSummary: null,
    expectedDurationSeconds: 120,
  },
];

// Marker in der Beschreibung des Remediation-Objekts im Tenant
const HASH_MARKER = /\[zsc:hash=([0-9a-f]{64});version=([^\]]+)\]/;

let cache: LoadedScript[] | null = null;

function readScript(file: string): string {
  const url = new URL(`../../scripts/${file}`, import.meta.url);
  const content = readFileSync(url, 'utf8');
  // PowerShell 5.1 auf Geraeten ohne UTF-8-Standard: nur ASCII ist sicher
  const offending = content.split('').find((ch) => ch.charCodeAt(0) > 0x7f);
  if (offending) {
    throw new Error(`Script ${file} contains non-ASCII character U+${offending.charCodeAt(0).toString(16).padStart(4, '0')}`);
  }
  return content.replace(/\r\n/g, '\n');
}

export function computeScriptHash(version: string, detection: string, remediation: string | null): string {
  return createHash('sha256').update(version).update('\n').update(detection).update('\n').update(remediation ?? '').digest('hex');
}

export function loadScriptLibrary(): LoadedScript[] {
  if (cache) return cache;
  cache = definitions.map((def) => {
    const detectionScript = readScript(def.detectionFile);
    const remediationScript = def.remediationFile ? readScript(def.remediationFile) : null;
    return {
      id: def.id,
      displayName: def.displayName,
      description: def.description,
      version: def.version,
      hash: computeScriptHash(def.version, detectionScript, remediationScript),
      runAsAccount: 'system',
      hasRemediation: remediationScript !== null,
      remediationSummary: def.remediationSummary,
      expectedDurationSeconds: def.expectedDurationSeconds,
      detectionScript,
      remediationScript,
    };
  });
  return cache;
}

export function getLibraryScript(id: string): LoadedScript | null {
  return loadScriptLibrary().find((s) => s.id === id) ?? null;
}

export function toLibraryEntry(script: LoadedScript): ScriptLibraryEntry {
  const { detectionScript: _d, remediationScript: _r, ...entry } = script;
  return entry;
}

// Anzeigename im Tenant; fest, damit Objekte wiedergefunden werden
export function tenantDisplayName(script: Pick<LoadedScript, 'id'>): string {
  return `${SCRIPT_PREFIX}${script.id}`;
}

export function tenantDescription(script: Pick<LoadedScript, 'description' | 'hash' | 'version'>): string {
  return `${script.description} Verwaltet von ${SCRIPT_PUBLISHER}, nicht manuell aendern. [zsc:hash=${script.hash};version=${script.version}]`;
}

export function parseTenantDescription(description: string | null | undefined): { hash: string; version: string } | null {
  if (!description) return null;
  const match = HASH_MARKER.exec(description);
  return match ? { hash: match[1], version: match[2] } : null;
}

/**
 * Skriptausgabe deuten: die Bibliothek gibt eine JSON-Zeile aus, Intune
 * liefert sie als Text (auf 2048 Zeichen begrenzt).
 */
export function parseScriptOutput(output: string | null | undefined): Record<string, unknown> | null {
  if (!output) return null;
  const trimmed = output.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
