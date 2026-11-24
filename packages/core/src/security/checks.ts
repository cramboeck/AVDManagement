/**
 * Best-Practice-Checks
 *
 * Eigener Katalog, abgeleitet aus oeffentlicher Microsoft-Dokumentation
 * (Entra-Sicherheitsstandards, Conditional-Access-Vorlagen, Exchange-
 * Mailauthentifizierung). Reine Bewertung ohne Netzwerkzugriff, damit sie
 * vollstaendig testbar ist; die Rohdaten liefern PolicyProvider und die
 * DNS-Aufloesung der API.
 */

import type { BaselineKind, BaselineOverview, CapabilityResult, CapabilityUnavailableReason, SecurityCheck, SecurityCheckReport, SecurityCheckStatus } from '@zerostress/types';
import { RESTRICTED_GUEST_ROLE_IDS, type ConditionalAccessPolicy, type TenantPolicySnapshot } from '../providers/policy-provider.js';

export interface MailAuthRecords {
  domain: string;
  spf: string | null;
  dmarc: string | null;
  // CNAME-Ziele der Selektoren selector1/selector2
  dkim: { selector1: string | null; selector2: string | null };
  // DNS-Fehler (Timeout, kein Resolver)
  error: string | null;
}

export interface CheckInput {
  policies: TenantPolicySnapshot;
  mailAuth: MailAuthRecords | null;
  // Aus dem MFA-Registrierungsreport (kann fehlen)
  adminsWithoutMfa: number | null;
  // Intune-Baselines und Compliance-Richtlinien (fehlt bei aelteren Aufrufern)
  baselines?: BaselineOverview | null;
  // Outbound-Spam-Richtlinie laut Exchange-Worker: Off, On, Automatic; null = nicht gesammelt
  exchangeAutoForwarding?: string | null;
}

const NO_EXPIRY_DAYS = 2147483647;
const ALL_USERS = 'all';
const ALL_APPS = 'all';
const LEGACY_CLIENT_TYPES = ['exchangeActiveSync', 'other'];

function enabled(policies: ConditionalAccessPolicy[]): ConditionalAccessPolicy[] {
  return policies.filter((p) => p.state === 'enabled');
}

function targetsAllUsers(p: ConditionalAccessPolicy): boolean {
  return (p.conditions.users?.includeUsers ?? []).map((u) => u.toLowerCase()).includes(ALL_USERS);
}

function targetsAllApps(p: ConditionalAccessPolicy): boolean {
  return (p.conditions.applications?.includeApplications ?? []).map((a) => a.toLowerCase()).includes(ALL_APPS);
}

function targetsAdminRoles(p: ConditionalAccessPolicy): boolean {
  return (p.conditions.users?.includeRoles ?? []).length > 0 || targetsAllUsers(p);
}

function requiresMfa(p: ConditionalAccessPolicy): boolean {
  const controls = (p.grantControls?.builtInControls ?? []).map((c) => c.toLowerCase());
  return controls.includes('mfa') || !!p.grantControls?.authenticationStrength;
}

function blocksAccess(p: ConditionalAccessPolicy): boolean {
  return (p.grantControls?.builtInControls ?? []).map((c) => c.toLowerCase()).includes('block');
}

function blocksLegacyAuth(p: ConditionalAccessPolicy): boolean {
  const types = (p.conditions.clientAppTypes ?? []).map((t) => t);
  const legacyOnly = types.length > 0 && types.every((t) => LEGACY_CLIENT_TYPES.includes(t));
  const includesLegacy = types.some((t) => LEGACY_CLIENT_TYPES.includes(t)) || types.includes('all');
  return blocksAccess(p) && (legacyOnly || (includesLegacy && targetsAllUsers(p) && targetsAllApps(p)));
}

function requiresCompliantDevice(p: ConditionalAccessPolicy): boolean {
  const controls = (p.grantControls?.builtInControls ?? []).map((c) => c.toLowerCase());
  return controls.includes('compliantdevice') || controls.includes('domainjoineddevice');
}

function check(
  id: string,
  category: SecurityCheck['category'],
  title: string,
  weight: SecurityCheck['weight'],
  status: SecurityCheckStatus,
  summary: string,
  recommendation: string,
  evidence: SecurityCheck['evidence'] = {},
  docsUrl: string | null = null
): SecurityCheck {
  return { id, category, title, weight, status, summary, recommendation, evidence, docsUrl };
}

