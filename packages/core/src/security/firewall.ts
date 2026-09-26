/**
 * Regelvorschlag fuer ausgehende Firewall-Regeln
 *
 * Aus den tenantweiten Zielen (Advanced Hunting) und der oeffentlichen
 * Microsoft-365-Endpunktliste (endpoints.office.com) entsteht eine Liste
 * von Regelgruppen: Microsoft 365 je Dienst mit Microsoft-Kategorie, weitere
 * Microsoft-Dienste, bekannte Hersteller und "sonstige" Ziele mit Anzahl
 * Geraete und Prozessen als Beleg. Das ist ein Vorschlag zum Pruefen, keine
 * Konfiguration, die irgendwo geschrieben wird.
 */

import type { ConnectionReport, ConnectionSummary, FirewallProposal, FirewallRule, FirewallRuleKind } from '@zerostress/types';

export interface M365Endpoint {
  id: number;
  serviceArea: string;
  serviceAreaDisplayName: string;
  urls: string[];
  ips: string[];
  tcpPorts: string | null;
  udpPorts: string | null;
  category: string;
  required: boolean;
  notes: string | null;
}

interface RawEndpoint {
  id?: number;
  serviceArea?: string;
  serviceAreaDisplayName?: string;
  urls?: string[];
  ips?: string[];
  tcpPorts?: string;
  udpPorts?: string;
  category?: string;
  required?: boolean;
  notes?: string;
}

/** Antwort von endpoints.office.com in die neutrale Form. */
export function parseM365Endpoints(raw: unknown): M365Endpoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is RawEndpoint => !!e && typeof e === 'object')
    .map((e) => ({
      id: Number(e.id ?? 0),
      serviceArea: e.serviceArea ?? 'Common',
      serviceAreaDisplayName: e.serviceAreaDisplayName ?? e.serviceArea ?? 'Microsoft 365',
      urls: (e.urls ?? []).map((u) => u.toLowerCase()),
      ips: e.ips ?? [],
      tcpPorts: e.tcpPorts ?? null,
      udpPorts: e.udpPorts ?? null,
      category: e.category ?? 'Default',
      required: e.required === true,
      notes: e.notes ?? null,
    }));
}

