/**
 * Geraete-Haertung: Katalog der Kontrollen des Skripts ZSC-hardening und
 * Auswertung ueber alle Geraete eines Tenants
 *
 * Der Katalog ist aus der oeffentlichen Microsoft-Dokumentation zur
 * Windows-Sicherheitsbaseline und zu Defender abgeleitet. Er enthaelt keine
 * CIS-Nummern oder -Texte (Lizenz, siehe Setup-Doku). Ids muessen mit dem
 * Skript packages/core/scripts/hardening.detect.ps1 uebereinstimmen; ein
 * Test prueft das.
 */

import type { HardeningControl, HardeningControlResult, HardeningDeviceResult, HardeningSummary } from '@zerostress/types';

export const HARDENING_CONTROLS: HardeningControl[] = [
  { id: 'smb1-disabled', area: 'network', weight: 3, title: 'SMBv1 deaktiviert', recommendation: 'SMBv1-Server deaktivieren (Intune: Einstellungskatalog bzw. Windows-Baseline "SMB v1 client driver/server" deaktivieren).' },
  { id: 'smb-server-signing', area: 'network', weight: 2, title: 'SMB-Signatur als Server erforderlich', recommendation: 'Microsoft-Netzwerkserver: Kommunikation immer digital signieren = aktiviert.' },
  { id: 'smb-client-signing', area: 'network', weight: 2, title: 'SMB-Signatur als Client erforderlich', recommendation: 'Microsoft-Netzwerkclient: Kommunikation immer digital signieren = aktiviert.' },
  { id: 'llmnr-disabled', area: 'network', weight: 2, title: 'LLMNR deaktiviert', recommendation: 'DNS-Client: Multicast-Namensaufloesung deaktivieren (Schutz vor Namensvergiftung im LAN).' },
  { id: 'wdigest-disabled', area: 'credentials', weight: 3, title: 'WDigest speichert keine Klartext-Kennwoerter', recommendation: 'WDigest-Authentifizierung deaktivieren (UseLogonCredential = 0).' },
  { id: 'lsa-protection', area: 'credentials', weight: 3, title: 'LSA-Schutz aktiv', recommendation: 'LSA als geschuetzten Prozess ausfuehren (RunAsPPL), ueber Intune Einstellungskatalog "Configure LSA Protected Process".' },
  { id: 'credential-guard', area: 'credentials', weight: 2, title: 'Credential Guard laeuft', recommendation: 'Credential Guard per Intune (Kontoschutz oder Einstellungskatalog) aktivieren; braucht Virtualisierungsbasierte Sicherheit.' },
  { id: 'ntlmv2-only', area: 'credentials', weight: 2, title: 'Nur NTLMv2, LM und NTLM verweigert', recommendation: 'Netzwerksicherheit: LAN Manager-Authentifizierungsebene = Nur NTLMv2-Antworten senden, LM und NTLM verweigern.' },
  { id: 'no-lm-hash', area: 'credentials', weight: 1, title: 'Keine LM-Hashes gespeichert', recommendation: 'Netzwerksicherheit: Keine LAN Manager-Hashwerte speichern = aktiviert.' },
  { id: 'anonymous-restricted', area: 'credentials', weight: 1, title: 'Anonyme Aufzaehlung eingeschraenkt', recommendation: 'Netzwerkzugriff: Anonyme Aufzaehlung von SAM-Konten und Freigaben nicht erlauben.' },
  { id: 'uac-secure-desktop', area: 'system', weight: 2, title: 'UAC aktiv mit sicherem Desktop', recommendation: 'Benutzerkontensteuerung aktiviert lassen und Abfragen auf dem sicheren Desktop anzeigen.' },
  { id: 'autorun-disabled', area: 'system', weight: 1, title: 'Autorun fuer Laufwerke aus', recommendation: 'Automatische Wiedergabe fuer alle Laufwerke deaktivieren.' },
  { id: 'firewall-all-profiles', area: 'system', weight: 3, title: 'Firewall in allen Profilen an', recommendation: 'Defender Firewall fuer Domaene, Privat und Oeffentlich per Intune-Endpunktsicherheit aktivieren.' },
  { id: 'rdp-nla', area: 'system', weight: 2, title: 'RDP nur mit Authentifizierung auf Netzwerkebene', recommendation: 'Wenn Remotedesktop aktiv ist: Benutzerauthentifizierung auf Netzwerkebene erzwingen.' },
  { id: 'remote-registry-off', area: 'system', weight: 1, title: 'Remoteregistrierung aus', recommendation: 'Dienst Remoteregistrierung deaktivieren.' },
  { id: 'ps-scriptblock-logging', area: 'logging', weight: 2, title: 'PowerShell-Skriptblockprotokollierung', recommendation: 'PowerShell: Skriptblockprotokollierung aktivieren (wichtig fuer Defender und Forensik).' },
  { id: 'process-cmdline-audit', area: 'logging', weight: 1, title: 'Befehlszeile in Prozessereignissen', recommendation: 'Befehlszeile in Prozesserstellungsereignisse aufnehmen.' },
  { id: 'security-log-size', area: 'logging', weight: 1, title: 'Sicherheitsprotokoll mindestens 192 MB', recommendation: 'Maximale Groesse des Sicherheitsprotokolls auf mindestens 196608 KB setzen.' },
  { id: 'ps-v2-removed', area: 'logging', weight: 2, title: 'PowerShell 2.0 entfernt', recommendation: 'Optionales Feature "Windows PowerShell 2.0" entfernen (umgeht sonst Protokollierung und AMSI).' },
  { id: 'bitlocker-os', area: 'encryption', weight: 3, title: 'BitLocker auf dem Systemlaufwerk', recommendation: 'BitLocker per Intune-Datentraegerverschluesselung erzwingen, Schluessel in Entra sichern.' },
  { id: 'secure-boot', area: 'encryption', weight: 2, title: 'Secure Boot aktiv', recommendation: 'Secure Boot im UEFI aktivieren; in der Compliance-Richtlinie verlangen.' },
  { id: 'defender-tamper-protection', area: 'defender', weight: 3, title: 'Defender-Manipulationsschutz', recommendation: 'Manipulationsschutz im Defender-Portal oder per Intune aktivieren.' },
  { id: 'defender-pua', area: 'defender', weight: 1, title: 'Schutz vor unerwuenschten Apps (PUA)', recommendation: 'PUA-Schutz im Blockmodus aktivieren.' },
  { id: 'defender-asr', area: 'defender', weight: 2, title: 'ASR-Regeln im Blockmodus', recommendation: 'Regeln zur Verringerung der Angriffsflaeche per Intune-Endpunktsicherheit setzen, mindestens die Standardschutzregeln im Blockmodus.' },
  { id: 'builtin-admin-disabled', area: 'accounts', weight: 2, title: 'Integriertes Administratorkonto deaktiviert', recommendation: 'Integriertes Administratorkonto deaktivieren oder per Windows LAPS verwalten.' },
  { id: 'guest-disabled', area: 'accounts', weight: 1, title: 'Gastkonto deaktiviert', recommendation: 'Gastkonto deaktiviert lassen.' },
];