function unknownCheck(id: string, category: SecurityCheck['category'], title: string, weight: SecurityCheck['weight'], source: CapabilityResult<unknown>, recommendation: string): SecurityCheck {
  const reason = source.available ? 'Quelle nicht lesbar' : source.reason === 'permission-missing' ? `Berechtigung fehlt: ${source.missingPermission ?? 'unbekannt'}` : source.reason;
  return check(id, category, title, weight, 'unknown', `Nicht pruefbar: ${reason}.`, recommendation, {}, null);
}

export function evaluateChecks(input: CheckInput): SecurityCheck[] {
  const { policies, mailAuth, adminsWithoutMfa } = input;
  const checks: SecurityCheck[] = [];
  const ca = policies.conditionalAccess.available ? enabled(policies.conditionalAccess.data) : null;
  const reportOnly = policies.conditionalAccess.available ? policies.conditionalAccess.data.filter((p) => p.state === 'enabledForReportingButNotEnforced').length : 0;
  const securityDefaults = policies.securityDefaultsEnabled.available ? policies.securityDefaultsEnabled.data : null;

  // 1. MFA fuer alle Benutzer
  {
    const id = 'mfa-all-users';
    const title = 'MFA fuer alle Benutzer';
    const rec = 'Conditional-Access-Richtlinie "Alle Benutzer, alle Apps, MFA erforderlich" (oder Authentifizierungsstaerke) aktivieren; Notfallkonten ausschliessen.';
    if (ca === null && securityDefaults === null) checks.push(unknownCheck(id, 'identity', title, 3, policies.conditionalAccess, rec));
    else {
      const hits = (ca ?? []).filter((p) => targetsAllUsers(p) && targetsAllApps(p) && requiresMfa(p));
      if (hits.length > 0) checks.push(check(id, 'identity', title, 3, 'pass', `Erzwungen durch ${hits.map((p) => `"${p.displayName}"`).join(', ')}.`, rec, { policies: hits.length }));
      else if (securityDefaults) checks.push(check(id, 'identity', title, 3, 'pass', 'Sicherheitsstandards sind aktiv; sie verlangen MFA fuer alle Benutzer.', rec, { securityDefaults: true }));
      else checks.push(check(id, 'identity', title, 3, 'fail', 'Keine aktive Richtlinie verlangt MFA fuer alle Benutzer und alle Apps.', rec, { enabledPolicies: ca?.length ?? 0, reportOnly }));
    }
  }

  // 2. MFA fuer Administratoren
  {
    const id = 'mfa-admins';
    const title = 'MFA fuer Administratorrollen';
    const rec = 'Conditional-Access-Richtlinie fuer Verzeichnisrollen mit phishing-resistenter Authentifizierungsstaerke aktivieren.';
    if (ca === null && securityDefaults === null) checks.push(unknownCheck(id, 'identity', title, 3, policies.conditionalAccess, rec));
    else {
      const hits = (ca ?? []).filter((p) => targetsAdminRoles(p) && requiresMfa(p) && (targetsAllApps(p) || (p.conditions.applications?.includeApplications ?? []).length > 0));
      const strong = hits.some((p) => !!p.grantControls?.authenticationStrength);
      if (adminsWithoutMfa !== null && adminsWithoutMfa > 0)
        checks.push(check(id, 'identity', title, 3, 'fail', `${adminsWithoutMfa} Administratorkonto(en) ohne registrierte MFA.`, rec, { adminsWithoutMfa, policies: hits.length }));
      else if (hits.length > 0) checks.push(check(id, 'identity', title, 3, strong ? 'pass' : 'warn', strong ? 'Administratoren brauchen eine Authentifizierungsstaerke.' : 'MFA fuer Administratoren ist erzwungen, aber ohne phishing-resistente Staerke.', rec, { policies: hits.length, strength: strong }));
      else if (securityDefaults) checks.push(check(id, 'identity', title, 3, 'warn', 'Nur ueber Sicherheitsstandards abgedeckt; keine eigene Richtlinie fuer Administratoren.', rec, { securityDefaults: true }));
      else checks.push(check(id, 'identity', title, 3, 'fail', 'Keine aktive Richtlinie erzwingt MFA fuer Administratorrollen.', rec, {}));
    }
  }

  // 3. Legacy-Authentifizierung blockiert
  {
    const id = 'legacy-auth-blocked';
    const title = 'Legacy-Authentifizierung blockiert';
    const rec = 'Conditional-Access-Richtlinie "Legacy-Authentifizierung blockieren" (Client-Apps: Exchange ActiveSync, Andere Clients; Zugriff blockieren) aktivieren.';
    if (ca === null && securityDefaults === null) checks.push(unknownCheck(id, 'access', title, 3, policies.conditionalAccess, rec));
    else {
      const hits = (ca ?? []).filter(blocksLegacyAuth);
      if (hits.length > 0) checks.push(check(id, 'access', title, 3, 'pass', `Blockiert durch ${hits.map((p) => `"${p.displayName}"`).join(', ')}.`, rec, { policies: hits.length }));
      else if (securityDefaults) checks.push(check(id, 'access', title, 3, 'pass', 'Sicherheitsstandards blockieren Legacy-Authentifizierung.', rec, { securityDefaults: true }));
      else checks.push(check(id, 'access', title, 3, 'fail', 'Keine aktive Richtlinie blockiert Legacy-Authentifizierung.', rec, {}));
    }
  }

  // 4. Risikobasierte Richtlinien (P2)
  if (ca !== null) {
    const risk = ca.filter((p) => (p.conditions.signInRiskLevels ?? []).length > 0 || (p.conditions.userRiskLevels ?? []).length > 0);
    checks.push(
      check(
        'risk-policies',
        'access',
        'Risikobasierte Richtlinien (Identity Protection)',
        1,
        risk.length > 0 ? 'pass' : 'warn',
        risk.length > 0 ? `${risk.length} Richtlinie(n) reagieren auf Anmelde- oder Benutzerrisiko.` : 'Keine Richtlinie reagiert auf Anmelde- oder Benutzerrisiko; braucht Entra ID P2.',
        'Mit Entra ID P2: Richtlinien fuer Anmelderisiko (MFA) und Benutzerrisiko (Passwortaenderung) anlegen.',
        { policies: risk.length }
      )
    );
  }

  // 5. Konformes Geraet fuer den Zugriff
  if (ca !== null) {
    const hits = ca.filter(requiresCompliantDevice);
    checks.push(
      check(
        'compliant-device',
        'devices',
        'Zugriff nur von konformen Geraeten',
        2,
        hits.length > 0 ? 'pass' : 'warn',
        hits.length > 0 ? `${hits.length} Richtlinie(n) verlangen ein konformes oder verbundenes Geraet.` : 'Keine Richtlinie verlangt ein konformes Geraet.',
        'Conditional Access mit Gewaehrungssteuerung "Konformes Geraet erforderlich" fuer Unternehmensdaten, mindestens fuer Windows und mobile Plattformen.',
        { policies: hits.length }
      )
    );
  }

  // 6. Nur-Bericht-Richtlinien als Hinweis
  if (policies.conditionalAccess.available && reportOnly > 0) {
    checks.push(check('ca-report-only', 'access', 'Richtlinien im Nur-Bericht-Modus', 1, 'warn', `${reportOnly} Richtlinie(n) laufen im Nur-Bericht-Modus und schuetzen nicht.`, 'Nach Auswertung der Berichte aktivieren oder loeschen.', { reportOnly }));
  }

  // 7. Authentifizierungsmethoden
  {
    const id = 'weak-auth-methods';
    const title = 'SMS und Sprachanruf als MFA-Methode aus';
    const rec = 'In der Authentifizierungsmethodenrichtlinie SMS und Sprachanruf deaktivieren, Authenticator oder FIDO2 verwenden.';
    if (!policies.authenticationMethods.available) checks.push(unknownCheck(id, 'identity', title, 2, policies.authenticationMethods, rec));
    else {
      const m = policies.authenticationMethods.data.methods;
      const sms = m['sms'] === true;
      const voice = m['voice'] === true;
      checks.push(check(id, 'identity', title, 2, sms || voice ? 'warn' : 'pass', sms || voice ? `Aktiv: ${[sms && 'SMS', voice && 'Sprachanruf'].filter(Boolean).join(', ')}.` : 'SMS und Sprachanruf sind deaktiviert.', rec, { sms, voice }));

      const fido = m['fido2'] === true;
      checks.push(
        check('fido2-enabled', 'identity', 'Passkeys / FIDO2 erlaubt', 2, fido ? 'pass' : 'warn', fido ? 'FIDO2-Sicherheitsschluessel und Passkeys sind erlaubt.' : 'FIDO2 ist nicht aktiviert; phishing-resistente Anmeldung ist damit nicht moeglich.', 'FIDO2-Methode aktivieren, mindestens fuer Administratoren.', { fido2: fido })
      );

      const nm = policies.authenticationMethods.data.numberMatching;
      if (nm !== null) {
        checks.push(check('number-matching', 'identity', 'Nummernabgleich im Authenticator', 1, nm ? 'pass' : 'warn', nm ? 'Nummernabgleich ist erzwungen.' : 'Nummernabgleich ist nicht erzwungen.', 'In der Authenticator-Konfiguration "Nummernabgleich erforderlich" aktivieren.', { numberMatching: nm }));
      }
    }
  }

  // 8. Autorisierungsrichtlinie
  {
    const src = policies.authorization;
    const rec1 = 'Entra ID > Benutzereinstellungen: "Benutzer koennen Anwendungen registrieren" auf Nein.';
    if (!src.available) checks.push(unknownCheck('user-app-registration', 'governance', 'Benutzer duerfen keine Apps registrieren', 1, src, rec1));
    else {
      const a = src.data;
      if (a.allowedToCreateApps !== null)
        checks.push(check('user-app-registration', 'governance', 'Benutzer duerfen keine Apps registrieren', 1, a.allowedToCreateApps ? 'warn' : 'pass', a.allowedToCreateApps ? 'Jeder Benutzer darf App-Registrierungen anlegen.' : 'App-Registrierung ist Administratoren vorbehalten.', rec1, { allowedToCreateApps: a.allowedToCreateApps }));
      if (a.userConsentAllowed !== null)
        checks.push(
          check('user-consent', 'governance', 'Benutzer-Consent fuer Apps eingeschraenkt', 2, a.userConsentAllowed ? 'fail' : 'pass', a.userConsentAllowed ? 'Benutzer duerfen Anwendungen selbst Zugriff auf ihre Daten gewaehren.' : 'Benutzer-Consent ist deaktiviert oder auf Administratoren beschraenkt.', 'Enterprise-Anwendungen > Consent und Berechtigungen: Benutzer-Consent deaktivieren und Admin-Consent-Workflow aktivieren.', { userConsentAllowed: a.userConsentAllowed })
        );
      if (a.allowInvitesFrom !== null) {
        const open = a.allowInvitesFrom === 'everyone';
        checks.push(check('guest-invites', 'governance', 'Gasteinladungen eingeschraenkt', 1, open ? 'warn' : 'pass', open ? 'Jeder, auch Gaeste, darf Gaeste einladen.' : `Einladungen: ${a.allowInvitesFrom}.`, 'Externe Zusammenarbeit: Einladungen nur fuer Administratoren und Gasteinlader (oder bestimmte Rollen) erlauben.', { allowInvitesFrom: a.allowInvitesFrom }));
      }
      if (a.guestUserRoleId !== null) {
        const restricted = RESTRICTED_GUEST_ROLE_IDS.includes(a.guestUserRoleId.toLowerCase());
        checks.push(check('guest-permissions', 'governance', 'Gastberechtigungen eingeschraenkt', 2, restricted ? 'pass' : 'warn', restricted ? 'Gaeste sehen nur eigene Verzeichnisdaten.' : 'Gaeste haben dieselben Verzeichnisrechte wie Mitglieder.', 'Externe Zusammenarbeit: Gastzugriff auf "eingeschraenkt" setzen.', { guestUserRoleId: a.guestUserRoleId }));
      }
    }
  }

  // 9. Globale Administratoren
  {
    const src = policies.globalAdminCount;
    const rec = 'Zwei bis vier globale Administratoren, davon ein Notfallkonto; alle anderen Admins ueber spezifische Rollen und PIM.';
    if (!src.available) checks.push(unknownCheck('global-admins', 'governance', 'Anzahl globaler Administratoren', 2, src, rec));
    else {
      const n = src.data;
      const status: SecurityCheckStatus = n === 0 ? 'unknown' : n === 1 ? 'warn' : n <= 4 ? 'pass' : 'fail';
      const summary = n === 0 ? 'Keine globalen Administratoren gefunden (Rolle nicht aktiviert oder nur PIM-berechtigt).' : n === 1 ? 'Nur ein globaler Administrator: kein Notfallkonto.' : n <= 4 ? `${n} globale Administratoren.` : `${n} globale Administratoren, Microsoft empfiehlt hoechstens vier.`;
      checks.push(check('global-admins', 'governance', 'Anzahl globaler Administratoren', 2, status, summary, rec, { globalAdmins: n }));
    }
  }

  // 10. Passwortablauf
  {
    const src = policies.domains;
    const rec = 'Passwortablauf auf "nie" setzen (Microsoft-Empfehlung mit MFA und Kennwortschutz) statt erzwungener Rotation.';
    if (!src.available) checks.push(unknownCheck('password-expiry', 'identity', 'Passwoerter laufen nicht ab', 1, src, rec));
    else {
      const managed = src.data.filter((d) => d.passwordValidityPeriodInDays !== null);
      const expiring = managed.filter((d) => (d.passwordValidityPeriodInDays ?? 0) < NO_EXPIRY_DAYS);
      if (managed.length === 0) checks.push(check('password-expiry', 'identity', 'Passwoerter laufen nicht ab', 1, 'not-applicable', 'Keine Domaene meldet eine Passwortrichtlinie (z. B. nur verbundene Domaenen).', rec));
      else checks.push(check('password-expiry', 'identity', 'Passwoerter laufen nicht ab', 1, expiring.length > 0 ? 'warn' : 'pass', expiring.length > 0 ? `Ablauf aktiv fuer ${expiring.map((d) => `${d.domain} (${d.passwordValidityPeriodInDays} Tage)`).join(', ')}.` : 'Kein erzwungener Passwortablauf.', rec, { domainsWithExpiry: expiring.length }));
    }
  }

  // 11. Intune-Compliance-Richtlinie vorhanden
  {
    const src = policies.compliancePolicyCount;
    const rec = 'Mindestens eine Compliance-Richtlinie je Plattform (BitLocker, Defender, Mindest-OS) anlegen und in Conditional Access verwenden.';
    if (!src.available) checks.push(unknownCheck('compliance-policy', 'devices', 'Compliance-Richtlinien in Intune', 2, src, rec));
    else checks.push(check('compliance-policy', 'devices', 'Compliance-Richtlinien in Intune', 2, src.data > 0 ? 'pass' : 'fail', src.data > 0 ? `${src.data} Compliance-Richtlinie(n) vorhanden.` : 'Keine Compliance-Richtlinie; Geraetezustand fliesst nicht in den Zugriff ein.', rec, { policies: src.data }));
  }

  // 12. Anmeldehaeufigkeit fuer Administratoren
  if (ca !== null) {
    const hits = ca.filter((p) => (p.conditions.users?.includeRoles ?? []).length > 0 && p.sessionControls?.signInFrequency?.isEnabled === true);
    checks.push(
      check(
        'admin-signin-frequency',
        'access',
        'Anmeldehaeufigkeit fuer Administratoren begrenzt',
        1,
        hits.length > 0 ? 'pass' : 'warn',
        hits.length > 0 ? `${hits.length} Richtlinie(n) begrenzen die Sitzungsdauer von Administratorrollen.` : 'Keine Richtlinie begrenzt die Sitzungsdauer fuer Administratorrollen; Sitzungen bleiben bis zu 90 Tage gueltig.',
        'Conditional Access fuer Administratorrollen mit Sitzungssteuerung "Anmeldehaeufigkeit" (z. B. 4 bis 12 Stunden) und ohne persistente Browsersitzung.',
        { policies: hits.length }
      )
    );
  }

  // 13. Geraetecode-Fluss blockiert
  if (ca !== null) {
    const hits = ca.filter((p) => blocksAccess(p) && (p.conditions.authenticationFlows?.transferMethods ?? '').toLowerCase().includes('devicecodeflow'));
    checks.push(
      check(
        'device-code-flow',
        'access',
        'Geraetecode-Anmeldung blockiert',
        2,
        hits.length > 0 ? 'pass' : 'warn',
        hits.length > 0 ? `Blockiert durch ${hits.map((p) => `"${p.displayName}"`).join(', ')}.` : 'Der Geraetecode-Fluss ist nicht blockiert; er wird fuer Phishing von Anmeldungen genutzt.',
        'Conditional-Access-Richtlinie mit Bedingung "Authentifizierungsfluesse: Geraetecodefluss" und Zugriff blockieren; Ausnahmen nur fuer Konferenzraumgeraete o. ae.',
        { policies: hits.length }
      )
    );
  }

  // 14. Benutzer duerfen keine Tenants anlegen
  if (policies.authorization.available && policies.authorization.data.allowedToCreateTenants !== null) {
    const allowed = policies.authorization.data.allowedToCreateTenants;
    checks.push(check('tenant-creation', 'governance', 'Benutzer duerfen keine Tenants anlegen', 1, allowed ? 'warn' : 'pass', allowed ? 'Jeder Benutzer darf eigene Entra-Tenants anlegen.' : 'Tenant-Erstellung ist Administratoren vorbehalten.', 'Entra ID > Benutzereinstellungen: "Einschraenken, dass Nicht-Administratoren Mandanten erstellen" auf Ja.', { allowedToCreateTenants: allowed }));
  }

  // 15. SharePoint-Freigabe nach aussen
  {
    const src = policies.sharePointSharing;
    const rec = 'SharePoint Admin Center > Richtlinien > Freigabe: hoechstens "Neue und vorhandene Gaeste" (keine anonymen Links) oder enger; anonyme Links nur mit Ablaufdatum.';
    if (!src.available) checks.push(unknownCheck('sharepoint-sharing', 'governance', 'SharePoint ohne anonyme Freigabelinks', 2, src, rec));
    else {
      const level = src.data;
      const anonymous = level === 'externalUserAndGuestSharing';
      const labels: Record<string, string> = { disabled: 'nur intern', existingExternalUserSharingOnly: 'nur vorhandene Gaeste', externalUserSharingOnly: 'neue und vorhandene Gaeste', externalUserAndGuestSharing: 'jeder mit dem Link (anonym)' };
      checks.push(check('sharepoint-sharing', 'governance', 'SharePoint ohne anonyme Freigabelinks', 2, anonymous ? 'warn' : level === 'unknown' ? 'unknown' : 'pass', `Freigabe nach aussen: ${labels[level] ?? level}.`, rec, { sharingCapability: level }));
    }
  }

  // 16. Automatische Weiterleitung nach extern (Exchange-Worker)
  if (input.exchangeAutoForwarding !== undefined) {
    const mode = input.exchangeAutoForwarding;
    const rec = 'Defender-Portal > Richtlinien > Antispam > ausgehende Richtlinie: "Automatische Weiterleitung" auf Aus; Ausnahmen ueber eigene Richtlinie fuer einzelne Postfaecher.';
    if (mode === null) checks.push(check('external-forwarding', 'mail', 'Automatische Weiterleitung nach extern gesperrt', 3, 'unknown', 'Nicht pruefbar: Postfachdaten des Exchange-Workers fehlen (Exchange > Postfachdaten sammeln).', rec));
    else {
      const on = mode.toLowerCase() === 'on';
      checks.push(check('external-forwarding', 'mail', 'Automatische Weiterleitung nach extern gesperrt', 3, on ? 'fail' : 'pass', on ? 'Die ausgehende Spamrichtlinie erlaubt automatische Weiterleitung nach extern.' : `Einstellung "${mode}": automatische Weiterleitung nach extern ist gesperrt.`, rec, { autoForwardingMode: mode }));
    }
  }

  // 17. Intune-Sicherheitsbaselines und Compliance
  if (input.baselines !== undefined && input.baselines !== null) {
    checks.push(...evaluateBaselineChecks(input.baselines));
  }

  // 18. Mail-Authentifizierung per DNS
  if (mailAuth) {
    const d = mailAuth.domain;
    if (mailAuth.error) {
      checks.push(check('spf', 'mail', `SPF fuer ${d}`, 2, 'unknown', `DNS nicht abfragbar: ${mailAuth.error}`, 'SPF-TXT-Eintrag mit include:spf.protection.outlook.com und -all setzen.'));
    } else {
      const spf = mailAuth.spf;
      const spfStrict = !!spf && /-all\s*$/.test(spf);
      checks.push(
        check('spf', 'mail', `SPF fuer ${d}`, 2, !spf ? 'fail' : spfStrict ? 'pass' : 'warn', !spf ? 'Kein SPF-Eintrag.' : spfStrict ? 'SPF vorhanden mit hartem Fail (-all).' : 'SPF vorhanden, aber ohne hartes Fail (-all).', 'SPF-TXT-Eintrag mit include:spf.protection.outlook.com und -all setzen.', { spf: spf ?? null })
      );
      const dmarc = mailAuth.dmarc;
      const policyMatch = dmarc ? /p=(none|quarantine|reject)/i.exec(dmarc) : null;
      const policy = policyMatch ? policyMatch[1].toLowerCase() : null;
      checks.push(
        check('dmarc', 'mail', `DMARC fuer ${d}`, 3, !dmarc ? 'fail' : policy === 'reject' || policy === 'quarantine' ? 'pass' : 'warn', !dmarc ? 'Kein DMARC-Eintrag.' : policy === 'none' ? 'DMARC nur im Ueberwachungsmodus (p=none).' : `DMARC mit p=${policy ?? 'unbekannt'}.`, 'DMARC-Eintrag _dmarc mit p=quarantine oder p=reject und rua-Adresse fuer Berichte setzen.', { dmarc: dmarc ?? null })
      );
      const dkim = mailAuth.dkim;
      const dkimOk = !!dkim.selector1 && !!dkim.selector2;
      checks.push(
        check('dkim', 'mail', `DKIM fuer ${d}`, 2, dkimOk ? 'pass' : dkim.selector1 || dkim.selector2 ? 'warn' : 'fail', dkimOk ? 'Beide Microsoft-DKIM-Selektoren sind veroeffentlicht.' : dkim.selector1 || dkim.selector2 ? 'Nur ein DKIM-Selektor veroeffentlicht.' : 'Keine DKIM-CNAMEs (selector1/selector2._domainkey) gefunden.', 'Im Defender-Portal DKIM fuer die Domaene aktivieren und die beiden CNAME-Eintraege im DNS anlegen.', { selector1: dkim.selector1, selector2: dkim.selector2 })
      );
    }
  }

  const order: Record<SecurityCheckStatus, number> = { fail: 0, warn: 1, unknown: 2, pass: 3, 'not-applicable': 4 };
  return checks.sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight || a.title.localeCompare(b.title, 'de'));
}

