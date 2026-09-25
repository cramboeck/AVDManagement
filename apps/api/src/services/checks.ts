/**
 * Best-Practice-Checks eines Tenants: Richtlinien aus Graph, Mail-Authentifizierung
 * aus dem oeffentlichen DNS, Bewertung im Core.
 */

import { randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { buildCheckReport, type MailAuthRecords } from '@zerostress/core';
import type { ManagedTenant, SecurityCheckReport } from '@zerostress/types';
import { getPolicyProvider, getSecurityProvider } from './microsoft-clients.js';

const DNS_TIMEOUT_MS = 5000;

async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), DNS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise.catch(() => fallback), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function txt(name: string, prefix: RegExp): Promise<string | null> {
  const records = await withTimeout(dns.resolveTxt(name), [] as string[][]);
  const joined = records.map((r) => r.join(''));
  return joined.find((r) => prefix.test(r)) ?? null;
}

async function cname(name: string): Promise<string | null> {
  const records = await withTimeout(dns.resolveCname(name), [] as string[]);
  return records[0] ?? null;
}

/**
 * SPF, DMARC und die beiden Microsoft-DKIM-Selektoren der Primaerdomaene.
 */
export async function resolveMailAuth(domain: string): Promise<MailAuthRecords> {
  const clean = domain.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean) || clean.endsWith('.onmicrosoft.com')) {
    return { domain: clean, spf: null, dmarc: null, dkim: { selector1: null, selector2: null }, error: 'Keine eigene Mail-Domaene hinterlegt' };
  }
  try {
    const [spf, dmarc, selector1, selector2] = await Promise.all([
      txt(clean, /^v=spf1/i),
      txt(`_dmarc.${clean}`, /^v=DMARC1/i),
      cname(`selector1._domainkey.${clean}`),
      cname(`selector2._domainkey.${clean}`),
    ]);
    return { domain: clean, spf, dmarc, dkim: { selector1, selector2 }, error: null };
  } catch (error) {
    return { domain: clean, spf: null, dmarc: null, dkim: { selector1: null, selector2: null }, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function buildSecurityChecks(tenant: ManagedTenant): Promise<SecurityCheckReport> {
  const ctx = { tenantId: tenant.id, correlationId: randomUUID() };
  const [policies, mailAuth, mfa] = await Promise.all([
    getPolicyProvider().getSnapshot(ctx),
    resolveMailAuth(tenant.primaryDomain),
    getSecurityProvider()
      .getMfaRegistration(ctx)
      .catch(() => null),
  ]);
  const adminsWithoutMfa = mfa && mfa.available ? mfa.data.adminsWithoutMfa : null;
  return buildCheckReport({ policies, mailAuth, adminsWithoutMfa });
}
