/**
 * Regeln ueber die Ergebnisse des Geraete-Monitors (Skript ZSC-monitor,
 * stuendlich per Intune-Zuweisung)
 *
 * Eingabe sind die letzten Zustaende je Geraet aus Intune; die Schwellen
 * kommen aus den MSP-Einstellungen. Fingerabdruecke je Geraet, Regel und
 * Tag (Herzschlag, Ereignisse) oder je Geraet und Objekt (Laufwerk,
 * Dienst, Zertifikat), damit ein geschlossener Alert nicht sofort wiederkommt.
 */

import { createHash } from 'node:crypto';
import type { AnomalyFinding, MspAlertSettings } from '@zerostress/types';

export interface MonitorDeviceState {
  managedDeviceId: string;
  deviceName: string;
  reportedAt: string | null;
  output: string | null;
}

export interface MonitorReport {
  uptimeHours: number | null;
  pendingReboot: boolean;
  volumes: Array<{ drive: string; freePercent: number; freeGB: number; sizeGB: number }>;
  stoppedServices: string[];
  systemErrors24h: number;
  systemErrorSources: string[];
  expiringCerts: Array<{ subject: string; notAfter: string; thumbprint: string }>;
  defenderSignatureAgeDays: number | null;
  defenderRealTime: boolean | null;
}

function fingerprint(parts: Array<string | number>): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

export function parseMonitorReport(output: string | null): MonitorReport | null {
  if (!output) return null;
  try {
    const raw = JSON.parse(output) as Record<string, unknown>;
    if (raw.schema !== 'zsc.monitor/1') return null;
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      uptimeHours: num(raw.uptimeHours),
      pendingReboot: raw.pendingReboot === true,
      volumes: Array.isArray(raw.volumes) ? (raw.volumes as Array<Record<string, unknown>>).map((v) => ({ drive: String(v.drive ?? '?'), freePercent: num(v.freePercent) ?? 100, freeGB: num(v.freeGB) ?? 0, sizeGB: num(v.sizeGB) ?? 0 })) : [],
      stoppedServices: Array.isArray(raw.stoppedServices) ? raw.stoppedServices.map(String) : [],
      systemErrors24h: num(raw.systemErrors24h) ?? 0,
      systemErrorSources: Array.isArray(raw.systemErrorSources) ? raw.systemErrorSources.map(String) : [],
      expiringCerts: Array.isArray(raw.expiringCerts) ? (raw.expiringCerts as Array<Record<string, unknown>>).map((c) => ({ subject: String(c.subject ?? ''), notAfter: String(c.notAfter ?? ''), thumbprint: String(c.thumbprint ?? '') })) : [],
      defenderSignatureAgeDays: num(raw.defenderSignatureAgeDays),
      defenderRealTime: typeof raw.defenderRealTime === 'boolean' ? raw.defenderRealTime : null,
    };
  } catch {
    return null;
  }
}