const BASELINE_LABELS: Record<Exclude<BaselineKind, 'other' | 'windows365'>, { title: string; weight: SecurityCheck['weight']; rec: string }> = {
  windows: { title: 'Windows-Sicherheitsbaseline zugewiesen', weight: 3, rec: 'Intune > Endpunktsicherheit > Sicherheitsbaselines: "Security Baseline for Windows" anlegen, Abweichungen begruendet dokumentieren und allen Windows-Geraeten zuweisen.' },
  defender: { title: 'Defender-for-Endpoint-Baseline zugewiesen', weight: 2, rec: 'Sicherheitsbaseline "Microsoft Defender for Endpoint" anlegen und den Windows-Geraeten zuweisen.' },
  edge: { title: 'Edge-Sicherheitsbaseline zugewiesen', weight: 1, rec: 'Sicherheitsbaseline "Microsoft Edge" anlegen und zuweisen.' },
  'm365-apps': { title: 'Microsoft-365-Apps-Baseline zugewiesen', weight: 1, rec: 'Sicherheitsbaseline "Microsoft 365 Apps for Enterprise" anlegen und zuweisen.' },
};

/** Prueft Baselines und Compliance-Richtlinien; reine Funktion fuer Tests. */
export function evaluateBaselineChecks(source: BaselineOverview): SecurityCheck[] {
  const out: SecurityCheck[] = [];
  if (!source.available) {
    out.push(unknownCheck('baseline-windows', 'devices', BASELINE_LABELS.windows.title, 3, source, BASELINE_LABELS.windows.rec));
    return out;
  }
  const { baselines, compliance } = source.data;
  for (const kind of Object.keys(BASELINE_LABELS) as Array<keyof typeof BASELINE_LABELS>) {
    const meta = BASELINE_LABELS[kind];
    const all = baselines.filter((b) => b.kind === kind);
    const assigned = all.filter((b) => b.assigned);
    const status: SecurityCheckStatus = assigned.length > 0 ? 'pass' : all.length > 0 ? 'warn' : kind === 'windows' ? 'fail' : 'warn';
    const summary = assigned.length > 0 ? `Zugewiesen: ${assigned.map((b) => `"${b.name}"${b.templateVersion ? ` (${b.templateVersion})` : ''}`).join(', ')}.` : all.length > 0 ? `Angelegt, aber nicht zugewiesen: ${all.map((b) => `"${b.name}"`).join(', ')}.` : 'Keine solche Baseline im Tenant.';
    out.push(check(`baseline-${kind}`, 'devices', meta.title, meta.weight, status, summary, meta.rec, { assigned: assigned.length, total: all.length }));
  }

  const withStatus = baselines.filter((b) => b.assigned && b.status);
  if (withStatus.length > 0) {
    const errors = withStatus.reduce((sum, b) => sum + (b.status?.error ?? 0) + (b.status?.conflict ?? 0), 0);
    const failed = withStatus.reduce((sum, b) => sum + (b.status?.failed ?? 0), 0);
    out.push(
      check(
        'baseline-deviations',
        'devices',
        'Geraete ohne Abweichung von den Baselines',
        2,
        errors > 0 ? 'fail' : failed > 0 ? 'warn' : 'pass',
        errors > 0 ? `${errors} Geraetezustand(e) mit Fehler oder Konflikt, ${failed} nicht konform.` : failed > 0 ? `${failed} Geraetezustand(e) nicht konform mit einer Baseline.` : 'Alle gemeldeten Geraete entsprechen den zugewiesenen Baselines.',
        'Konflikte mit anderen Konfigurationsprofilen aufloesen (gleiche Einstellung doppelt), Fehler je Geraet im Intune-Portal pruefen.',
        { errorsOrConflicts: errors, notCompliant: failed, baselines: withStatus.length }
      )
    );
  }

  const windowsCompliance = compliance.filter((p) => p.platform === 'windows' && p.assigned);
  out.push(
    check(
      'compliance-windows',
      'devices',
      'Windows-Compliance-Richtlinie zugewiesen',
      3,
      windowsCompliance.length > 0 ? 'pass' : 'fail',
      windowsCompliance.length > 0 ? `Zugewiesen: ${windowsCompliance.map((p) => `"${p.name}"`).join(', ')}.` : 'Keine zugewiesene Compliance-Richtlinie fuer Windows.',
      'Compliance-Richtlinie Windows 10/11 mit BitLocker, Secure Boot, Defender, Firewall und Mindest-OS anlegen und allen Geraeten zuweisen.',
      { policies: windowsCompliance.length }
    )
  );

  const totals = compliance.filter((p) => p.assigned && p.status).reduce(
    (acc, p) => ({ ok: acc.ok + (p.status?.success ?? 0), bad: acc.bad + (p.status?.failed ?? 0) + (p.status?.error ?? 0) }),
    { ok: 0, bad: 0 }
  );
  if (totals.ok + totals.bad > 0) {
    const share = Math.round((totals.bad / (totals.ok + totals.bad)) * 100);
    out.push(
      check(
        'compliance-rate',
        'devices',
        'Geraete erfuellen die Compliance-Richtlinien',
        2,
        share === 0 ? 'pass' : share <= 10 ? 'warn' : 'fail',
        `${totals.bad} von ${totals.ok + totals.bad} Geraetezustaenden nicht konform (${share} %).`,
        'Nicht konforme Geraete im Intune-Portal pruefen; Conditional Access mit "konformes Geraet" sperrt sie sonst aus oder laesst sie durch.',
        { notCompliant: totals.bad, compliant: totals.ok, percent: share }
      )
    );
  }
  return out;
}