const BY_ID = new Map(HARDENING_CONTROLS.map((c) => [c.id, c]));
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

export interface HardeningReport {
  collectedAt: string | null;
  passed: number;
  failed: string[];
  notApplicable: string[];
  unreadable: string[];
}

export interface HardeningDeviceState {
  managedDeviceId: string;
  deviceName: string;
  reportedAt: string | null;
  output: string | null;
}

function ids(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  // ConvertTo-Json macht aus einem Ein-Element-Array unter PowerShell 5.1 einen String
  if (typeof value === 'string' && value) return [value];
  return [];
}

export function parseHardeningReport(output: string | null): HardeningReport | null {
  if (!output) return null;
  try {
    const raw = JSON.parse(output) as Record<string, unknown>;
    if (raw.schema !== 'zsc.hardening/1') return null;
    return {
      collectedAt: typeof raw.collectedAt === 'string' ? raw.collectedAt : null,
      passed: typeof raw.passed === 'number' ? raw.passed : 0,
      failed: ids(raw.failed),
      notApplicable: ids(raw.notApplicable),
      unreadable: ids(raw.unreadable),
    };
  } catch {
    return null;
  }
}

/** Gewichteter Erfuellungsgrad: bestanden / (bestanden + nicht bestanden), nur bekannte Kontrollen. */
function deviceScore(report: HardeningReport): number {
  const failed = new Set(report.failed);
  const excluded = new Set([...report.notApplicable, ...report.unreadable]);
  let total = 0;
  let ok = 0;
  for (const c of HARDENING_CONTROLS) {
    if (excluded.has(c.id)) continue;
    total += c.weight;
    if (!failed.has(c.id)) ok += c.weight;
  }
  return total > 0 ? Math.round((ok / total) * 100) : 100;
}

export function summarizeHardening(states: HardeningDeviceState[], now = new Date()): HardeningSummary {
  const controls: HardeningControlResult[] = HARDENING_CONTROLS.map((c) => ({ ...c, failing: 0, passing: 0, notApplicable: 0, unreadable: 0 }));
  const devices: HardeningDeviceResult[] = [];
  let stale = 0;

  for (const state of states) {
    const report = parseHardeningReport(state.output);
    if (!report) continue;
    const reported = state.reportedAt ? Date.parse(state.reportedAt) : NaN;
    if (!Number.isFinite(reported) || now.getTime() - reported > STALE_MS) stale += 1;
    const failed = new Set(report.failed.filter((id) => BY_ID.has(id)));
    const na = new Set(report.notApplicable);
    const unreadable = new Set(report.unreadable);
    for (const c of controls) {
      if (failed.has(c.id)) c.failing += 1;
      else if (na.has(c.id)) c.notApplicable += 1;
      else if (unreadable.has(c.id)) c.unreadable += 1;
      else c.passing += 1;
    }
    devices.push({ managedDeviceId: state.managedDeviceId, deviceName: state.deviceName, reportedAt: state.reportedAt, failedIds: Array.from(failed), scorePercent: deviceScore(report) });
  }

  // Ungewichtet ueber Geraete gemittelt, damit jedes Geraet gleich zaehlt
  const scorePercent = devices.length > 0 ? Math.round(devices.reduce((s, d) => s + d.scorePercent, 0) / devices.length) : null;
  controls.sort((a, b) => b.failing - a.failing || b.weight - a.weight || a.title.localeCompare(b.title, 'de'));
  devices.sort((a, b) => a.scorePercent - b.scorePercent || a.deviceName.localeCompare(b.deviceName, 'de'));
  return { devicesReporting: devices.length, staleDevices: stale, scorePercent, controls, devices };
}

export function hardeningControl(id: string): HardeningControl | null {
  return BY_ID.get(id) ?? null;
}