export function evaluateMonitorStates(tenantId: string, states: MonitorDeviceState[], settings: MspAlertSettings['monitor'], now = new Date()): AnomalyFinding[] {
  if (!settings.enabled) return [];
  const at = now.toISOString();
  const day = at.slice(0, 10);
  const findings: AnomalyFinding[] = [];
  const base = (device: MonitorDeviceState) => ({ userId: null, userPrincipalName: null, firstSeenAt: at, lastSeenAt: at, occurrences: 1, evidence: { device: device.deviceName, managedDeviceId: device.managedDeviceId, reportedAt: device.reportedAt } as Record<string, string | number | string[] | null> });

  for (const device of states) {
    const reportedMs = device.reportedAt ? Date.parse(device.reportedAt) : NaN;
    const ageHours = Number.isFinite(reportedMs) ? (now.getTime() - reportedMs) / 3_600_000 : null;
    if (ageHours === null || ageHours > settings.heartbeatHours) {
      findings.push({
        ...base(device),
        ruleId: 'device-heartbeat',
        severity: 'medium',
        fingerprint: fingerprint(['device-heartbeat', tenantId, device.managedDeviceId, day]),
        title: `Kein Lebenszeichen: ${device.deviceName}`,
        summary: ageHours === null ? `${device.deviceName} hat noch nie gemeldet.` : `${device.deviceName} hat seit ${Math.round(ageHours)} Stunden nicht gemeldet (Schwelle ${settings.heartbeatHours} h).`,
      });
      continue;
    }
    const report = parseMonitorReport(device.output);
    if (!report) continue;

    for (const v of report.volumes) {
      if (v.freePercent >= settings.diskFreePercent) continue;
      findings.push({
        ...base(device),
        ruleId: 'disk-space',
        severity: v.freePercent < 5 ? 'high' : 'medium',
        fingerprint: fingerprint(['disk-space', tenantId, device.managedDeviceId, v.drive]),
        title: `Wenig Speicher: ${device.deviceName} ${v.drive}`,
        summary: `${v.drive} auf ${device.deviceName} hat noch ${v.freeGB} GB frei (${v.freePercent} % von ${v.sizeGB} GB, Schwelle ${settings.diskFreePercent} %).`,
        evidence: { ...base(device).evidence, drive: v.drive, freePercent: v.freePercent, freeGB: v.freeGB },
      });
    }

    for (const service of report.stoppedServices) {
      findings.push({
        ...base(device),
        ruleId: 'service-stopped',
        severity: 'low',
        fingerprint: fingerprint(['service-stopped', tenantId, device.managedDeviceId, service.toLowerCase(), day]),
        title: `Dienst gestoppt: ${service} auf ${device.deviceName}`,
        summary: `Der Dienst ${service} steht auf Automatisch, laeuft aber nicht.`,
        evidence: { ...base(device).evidence, service },
      });
    }

    if (report.systemErrors24h > 0) {
      findings.push({
        ...base(device),
        ruleId: 'system-events',
        severity: 'medium',
        fingerprint: fingerprint(['system-events', tenantId, device.managedDeviceId, day]),
        title: `Hardware- oder Datentraegerfehler: ${device.deviceName}`,
        summary: `${report.systemErrors24h} Fehler in 24 h im Systemprotokoll (${report.systemErrorSources.join(', ') || 'Quelle unbekannt'}).`,
        evidence: { ...base(device).evidence, count: report.systemErrors24h, sources: report.systemErrorSources },
      });
    }

    for (const cert of report.expiringCerts) {
      findings.push({
        ...base(device),
        ruleId: 'certificate-expiry',
        severity: 'medium',
        fingerprint: fingerprint(['certificate-expiry', tenantId, device.managedDeviceId, cert.thumbprint]),
        title: `Zertifikat laeuft ab: ${device.deviceName}`,
        summary: `${cert.subject || 'Zertifikat'} laeuft am ${cert.notAfter} ab.`,
        evidence: { ...base(device).evidence, subject: cert.subject, notAfter: cert.notAfter },
      });
    }

    if (report.uptimeHours !== null && report.uptimeHours / 24 >= settings.uptimeDays) {
      findings.push({
        ...base(device),
        ruleId: 'restart-due',
        severity: 'low',
        fingerprint: fingerprint(['restart-due', tenantId, device.managedDeviceId, Math.floor(report.uptimeHours / 24 / 7)]),
        title: `Neustart faellig: ${device.deviceName}`,
        summary: `${device.deviceName} laeuft seit ${Math.round(report.uptimeHours / 24)} Tagen ohne Neustart (Schwelle ${settings.uptimeDays} Tage)${report.pendingReboot ? ', ein Neustart steht ohnehin aus' : ''}.`,
        evidence: { ...base(device).evidence, uptimeDays: Math.round(report.uptimeHours / 24), pendingReboot: report.pendingReboot ? 'yes' : 'no' },
      });
    }

    if (report.defenderRealTime === false || (report.defenderSignatureAgeDays !== null && report.defenderSignatureAgeDays > settings.defenderSignatureDays)) {
      findings.push({
        ...base(device),
        ruleId: 'defender-stale',
        severity: 'high',
        fingerprint: fingerprint(['defender-stale', tenantId, device.managedDeviceId, day]),
        title: `Defender nicht in Ordnung: ${device.deviceName}`,
        summary: report.defenderRealTime === false ? 'Der Echtzeitschutz ist aus.' : `Die Signaturen sind ${report.defenderSignatureAgeDays} Tage alt (Schwelle ${settings.defenderSignatureDays}).`,
        evidence: { ...base(device).evidence, signatureAgeDays: report.defenderSignatureAgeDays, realTime: report.defenderRealTime === null ? null : report.defenderRealTime ? 'on' : 'off' },
      });
    }
  }
  return findings;
}