/** Hostname gegen Muster wie *.office.com oder outlook.office365.com. */
export function domainMatches(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase();
  const h = host.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(1);
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  if (p.includes('*')) {
    const re = new RegExp(`^${p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(h);
  }
  return p === h;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((x) => Number(x));
  if (parts.length !== 4 || parts.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function ipv6ToBits(ip: string): string | null {
  const [head, tail] = ip.toLowerCase().split('::');
  if (ip.includes('.')) return null;
  const headParts = head ? head.split(':') : [];
  const tailParts = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  if (tail === undefined && headParts.length !== 8) return null;
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const groups = [...headParts, ...Array(tail === undefined ? 0 : missing).fill('0'), ...tailParts];
  if (groups.length !== 8) return null;
  let bits = '';
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    bits += parseInt(g, 16).toString(2).padStart(16, '0');
  }
  return bits;
}

/** Liegt die Adresse im CIDR-Bereich (IPv4 oder IPv6)? */
export function cidrContains(cidr: string, ip: string): boolean {
  const [network, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  if (!network || !Number.isInteger(prefix)) return false;
  if (network.includes(':') !== ip.includes(':')) return false;
  if (!network.includes(':')) {
    const n = ipv4ToInt(network);
    const a = ipv4ToInt(ip);
    if (n === null || a === null || prefix < 0 || prefix > 32) return false;
    if (prefix === 0) return true;
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return ((n & mask) >>> 0) === ((a & mask) >>> 0);
  }
  const n = ipv6ToBits(network);
  const a = ipv6ToBits(ip);
  if (!n || !a || prefix < 0 || prefix > 128) return false;
  return n.slice(0, prefix) === a.slice(0, prefix);
}

/** Erster Microsoft-365-Endpunkt, der zu Hostname oder IP passt. */
export function matchM365(item: Pick<ConnectionSummary, 'remoteIp' | 'remoteUrl'>, endpoints: M365Endpoint[]): M365Endpoint | null {
  const host = item.remoteUrl?.toLowerCase() ?? null;
  if (host) {
    for (const e of endpoints) if (e.urls.some((u) => domainMatches(u, host))) return e;
  }
  for (const e of endpoints) if (e.ips.some((c) => cidrContains(c, item.remoteIp))) return e;
  return null;
}

interface KnownDestination {
  name: string;
  kind: Exclude<FirewallRuleKind, 'microsoft365' | 'other'>;
  patterns: string[];
  note: string | null;
}

/** Bekannte Ziele ausserhalb der M365-Liste; bewusst kurz und nachvollziehbar. */
export const KNOWN_DESTINATIONS: KnownDestination[] = [
  { name: 'Windows Update und Delivery Optimization', kind: 'microsoft', patterns: ['*.windowsupdate.com', '*.update.microsoft.com', '*.delivery.mp.microsoft.com', '*.dl.delivery.mp.microsoft.com', 'tlu.dl.delivery.mp.microsoft.com', '*.windowsupdate.microsoft.com', '*.do.dsp.mp.microsoft.com'], note: 'Erforderlich fuer Updates' },
  { name: 'Microsoft Defender for Endpoint', kind: 'microsoft', patterns: ['*.wdcp.microsoft.com', '*.wd.microsoft.com', '*.endpoint.security.microsoft.com', '*.securitycenter.windows.com', '*.blob.core.windows.net', 'winatp-gw-*.microsoft.com', '*.events.data.microsoft.com'], note: 'Sensor und Cloud-Schutz' },
  { name: 'Intune und Entra ID', kind: 'microsoft', patterns: ['*.manage.microsoft.com', 'login.microsoftonline.com', '*.login.microsoftonline.com', 'enterpriseregistration.windows.net', 'device.login.microsoftonline.com', '*.msauth.net', '*.msftauth.net', 'aadcdn.msftauth.net', '*.dm.microsoft.com'], note: 'Geraeteverwaltung und Anmeldung' },
  { name: 'Windows-Telemetrie und Konnektivitaetstest', kind: 'microsoft', patterns: ['*.msftconnecttest.com', '*.msftncsi.com', 'v10.events.data.microsoft.com', '*.telemetry.microsoft.com', 'settings-win.data.microsoft.com', '*.vortex-win.data.microsoft.com'], note: null },
  { name: 'Microsoft Store und App Installer', kind: 'microsoft', patterns: ['*.microsoft.com', 'storeedgefd.dsx.mp.microsoft.com', 'displaycatalog.mp.microsoft.com', 'licensing.mp.microsoft.com', '*.msedge.net', 'cdn.winget.microsoft.com'], note: 'Enthaelt auch allgemeine Microsoft-Ziele' },
  { name: 'Microsoft Edge und Bing', kind: 'microsoft', patterns: ['*.bing.com', 'edge.microsoft.com', 'msedge.b.tlu.dl.delivery.mp.microsoft.com', '*.edgesuite.net'], note: null },
  { name: 'Google (Chrome, Updates, Dienste)', kind: 'known-vendor', patterns: ['*.google.com', '*.googleapis.com', '*.gstatic.com', '*.googleusercontent.com', '*.gvt1.com', '*.gvt2.com', 'dl.google.com'], note: null },
  { name: 'Adobe', kind: 'known-vendor', patterns: ['*.adobe.com', '*.adobe.io', '*.adobelogin.com', '*.typekit.net', '*.adobess.com'], note: null },
  { name: 'Mozilla', kind: 'known-vendor', patterns: ['*.mozilla.org', '*.mozilla.com', '*.mozilla.net', '*.firefox.com'], note: null },
  { name: 'TeamViewer', kind: 'known-vendor', patterns: ['*.teamviewer.com', '*.tvmanagement.com'], note: 'Fernwartung' },
  { name: 'Zoom', kind: 'known-vendor', patterns: ['*.zoom.us', '*.zoom.com', '*.zoomgov.com'], note: null },
  { name: 'Apple', kind: 'known-vendor', patterns: ['*.apple.com', '*.icloud.com', '*.mzstatic.com'], note: null },
  { name: 'Dell', kind: 'known-vendor', patterns: ['*.dell.com', '*.dellcdn.com'], note: 'Command Update, Treiber' },
  { name: 'HP', kind: 'known-vendor', patterns: ['*.hp.com', '*.hpicorp.net'], note: null },
  { name: 'Lenovo', kind: 'known-vendor', patterns: ['*.lenovo.com', '*.lenovomm.com'], note: null },
  { name: 'Cloudflare, Akamai, Fastly (CDN)', kind: 'known-vendor', patterns: ['*.cloudflare.com', '*.cloudflare.net', '*.akamaized.net', '*.akamai.net', '*.akamaiedge.net', '*.fastly.net', '*.cloudfront.net'], note: 'Inhalte vieler Anbieter; Ziel allein sagt wenig' },
];

function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  // Zweistufige TLDs wie co.uk grob abfangen
  const twoLevel = ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'];
  if (parts[parts.length - 1].length === 2 && twoLevel.includes(parts[parts.length - 2])) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

interface Bucket {
  key: string;
  kind: FirewallRuleKind;
  name: string;
  m365Category: string | null;
  required: boolean | null;
  note: string | null;
  destinations: Set<string>;
  ports: Set<number>;
  devices: number;
  connections: number;
  processes: Map<string, number>;
  lastSeen: string | null;
}

/**
 * Regelgruppen aus den externen Zielen bilden: M365 nach Dienst, bekannte
 * Ziele nach Hersteller, der Rest nach registrierbarer Domaene; nackte IPs
 * ohne Hostnamen werden nur gezaehlt.
 */
export function buildFirewallProposal(report: ConnectionReport, endpoints: M365Endpoint[], endpointsVersion: string | null, now: Date): FirewallProposal {
  const buckets = new Map<string, Bucket>();
  let unmatchedIps = 0;
  const bucketFor = (key: string, init: Omit<Bucket, 'key' | 'destinations' | 'ports' | 'devices' | 'connections' | 'processes' | 'lastSeen'>): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = { key, ...init, destinations: new Set(), ports: new Set(), devices: 0, connections: 0, processes: new Map(), lastSeen: null };
      buckets.set(key, b);
    }
    return b;
  };

  for (const item of report.items) {
    if (item.scope !== 'public') continue;
    let bucket: Bucket;
    const m365 = matchM365(item, endpoints);
    if (m365) {
      bucket = bucketFor(`m365:${m365.serviceArea}:${m365.category}`, {
        kind: 'microsoft365',
        name: `Microsoft 365: ${m365.serviceAreaDisplayName} (${m365.category})`,
        m365Category: m365.category,
        required: m365.required,
        note: m365.category === 'Optimize' ? 'Direkt ins Internet, ohne Proxy oder Inspektion (Microsoft-Empfehlung)' : m365.category === 'Allow' ? 'Erlauben, Inspektion moeglich' : 'Standard, wie normaler Internetverkehr',
      });
    } else {
      const host = item.remoteUrl?.toLowerCase() ?? null;
      const known = host ? KNOWN_DESTINATIONS.find((k) => k.patterns.some((p) => domainMatches(p, host))) : null;
      if (known) {
        bucket = bucketFor(`known:${known.name}`, { kind: known.kind, name: known.name, m365Category: null, required: null, note: known.note });
      } else if (host) {
        const domain = registrableDomain(host);
        bucket = bucketFor(`other:${domain}`, { kind: 'other', name: domain, m365Category: null, required: null, note: null });
      } else {
        unmatchedIps += 1;
        bucket = bucketFor('other:ip-only', { kind: 'other', name: 'Nur IP-Adressen ohne Hostnamen', m365Category: null, required: null, note: 'Ziel nicht zuordenbar; je Adresse pruefen (WHOIS, Prozess)' });
      }
    }
    bucket.destinations.add(item.remoteUrl ?? item.remoteIp);
    for (const p of item.ports) bucket.ports.add(p);
    bucket.devices = Math.max(bucket.devices, item.deviceCount ?? 0);
    bucket.connections += item.count;
    for (const proc of item.processes) bucket.processes.set(proc, (bucket.processes.get(proc) ?? 0) + item.count);
    if (item.lastSeen && (!bucket.lastSeen || item.lastSeen > bucket.lastSeen)) bucket.lastSeen = item.lastSeen;
  }

  const order: Record<FirewallRuleKind, number> = { microsoft365: 0, microsoft: 1, 'known-vendor': 2, other: 3 };
  const rules: FirewallRule[] = Array.from(buckets.values())
    .map((b) => ({
      id: b.key,
      kind: b.kind,
      name: b.name,
      m365Category: b.m365Category,
      required: b.required,
      destinations: Array.from(b.destinations).sort().slice(0, 50),
      ports: Array.from(b.ports).sort((x, y) => x - y).slice(0, 20),
      devices: b.devices,
      connections: b.connections,
      processes: Array.from(b.processes.entries())
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([p]) => p),
      lastSeen: b.lastSeen,
      note: b.note,
    }))
    .sort((x, y) => order[x.kind] - order[y.kind] || y.devices - x.devices || y.connections - x.connections);

  return {
    days: report.days,
    generatedAt: now.toISOString(),
    endpointsVersion,
    rules,
    unmatchedIps,
    totalDestinations: report.items.filter((i) => i.scope === 'public').length,
  };
}
