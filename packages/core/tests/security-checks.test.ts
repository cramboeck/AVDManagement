/**
 * Tests fuer die Best-Practice-Checks
 */

import { describe, it, expect } from 'vitest';
import { evaluateChecks, buildCheckReport, type CheckInput, type MailAuthRecords } from '../src/security/checks.js';
import type { ConditionalAccessPolicy, TenantPolicySnapshot } from '../src/providers/policy-provider.js';

const mfaAll: ConditionalAccessPolicy = {
  id: '1',
  displayName: 'MFA all users',
  state: 'enabled',
  conditions: { users: { includeUsers: ['All'], excludeUsers: ['breakglass'] }, applications: { includeApplications: ['All'] }, clientAppTypes: ['all'] },
  grantControls: { operator: 'OR', builtInControls: ['mfa'] },
};
const adminStrength: ConditionalAccessPolicy = {
  id: '2',
  displayName: 'Admins phishing-resistant',
  state: 'enabled',
  conditions: { users: { includeRoles: ['62e90394-69f5-4237-9190-012177145e10'] }, applications: { includeApplications: ['All'] } },
  grantControls: { builtInControls: [], authenticationStrength: { id: 'phishing-resistant' } },
};
const blockLegacy: ConditionalAccessPolicy = {
  id: '3',
  displayName: 'Block legacy',
  state: 'enabled',
  conditions: { users: { includeUsers: ['All'] }, applications: { includeApplications: ['All'] }, clientAppTypes: ['exchangeActiveSync', 'other'] },
  grantControls: { builtInControls: ['block'] },
};

function policies(overrides: Partial<TenantPolicySnapshot> = {}): TenantPolicySnapshot {
  return {
    conditionalAccess: { available: true, data: [mfaAll, adminStrength, blockLegacy] },
    securityDefaultsEnabled: { available: true, data: false },
    authenticationMethods: { available: true, data: { methods: { sms: false, voice: false, fido2: true, microsoftauthenticator: true }, numberMatching: true } },
    authorization: {
      available: true,
      data: { allowedToCreateApps: false, allowedToCreateSecurityGroups: false, allowInvitesFrom: 'adminsAndGuestInviters', guestUserRoleId: '10dae51f-b6af-4016-8d66-8c2a99b929b3', userConsentAllowed: false, allowEmailVerifiedUsersToJoinOrganization: false },
    },
    globalAdminCount: { available: true, data: 2 },
    domains: { available: true, data: [{ domain: 'contoso.com', isDefault: true, passwordValidityPeriodInDays: 2147483647 }] },
    compliancePolicyCount: { available: true, data: 3 },
    ...overrides,
  };
}

const goodMail: MailAuthRecords = {
  domain: 'contoso.com',
  spf: 'v=spf1 include:spf.protection.outlook.com -all',
  dmarc: 'v=DMARC1; p=reject; rua=mailto:dmarc@contoso.com',
  dkim: { selector1: 'selector1-contoso-com._domainkey.contoso.onmicrosoft.com', selector2: 'selector2-contoso-com._domainkey.contoso.onmicrosoft.com' },
  error: null,
};

function byId(checks: ReturnType<typeof evaluateChecks>, id: string) {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`check ${id} missing`);
  return c;
}

