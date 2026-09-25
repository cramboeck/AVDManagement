/**
 * Anmelde-Anomalien: festes Regelwerk ueber die Anmeldeereignisse eines
 * Zeitfensters. Reine Auswertung ohne Netzwerk, damit sie testbar ist.
 * Fingerabdruecke sind je Regel, Benutzer und Tag stabil, damit derselbe
 * Vorfall beim naechsten Durchlauf nicht erneut alarmiert, sondern nur
 * fortgeschrieben wird.
 */

import { createHash } from 'node:crypto';
import type { AnomalyFinding, AnomalyRuleId, SignInEvent } from '@zerostress/types';

export interface AnomalyThresholds {
  // Fehlversuche je Benutzer innerhalb von failedWindowMinutes
  failedPerUser: number;
  failedWindowMinutes: number;
  // Fehlversuche ueber viele Benutzer (Password Spray)
  sprayFailures: number;
  sprayDistinctUsers: number;
  // Fehlversuche vor einem Erfolg von anderer Adresse
  failuresBeforeSuccess: number;
  // Zwei Laender je Benutzer innerhalb dieses Fensters
  countryHopMinutes: number;
}

export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  failedPerUser: 10,
  failedWindowMinutes: 60,
  sprayFailures: 40,
  sprayDistinctUsers: 10,
  failuresBeforeSuccess: 5,
  countryHopMinutes: 120,
};

const MODERN_CLIENTS = new Set(['Browser', 'Mobile Apps and Desktop clients']);

function fingerprint(ruleId: AnomalyRuleId, subject: string, at: string): string {
  return createHash('sha256').update(`${ruleId}|${subject}|${at.slice(0, 10)}`).digest('hex').slice(0, 32);
}

function byTime(a: SignInEvent, b: SignInEvent): number {
  return a.createdAt.localeCompare(b.createdAt);
}

function groupByUser(events: SignInEvent[]): Map<string, SignInEvent[]> {
  const map = new Map<string, SignInEvent[]>();
  for (const e of events) {
    const list = map.get(e.userId) ?? [];
    list.push(e);
    map.set(e.userId, list);
  }
  for (const list of map.values()) list.sort(byTime);
  return map;
}