export function buildCheckReport(input: CheckInput, generatedAt = new Date()): SecurityCheckReport {
  const checks = evaluateChecks(input);
  const counts: Record<SecurityCheckStatus, number> = { pass: 0, warn: 0, fail: 0, unknown: 0, 'not-applicable': 0 };
  for (const c of checks) counts[c.status] += 1;
  const scored = checks.filter((c) => c.status === 'pass' || c.status === 'warn' || c.status === 'fail');
  const max = scored.reduce((s, c) => s + c.weight, 0);
  const got = scored.reduce((s, c) => s + (c.status === 'pass' ? c.weight : c.status === 'warn' ? c.weight / 2 : 0), 0);

  const unavailableSources: SecurityCheckReport['unavailableSources'] = [];
  const sources: [string, CapabilityResult<unknown>][] = [
    ['Conditional Access', input.policies.conditionalAccess],
    ['Sicherheitsstandards', input.policies.securityDefaultsEnabled],
    ['Authentifizierungsmethoden', input.policies.authenticationMethods],
    ['Autorisierungsrichtlinie', input.policies.authorization],
    ['Verzeichnisrollen', input.policies.globalAdminCount],
    ['Domaenen', input.policies.domains],
    ['Intune-Compliance', input.policies.compliancePolicyCount],
    ['SharePoint-Einstellungen', input.policies.sharePointSharing],
    ...(input.baselines ? ([['Intune-Baselines', input.baselines]] as [string, CapabilityResult<unknown>][]) : []),
  ];
  for (const [source, result] of sources) {
    if (!result.available) {
      unavailableSources.push({ source, reason: result.reason as CapabilityUnavailableReason, missingPermission: result.missingPermission, detail: result.detail });
    }
  }

  return { checks, counts, scorePercent: max > 0 ? Math.round((got / max) * 100) : null, unavailableSources, generatedAt: generatedAt.toISOString() };
}
