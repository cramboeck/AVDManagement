/**
 * Tests fuer das Anmelde-Regelwerk
 */

import { describe, it, expect } from 'vitest';
import { evaluateSignIns, DEFAULT_THRESHOLDS } from '../src/security/anomaly-rules.js';
import type { SignInEvent } from '@zerostress/types';

let counter = 0;
function event(overrides: Partial<SignInEvent> & { at: string; user?: string }): SignInEvent {
  counter += 1;
  const user = overrides.user ?? 'max';
  return {
    id: `e${counter}`,
    createdAt: overrides.at,
    userId: `id-${user}`,
    userPrincipalName: `${user}@contoso.com`,
    userDisplayName: user,
    appDisplayName: 'Office 365',
    clientAppUsed: 'Browser',
    ipAddress: '203.0.113.5',
    location: { city: 'Wien', state: null, countryOrRegion: 'AT' },
    outcome: 'success',
    errorCode: 0,
    failureReason: null,
    conditionalAccessStatus: 'success',
    authenticationRequirement: 'multiFactorAuthentication',
    riskLevel: 'none',
    isInteractive: true,
    device: { operatingSystem: 'Windows', browser: 'Edge', isCompliant: true, isManaged: true, trustType: 'AzureAd' },
    ...overrides,
  } as SignInEvent;
}

const t = (minutes: number) => new Date(Date.UTC(2026, 8, 25, 10, minutes)).toISOString();

describe('evaluateSignIns', () => {
  it('reports nothing for normal traffic', () => {
    expect(evaluateSignIns([event({ at: t(0) }), event({ at: t(5), user: 'eva' })])).toEqual([]);
  });

  it('flags a failure burst per user and a spray across users', () => {
    const burst = Array.from({ length: 12 }, (_, i) => event({ at: t(i), outcome: 'failure', errorCode: 50126, failureReason: 'Invalid password', ipAddress: '198.51.100.9' }));
    const findings = evaluateSignIns(burst);
    expect(findings.map((f) => f.ruleId)).toEqual(['failed-burst']);
    expect(findings[0]).toMatchObject({ severity: 'medium', occurrences: 12, userPrincipalName: 'max@contoso.com' });

    const spray = Array.from({ length: 45 }, (_, i) => event({ at: t(i % 50), user: `u${i % 15}`, outcome: 'failure', ipAddress: '198.51.100.9' }));
    const sprayFindings = evaluateSignIns(spray, { ...DEFAULT_THRESHOLDS, failedPerUser: 100 });
    expect(sprayFindings.map((f) => f.ruleId)).toEqual(['password-spray']);
    expect(sprayFindings[0].evidence.users).toBe(15);
  });

  it('flags success after failures from another address, country hops, legacy and risky successes', () => {
    const events = [
      ...Array.from({ length: 6 }, (_, i) => event({ at: t(i), outcome: 'failure', ipAddress: '198.51.100.9' })),
      event({ at: t(8), ipAddress: '203.0.113.77', authenticationRequirement: 'singleFactorAuthentication' }),
      event({ at: t(20), user: 'eva', location: { city: 'Berlin', state: null, countryOrRegion: 'DE' } }),
      event({ at: t(50), user: 'eva', location: { city: 'Lagos', state: null, countryOrRegion: 'NG' }, ipAddress: '192.0.2.4' }),
      event({ at: t(30), user: 'tom', clientAppUsed: 'IMAP4' }),
      event({ at: t(31), user: 'lea', riskLevel: 'high' }),
    ];
    const findings = evaluateSignIns(events);
    const rules = findings.map((f) => f.ruleId).sort();
    expect(rules).toEqual(['country-hop', 'legacy-auth-success', 'risky-success', 'success-after-failures']);
    const hop = findings.find((f) => f.ruleId === 'country-hop')!;
    expect(hop.evidence).toMatchObject({ from: 'DE', to: 'NG', minutes: 30 });
    const after = findings.find((f) => f.ruleId === 'success-after-failures')!;
    expect(after.summary).toContain('anderen Adresse');
    expect(findings[0].severity).toBe('high');
  });

  it('keeps fingerprints stable across runs for the same incident', () => {
    const burst = Array.from({ length: 10 }, (_, i) => event({ at: t(i), outcome: 'failure' }));
    const a = evaluateSignIns(burst)[0].fingerprint;
    const b = evaluateSignIns([...burst, event({ at: t(11), outcome: 'failure' })])[0].fingerprint;
    expect(a).toBe(b);
  });
});