function uniq(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

/**
 * Regeln auf ein Fenster von Ereignissen anwenden.
 */
export function evaluateSignIns(events: SignInEvent[], thresholds: AnomalyThresholds = DEFAULT_THRESHOLDS): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const sorted = [...events].sort(byTime);
  const perUser = groupByUser(sorted);

  // 1. Fehlversuche je Benutzer in einem gleitenden Fenster
  for (const [userId, list] of perUser) {
    const failures = list.filter((e) => e.outcome === 'failure');
    const windowMs = thresholds.failedWindowMinutes * 60 * 1000;
    for (let i = 0; i < failures.length; i += 1) {
      const start = new Date(failures[i].createdAt).getTime();
      let j = i;
      while (j + 1 < failures.length && new Date(failures[j + 1].createdAt).getTime() - start <= windowMs) j += 1;
      const count = j - i + 1;
      if (count >= thresholds.failedPerUser) {
        const slice = failures.slice(i, j + 1);
        findings.push({
          ruleId: 'failed-burst',
          severity: count >= thresholds.failedPerUser * 3 ? 'high' : 'medium',
          fingerprint: fingerprint('failed-burst', userId, slice[0].createdAt),
          title: `${count} fehlgeschlagene Anmeldungen fuer ${slice[0].userPrincipalName}`,
          summary: `${count} Fehlversuche innerhalb von ${thresholds.failedWindowMinutes} Minuten aus ${uniq(slice.map((e) => e.ipAddress)).length} Adresse(n).`,
          userId,
          userPrincipalName: slice[0].userPrincipalName,
          firstSeenAt: slice[0].createdAt,
          lastSeenAt: slice[slice.length - 1].createdAt,
          occurrences: count,
          evidence: { ips: uniq(slice.map((e) => e.ipAddress)).slice(0, 10), countries: uniq(slice.map((e) => e.location?.countryOrRegion)), apps: uniq(slice.map((e) => e.appDisplayName)).slice(0, 5), reasons: uniq(slice.map((e) => e.failureReason)).slice(0, 3) },
        });
        break;
      }
    }
  }

  // 2. Password Spray: viele Fehlversuche ueber viele Benutzer, wenige Adressen
  {
    const failures = sorted.filter((e) => e.outcome === 'failure');
    const users = uniq(failures.map((e) => e.userId));
    if (failures.length >= thresholds.sprayFailures && users.length >= thresholds.sprayDistinctUsers) {
      const ips = uniq(failures.map((e) => e.ipAddress));
      findings.push({
        ruleId: 'password-spray',
        severity: 'high',
        fingerprint: fingerprint('password-spray', 'tenant', failures[0].createdAt),
        title: `Password-Spray-Muster: ${failures.length} Fehlversuche auf ${users.length} Konten`,
        summary: `${failures.length} fehlgeschlagene Anmeldungen auf ${users.length} verschiedene Konten aus ${ips.length} Adresse(n).`,
        userId: null,
        userPrincipalName: null,
        firstSeenAt: failures[0].createdAt,
        lastSeenAt: failures[failures.length - 1].createdAt,
        occurrences: failures.length,
        evidence: { ips: ips.slice(0, 10), users: users.length, countries: uniq(failures.map((e) => e.location?.countryOrRegion)) },
      });
    }
  }

  // 3. Erfolg nach Fehlversuchen von einer anderen Adresse
  for (const [userId, list] of perUser) {
    let failStreak: SignInEvent[] = [];
    for (const e of list) {
      if (e.outcome === 'failure') {
        failStreak.push(e);
        continue;
      }
      if (e.outcome === 'success' && failStreak.length >= thresholds.failuresBeforeSuccess) {
        const streakIps = uniq(failStreak.map((f) => f.ipAddress));
        const withinMs = new Date(e.createdAt).getTime() - new Date(failStreak[failStreak.length - 1].createdAt).getTime();
        if (withinMs <= 30 * 60 * 1000) {
          findings.push({
            ruleId: 'success-after-failures',
            severity: 'high',
            fingerprint: fingerprint('success-after-failures', userId, e.createdAt),
            title: `Erfolgreiche Anmeldung nach ${failStreak.length} Fehlversuchen: ${e.userPrincipalName}`,
            summary: `Nach ${failStreak.length} Fehlversuchen gelang die Anmeldung${e.ipAddress && !streakIps.includes(e.ipAddress) ? ' von einer anderen Adresse' : ''} (${e.appDisplayName}).`,
            userId,
            userPrincipalName: e.userPrincipalName,
            firstSeenAt: failStreak[0].createdAt,
            lastSeenAt: e.createdAt,
            occurrences: failStreak.length + 1,
            evidence: { failureIps: streakIps.slice(0, 10), successIp: e.ipAddress, successCountry: e.location?.countryOrRegion ?? null, mfa: e.authenticationRequirement },
          });
          break;
        }
      }
      failStreak = [];
    }
  }

  // 4. Zwei Laender in kurzer Zeit
  for (const [userId, list] of perUser) {
    const successes = list.filter((e) => e.outcome === 'success' && e.location?.countryOrRegion);
    for (let i = 1; i < successes.length; i += 1) {
      const prev = successes[i - 1];
      const cur = successes[i];
      const gap = new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime();
      if (prev.location?.countryOrRegion !== cur.location?.countryOrRegion && gap <= thresholds.countryHopMinutes * 60 * 1000) {
        findings.push({
          ruleId: 'country-hop',
          severity: 'high',
          fingerprint: fingerprint('country-hop', userId, cur.createdAt),
          title: `Anmeldungen aus ${prev.location?.countryOrRegion} und ${cur.location?.countryOrRegion} binnen ${Math.round(gap / 60000)} Minuten: ${cur.userPrincipalName}`,
          summary: `Erfolgreiche Anmeldung aus ${cur.location?.countryOrRegion} (${cur.ipAddress ?? '?'}) nur ${Math.round(gap / 60000)} Minuten nach ${prev.location?.countryOrRegion} (${prev.ipAddress ?? '?'}).`,
          userId,
          userPrincipalName: cur.userPrincipalName,
          firstSeenAt: prev.createdAt,
          lastSeenAt: cur.createdAt,
          occurrences: 2,
          evidence: { from: prev.location?.countryOrRegion ?? null, to: cur.location?.countryOrRegion ?? null, ips: uniq([prev.ipAddress, cur.ipAddress]), minutes: Math.round(gap / 60000) },
        });
        break;
      }
    }
  }

  // 5. Legacy-Authentifizierung erfolgreich
  {
    const legacy = sorted.filter((e) => e.outcome === 'success' && e.clientAppUsed && !MODERN_CLIENTS.has(e.clientAppUsed));
    const byUser = groupByUser(legacy);
    for (const [userId, list] of byUser) {
      findings.push({
        ruleId: 'legacy-auth-success',
        severity: 'medium',
        fingerprint: fingerprint('legacy-auth-success', userId, list[0].createdAt),
        title: `Legacy-Authentifizierung erfolgreich: ${list[0].userPrincipalName}`,
        summary: `${list.length} erfolgreiche Anmeldung(en) ueber ${uniq(list.map((e) => e.clientAppUsed)).join(', ')} ohne MFA-Faehigkeit.`,
        userId,
        userPrincipalName: list[0].userPrincipalName,
        firstSeenAt: list[0].createdAt,
        lastSeenAt: list[list.length - 1].createdAt,
        occurrences: list.length,
        evidence: { clients: uniq(list.map((e) => e.clientAppUsed)), ips: uniq(list.map((e) => e.ipAddress)).slice(0, 10) },
      });
    }
  }

  // 6. Riskante Anmeldung erfolgreich (Identity Protection)
  {
    const risky = sorted.filter((e) => e.outcome === 'success' && (e.riskLevel === 'medium' || e.riskLevel === 'high'));
    const byUser = groupByUser(risky);
    for (const [userId, list] of byUser) {
      findings.push({
        ruleId: 'risky-success',
        severity: 'high',
        fingerprint: fingerprint('risky-success', userId, list[0].createdAt),
        title: `Riskante Anmeldung erfolgreich: ${list[0].userPrincipalName}`,
        summary: `${list.length} erfolgreiche Anmeldung(en) mit Risikostufe ${uniq(list.map((e) => e.riskLevel)).join('/')} laut Identity Protection.`,
        userId,
        userPrincipalName: list[0].userPrincipalName,
        firstSeenAt: list[0].createdAt,
        lastSeenAt: list[list.length - 1].createdAt,
        occurrences: list.length,
        evidence: { risk: uniq(list.map((e) => e.riskLevel)), ips: uniq(list.map((e) => e.ipAddress)).slice(0, 10), countries: uniq(list.map((e) => e.location?.countryOrRegion)) },
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || b.lastSeenAt.localeCompare(a.lastSeenAt));
}