describe('evaluateChecks', () => {
  it('passes a well configured tenant', () => {
    const input: CheckInput = { policies: policies(), mailAuth: goodMail, adminsWithoutMfa: 0 };
    const checks = evaluateChecks(input);
    for (const id of ['mfa-all-users', 'mfa-admins', 'legacy-auth-blocked', 'weak-auth-methods', 'fido2-enabled', 'number-matching', 'user-consent', 'guest-permissions', 'global-admins', 'password-expiry', 'compliance-policy', 'spf', 'dmarc', 'dkim']) {
      expect(byId(checks, id).status, id).toBe('pass');
    }
    const report = buildCheckReport(input);
    expect(report.counts.fail).toBe(0);
    expect(report.scorePercent).toBeGreaterThan(80);
    expect(report.unavailableSources).toEqual([]);
  });

  it('fails an open tenant and orders failures first', () => {
    const input: CheckInput = {
      policies: policies({
        conditionalAccess: { available: true, data: [{ ...mfaAll, state: 'enabledForReportingButNotEnforced' }] },
        authorization: { available: true, data: { allowedToCreateApps: true, allowedToCreateSecurityGroups: true, allowInvitesFrom: 'everyone', guestUserRoleId: 'a0b1b346-4d3e-4e8b-98f8-753987be4970', userConsentAllowed: true, allowEmailVerifiedUsersToJoinOrganization: true } },
        globalAdminCount: { available: true, data: 7 },
        domains: { available: true, data: [{ domain: 'contoso.com', isDefault: true, passwordValidityPeriodInDays: 90 }] },
        compliancePolicyCount: { available: true, data: 0 },
      }),
      mailAuth: { domain: 'contoso.com', spf: 'v=spf1 include:spf.protection.outlook.com ~all', dmarc: 'v=DMARC1; p=none', dkim: { selector1: null, selector2: null }, error: null },
      adminsWithoutMfa: 2,
    };
    const checks = evaluateChecks(input);
    expect(byId(checks, 'mfa-all-users').status).toBe('fail');
    expect(byId(checks, 'mfa-admins')).toMatchObject({ status: 'fail', evidence: { adminsWithoutMfa: 2 } });
    expect(byId(checks, 'legacy-auth-blocked').status).toBe('fail');
    expect(byId(checks, 'ca-report-only').status).toBe('warn');
    expect(byId(checks, 'user-consent').status).toBe('fail');
    expect(byId(checks, 'guest-invites').status).toBe('warn');
    expect(byId(checks, 'global-admins').status).toBe('fail');
    expect(byId(checks, 'password-expiry').status).toBe('warn');
    expect(byId(checks, 'compliance-policy').status).toBe('fail');
    expect(byId(checks, 'spf').status).toBe('warn');
    expect(byId(checks, 'dmarc').status).toBe('warn');
    expect(byId(checks, 'dkim').status).toBe('fail');
    expect(checks[0].status).toBe('fail');
    expect(checks[checks.length - 1].status).not.toBe('fail');
  });

  it('accepts security defaults as MFA and legacy auth coverage', () => {
    const checks = evaluateChecks({ policies: policies({ conditionalAccess: { available: true, data: [] }, securityDefaultsEnabled: { available: true, data: true } }), mailAuth: null, adminsWithoutMfa: null });
    expect(byId(checks, 'mfa-all-users').status).toBe('pass');
    expect(byId(checks, 'legacy-auth-blocked').status).toBe('pass');
    expect(byId(checks, 'mfa-admins').status).toBe('warn');
    expect(checks.find((c) => c.id === 'spf')).toBeUndefined();
  });

  it('marks checks unknown when a source is not readable and lists the source', () => {
    const input: CheckInput = {
      policies: policies({
        conditionalAccess: { available: false, reason: 'permission-missing', missingPermission: 'Policy.Read.All', detail: 'no' },
        securityDefaultsEnabled: { available: false, reason: 'permission-missing', missingPermission: 'Policy.Read.All', detail: 'no' },
      }),
      mailAuth: { domain: 'contoso.com', spf: null, dmarc: null, dkim: { selector1: null, selector2: null }, error: 'ETIMEOUT' },
      adminsWithoutMfa: null,
    };
    const report = buildCheckReport(input);
    expect(byId(report.checks, 'mfa-all-users')).toMatchObject({ status: 'unknown' });
    expect(byId(report.checks, 'spf').status).toBe('unknown');
    expect(report.unavailableSources.map((s) => s.source)).toEqual(['Conditional Access', 'Sicherheitsstandards']);
  });
});
