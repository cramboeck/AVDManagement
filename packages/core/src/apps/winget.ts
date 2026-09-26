/**
 * winget-Katalog als Installerquelle
 *
 * Die Manifeste des Community-Katalogs liegen oeffentlich im GitHub-Repo
 * microsoft/winget-pkgs (manifests/<a>/<Publisher>/<Name>/<Version>/...).
 * Wir lesen sie direkt: Versionsliste ueber die Contents-API, Manifeste als
 * Rohdatei. Kein winget-Client noetig. Der Worker laedt den Installer
 * spaeter von der im Manifest hinterlegten URL und prueft den SHA-256.
 */

import { parse as parseYaml } from 'yaml';
import type { PackageArchitecture, SourceInstaller, SourceInstallerType, WingetCatalogEntry, WingetResolution } from '@zerostress/types';

export const WINGET_REPO = 'microsoft/winget-pkgs';
const CONTENTS_BASE = `https://api.github.com/repos/${WINGET_REPO}/contents`;
const RAW_BASE = `https://raw.githubusercontent.com/${WINGET_REPO}/master`;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const STORE_ID_PATTERN = /^[0-9A-Z]{12}$/;
const SUPPORTED: SourceInstallerType[] = ['msi', 'wix', 'exe', 'inno', 'nullsoft', 'burn'];

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface WingetClientOptions {
  fetchImpl?: FetchLike;
  // Optionales GitHub-Token gegen das Ratenlimit der Contents-API (60/h ohne Token)
  githubToken?: string | null;
}

export class WingetError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'rate-limited' | 'unsupported' | 'invalid' | 'network'
  ) {
    super(message);
  }
}

export function isStoreProductId(value: string): boolean {
  return STORE_ID_PATTERN.test(value.trim());
}

export function isWingetId(value: string): boolean {
  return ID_PATTERN.test(value.trim()) && !isStoreProductId(value);
}

/** Pfad im Repo: manifests/<erster Buchstabe klein>/<Teile der Id> */
export function manifestFolder(id: string): string {
  const parts = id.split('.');
  return `manifests/${id[0].toLowerCase()}/${parts.join('/')}`;
}

/**
 * Versionen sortieren: numerische Segmente numerisch, Rest als Text.
 * Neueste zuerst.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => v.split(/[.\-+]/).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y;
    } else {
      const c = String(x).localeCompare(String(y), undefined, { numeric: true });
      if (c !== 0) return c;
    }
  }
  return 0;
}

export function newestVersion(versions: string[]): string | null {
  return [...versions].sort((x, y) => compareVersions(y, x))[0] ?? null;
}

interface RawInstaller {
  Architecture?: string;
  InstallerType?: string;
  NestedInstallerType?: string;
  Scope?: string;
  InstallerUrl?: string;
  InstallerSha256?: string;
  InstallerSwitches?: { Silent?: string; SilentWithProgress?: string; Custom?: string };
  ProductCode?: string;
  InstallerLocale?: string;
  AppsAndFeaturesEntries?: Array<{ DisplayName?: string; ProductCode?: string; DisplayVersion?: string }>;
}

interface InstallerManifest extends RawInstaller {
  PackageIdentifier?: string;
  PackageVersion?: string;
  Installers?: RawInstaller[];
}

interface LocaleManifest {
  Publisher?: string;
  PackageName?: string;
  ShortDescription?: string;
  Description?: string;
  PublisherUrl?: string;
  PackageUrl?: string;
  License?: string;
}

interface VersionManifest {
  DefaultLocale?: string;
}

function fileNameFromUrl(url: string, id: string, type: SourceInstallerType): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    const clean = last.replace(/[\\/:*?"<>|]/g, '_');
    if (/\.(msi|exe)$/i.test(clean) && !/^\.+$/.test(clean) && !clean.includes('..')) return clean;
  } catch {
    // URL unbrauchbar: generischer Name
  }
  return `${id.replace(/[^A-Za-z0-9.+-]/g, '')}.${type === 'msi' || type === 'wix' ? 'msi' : 'exe'}`;
}

function normalizeType(raw: string | undefined): SourceInstallerType | null {
  const t = (raw ?? '').toLowerCase();
  return (SUPPORTED as string[]).includes(t) ? (t as SourceInstallerType) : null;
}

function normalizeArch(raw: string | undefined): PackageArchitecture | null {
  const a = (raw ?? '').toLowerCase();
  if (a === 'x64' || a === 'x86' || a === 'arm64' || a === 'neutral') return a;
  return null;
}

/** Stiller Schalter: aus dem Manifest, sonst der uebliche je Installertyp. */
export function defaultSilentSwitch(type: SourceInstallerType, fromManifest: string | null): string | null {
  if (fromManifest) return fromManifest;
  switch (type) {
    case 'inno':
      return '/VERYSILENT /NORESTART /SP- /SUPPRESSMSGBOXES';
    case 'nullsoft':
      return '/S';
    case 'burn':
      return '/quiet /norestart';
    case 'msi':
    case 'wix':
      return null;
    default:
      return null;
  }
}

/**
 * Passenden Installer waehlen: Architektur wie gewuenscht (x64 vor neutral),
 * Scope machine vor user, MSI vor EXE. Nicht unterstuetzte Typen (msix,
 * appx, zip, portable) fallen raus.
 */
export function selectInstaller(manifest: InstallerManifest, wantedArch: PackageArchitecture, now: Date): { installer: SourceInstaller | null; skipped: string[] } {
  const id = manifest.PackageIdentifier ?? '';
  const version = manifest.PackageVersion ?? '';
  const skipped: string[] = [];
  const candidates: Array<{ raw: RawInstaller; type: SourceInstallerType; arch: PackageArchitecture; score: number }> = [];
  for (const raw of manifest.Installers ?? []) {
    const merged: RawInstaller = { ...manifest, ...raw, InstallerSwitches: { ...(manifest.InstallerSwitches ?? {}), ...(raw.InstallerSwitches ?? {}) }, Installers: undefined } as RawInstaller;
    const type = normalizeType(merged.InstallerType);
    const arch = normalizeArch(merged.Architecture);
    const label = `${merged.Architecture ?? '?'} ${merged.InstallerType ?? '?'}${merged.Scope ? ` (${merged.Scope})` : ''}`;
    if (!type) {
      skipped.push(`${label}: Installertyp wird nicht unterstuetzt`);
      continue;
    }
    if (!arch) {
      skipped.push(`${label}: unbekannte Architektur`);
      continue;
    }
    if (!merged.InstallerUrl || !merged.InstallerSha256) {
      skipped.push(`${label}: ohne URL oder Hash`);
      continue;
    }
    const archOk = arch === wantedArch || (wantedArch === 'x64' && arch === 'neutral') || (wantedArch === 'arm64' && arch === 'neutral');
    if (!archOk) {
      skipped.push(`${label}: andere Architektur`);
      continue;
    }
    const scope = (merged.Scope ?? '').toLowerCase();
    if (scope === 'user') {
      skipped.push(`${label}: Benutzer-Scope, fuer Systeminstallation ungeeignet`);
    }
    let score = 0;
    if (arch === wantedArch) score += 40;
    if (scope === 'machine') score += 30;
    else if (scope === '') score += 15;
    if (type === 'msi' || type === 'wix') score += 20;
    else if (type === 'burn') score += 8;
    else if (type === 'inno' || type === 'nullsoft') score += 6;
    const locale = (merged.InstallerLocale ?? '').toLowerCase();
    if (locale === '' || locale.startsWith('en') || locale.startsWith('de')) score += 3;
    if (scope !== 'user') candidates.push({ raw: merged, type, arch, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return { installer: null, skipped };
  const entry = best.raw.AppsAndFeaturesEntries?.[0];
  const productCode = best.raw.ProductCode ?? entry?.ProductCode ?? null;
  return {
    installer: {
      packageIdentifier: id,
      version,
      url: best.raw.InstallerUrl as string,
      sha256: (best.raw.InstallerSha256 as string).toLowerCase(),
      installerType: best.type,
      architecture: best.arch,
      scope: (best.raw.Scope ?? '').toLowerCase() === 'machine' ? 'machine' : (best.raw.Scope ?? '').toLowerCase() === 'user' ? 'user' : null,
      silentSwitch: defaultSilentSwitch(best.type, best.raw.InstallerSwitches?.Silent?.trim() || best.raw.InstallerSwitches?.SilentWithProgress?.trim() || null),
      productCode: productCode && /^\{[0-9A-Fa-f-]{36}\}$/.test(productCode) ? productCode.toUpperCase() : null,
      displayName: entry?.DisplayName ?? null,
      displayNameExact: !!entry?.DisplayName,
      fileName: fileNameFromUrl(best.raw.InstallerUrl as string, id, best.type),
      resolvedAt: now.toISOString(),
    },
    skipped,
  };
}

export class WingetClient {
  private readonly fetchImpl: FetchLike;
  private readonly token: string | null;

  constructor(
    options: WingetClientOptions = {},
    private readonly now: () => Date = () => new Date()
  ) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.token = options.githubToken ?? null;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'zerostress-cockpit' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  private async getJson<T>(url: string): Promise<T | null> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, { headers: this.headers() });
    } catch (error) {
      throw new WingetError(`GitHub nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`, 'network');
    }
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) throw new WingetError('GitHub-Ratenlimit erreicht; GITHUB_TOKEN setzen oder spaeter erneut versuchen', 'rate-limited');
    if (!res.ok) throw new WingetError(`GitHub antwortete mit ${res.status}`, 'network');
    return (await res.json()) as T;
  }

  private async getText(url: string): Promise<string | null> {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetchImpl(url, { headers: { 'User-Agent': 'zerostress-cockpit' } });
    } catch (error) {
      throw new WingetError(`GitHub nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`, 'network');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new WingetError(`GitHub antwortete mit ${res.status}`, 'network');
    return res.text();
  }

  /** Alle Versionen eines Pakets, neueste zuerst. Leer, wenn das Paket fehlt. */
  async listVersions(id: string): Promise<string[]> {
    if (!isWingetId(id)) throw new WingetError(`Keine gueltige winget-Id: ${id}`, 'invalid');
    const entries = await this.getJson<Array<{ name: string; type: string }>>(`${CONTENTS_BASE}/${manifestFolder(id)}`);
    if (!entries || !Array.isArray(entries)) return [];
    return entries
      .filter((e) => e.type === 'dir' && e.name !== '.validation')
      .map((e) => e.name)
      .sort((x, y) => compareVersions(y, x));
  }

  /** Paketnamen eines Herausgebers (Ordner unter manifests/<a>/<Publisher>). */
  async browsePublisher(publisher: string): Promise<string[]> {
    const clean = publisher.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,80}$/.test(clean)) throw new WingetError('Herausgeber ungueltig', 'invalid');
    const entries = await this.getJson<Array<{ name: string; type: string }>>(`${CONTENTS_BASE}/manifests/${clean[0].toLowerCase()}/${clean}`);
    if (!entries || !Array.isArray(entries)) return [];
    return entries.filter((e) => e.type === 'dir').map((e) => `${clean}.${e.name}`);
  }

  /**
   * Manifest einer Version lesen und den Installer waehlen.
   * version 'latest' oder leer = neueste Version.
   */
  async resolve(id: string, version: string | null | undefined, wantedArch: PackageArchitecture = 'x64'): Promise<WingetResolution> {
    const versions = await this.listVersions(id);
    if (versions.length === 0) throw new WingetError(`Paket ${id} nicht im winget-Katalog gefunden (Schreibweise wie in 'winget search', z. B. 7zip.7zip)`, 'not-found');
    const wanted = !version || version === 'latest' ? versions[0] : versions.find((v) => v === version);
    if (!wanted) throw new WingetError(`Version ${version} von ${id} nicht im Katalog; vorhanden: ${versions.slice(0, 5).join(', ')}`, 'not-found');
    const folder = `${RAW_BASE}/${manifestFolder(id)}/${wanted}`;
    const installerText = await this.getText(`${folder}/${id}.installer.yaml`);
    if (!installerText) throw new WingetError(`Installer-Manifest fuer ${id} ${wanted} fehlt`, 'not-found');
    const installerManifest = parseYaml(installerText) as InstallerManifest;
    const versionText = await this.getText(`${folder}/${id}.yaml`);
    const defaultLocale = versionText ? ((parseYaml(versionText) as VersionManifest).DefaultLocale ?? 'en-US') : 'en-US';
    const localeText = (await this.getText(`${folder}/${id}.locale.${defaultLocale}.yaml`)) ?? (await this.getText(`${folder}/${id}.locale.en-US.yaml`));
    const locale = localeText ? (parseYaml(localeText) as LocaleManifest) : {};

    const { installer, skipped } = selectInstaller({ ...installerManifest, PackageIdentifier: id, PackageVersion: wanted }, wantedArch, this.now());
    if (!installer) {
      throw new WingetError(`Kein verwendbarer Installer fuer ${id} ${wanted} (${wantedArch}): ${skipped.join('; ') || 'keine Installer im Manifest'}`, 'unsupported');
    }
    // Ohne Apps-und-Features-Eintrag im Manifest: Paketname als Namensteil fuer die Deinstallation
    if (!installer.displayName && locale.PackageName?.trim()) {
      installer.displayName = locale.PackageName.trim();
      installer.displayNameExact = false;
    }
    return {
      packageIdentifier: id,
      version: wanted,
      availableVersions: versions.slice(0, 20),
      publisher: locale.Publisher?.trim() || id.split('.')[0],
      name: locale.PackageName?.trim() || id.split('.').slice(1).join(' '),
      description: locale.ShortDescription?.trim() || locale.Description?.trim().slice(0, 500) || null,
      homepage: locale.PackageUrl?.trim() || locale.PublisherUrl?.trim() || null,
      license: locale.License?.trim() || null,
      installer,
      skipped,
    };
  }
}

/**
 * Basis-Set gaengiger Software fuer MSP-Kunden. Nur Ids, die als
 * Systeminstallation (msi/exe) im Community-Katalog vorliegen.
 */
export const WINGET_BASE_SET: WingetCatalogEntry[] = [
  { id: '7zip.7zip', name: '7-Zip', publisher: 'Igor Pavlov', category: 'Werkzeuge', note: null },
  { id: 'Google.Chrome', name: 'Google Chrome', publisher: 'Google', category: 'Browser', note: 'Enterprise-MSI' },
  { id: 'Mozilla.Firefox', name: 'Mozilla Firefox', publisher: 'Mozilla', category: 'Browser', note: null },
  { id: 'Adobe.Acrobat.Reader.64-bit', name: 'Adobe Acrobat Reader', publisher: 'Adobe', category: 'Dokumente', note: 'Update-Zyklus beachten' },
  { id: 'Foxit.FoxitReader', name: 'Foxit PDF Reader', publisher: 'Foxit', category: 'Dokumente', note: null },
  { id: 'Notepad++.Notepad++', name: 'Notepad++', publisher: 'Notepad++ Team', category: 'Werkzeuge', note: null },
  { id: 'Microsoft.VisualStudioCode', name: 'Visual Studio Code', publisher: 'Microsoft', category: 'Entwicklung', note: 'System-Setup' },
  { id: 'Microsoft.PowerToys', name: 'PowerToys', publisher: 'Microsoft', category: 'Werkzeuge', note: null },
  { id: 'Microsoft.PowerShell', name: 'PowerShell 7', publisher: 'Microsoft', category: 'Werkzeuge', note: null },
  { id: 'Microsoft.WindowsTerminal', name: 'Windows Terminal', publisher: 'Microsoft', category: 'Werkzeuge', note: null },
  { id: 'Microsoft.Teams', name: 'Microsoft Teams', publisher: 'Microsoft', category: 'Kommunikation', note: 'Neues Teams, Bootstrapper' },
  { id: 'Microsoft.OneDrive', name: 'OneDrive', publisher: 'Microsoft', category: 'Cloud', note: null },
  { id: 'Microsoft.VCRedist.2015+.x64', name: 'Visual C++ Redistributable 2015-2022 x64', publisher: 'Microsoft', category: 'Laufzeiten', note: null },
  { id: 'Microsoft.VCRedist.2015+.x86', name: 'Visual C++ Redistributable 2015-2022 x86', publisher: 'Microsoft', category: 'Laufzeiten', note: null },
  { id: 'Microsoft.DotNet.DesktopRuntime.8', name: '.NET Desktop Runtime 8', publisher: 'Microsoft', category: 'Laufzeiten', note: null },
  { id: 'Microsoft.EdgeWebView2Runtime', name: 'Edge WebView2 Runtime', publisher: 'Microsoft', category: 'Laufzeiten', note: null },
  { id: 'Oracle.JavaRuntimeEnvironment', name: 'Java Runtime Environment', publisher: 'Oracle', category: 'Laufzeiten', note: 'Lizenz pruefen' },
  { id: 'EclipseAdoptium.Temurin.17.JRE', name: 'Eclipse Temurin JRE 17', publisher: 'Eclipse Adoptium', category: 'Laufzeiten', note: 'freie Java-Alternative' },
  { id: 'VideoLAN.VLC', name: 'VLC media player', publisher: 'VideoLAN', category: 'Medien', note: null },
  { id: 'Zoom.Zoom', name: 'Zoom', publisher: 'Zoom', category: 'Kommunikation', note: null },
  { id: 'TeamViewer.TeamViewer', name: 'TeamViewer', publisher: 'TeamViewer', category: 'Fernwartung', note: null },
  { id: 'TeamViewer.TeamViewer.Host', name: 'TeamViewer Host', publisher: 'TeamViewer', category: 'Fernwartung', note: 'unbeaufsichtigt' },
  { id: 'RustDesk.RustDesk', name: 'RustDesk', publisher: 'RustDesk', category: 'Fernwartung', note: null },
  { id: 'Greenshot.Greenshot', name: 'Greenshot', publisher: 'Greenshot', category: 'Werkzeuge', note: null },
  { id: 'KeePassXCTeam.KeePassXC', name: 'KeePassXC', publisher: 'KeePassXC Team', category: 'Sicherheit', note: null },
  { id: 'DominikReichl.KeePass', name: 'KeePass', publisher: 'Dominik Reichl', category: 'Sicherheit', note: null },
  { id: 'WinSCP.WinSCP', name: 'WinSCP', publisher: 'Martin Prikryl', category: 'Werkzeuge', note: null },
  { id: 'PuTTY.PuTTY', name: 'PuTTY', publisher: 'Simon Tatham', category: 'Werkzeuge', note: null },
  { id: 'Git.Git', name: 'Git', publisher: 'Git', category: 'Entwicklung', note: null },
  { id: 'Citrix.Workspace', name: 'Citrix Workspace', publisher: 'Citrix', category: 'Remote', note: null },
  { id: 'Devolutions.RemoteDesktopManager', name: 'Remote Desktop Manager', publisher: 'Devolutions', category: 'Fernwartung', note: null },
  { id: 'Microsoft.RemoteDesktopClient', name: 'Remote Desktop (AVD-Client)', publisher: 'Microsoft', category: 'Remote', note: null },
  { id: 'Microsoft.AzureCLI', name: 'Azure CLI', publisher: 'Microsoft', category: 'Entwicklung', note: null },
  { id: 'Microsoft.SQLServerManagementStudio', name: 'SQL Server Management Studio', publisher: 'Microsoft', category: 'Entwicklung', note: 'gross' },
  { id: 'Dell.CommandUpdate', name: 'Dell Command Update', publisher: 'Dell', category: 'Hardware', note: 'Firmware und Treiber' },
  { id: 'Lenovo.SystemUpdate', name: 'Lenovo System Update', publisher: 'Lenovo', category: 'Hardware', note: null },
  { id: 'HP.HPSupportAssistant', name: 'HP Support Assistant', publisher: 'HP', category: 'Hardware', note: null },
  { id: 'Logitech.Options', name: 'Logitech Options', publisher: 'Logitech', category: 'Hardware', note: null },
  { id: 'Fortinet.FortiClientVPN', name: 'FortiClient VPN', publisher: 'Fortinet', category: 'Netzwerk', note: null },
  { id: 'WireGuard.WireGuard', name: 'WireGuard', publisher: 'WireGuard', category: 'Netzwerk', note: null },
  { id: 'OpenVPNTechnologies.OpenVPNConnect', name: 'OpenVPN Connect', publisher: 'OpenVPN', category: 'Netzwerk', note: null },
  { id: 'Devolutions.UnigetUI', name: 'UniGetUI', publisher: 'Marti Climent', category: 'Werkzeuge', note: 'winget-Oberflaeche' },
  { id: 'LibreOffice.LibreOffice', name: 'LibreOffice', publisher: 'The Document Foundation', category: 'Office', note: null },
  { id: 'Mozilla.Thunderbird', name: 'Mozilla Thunderbird', publisher: 'Mozilla', category: 'Kommunikation', note: null },
  { id: 'GIMP.GIMP', name: 'GIMP', publisher: 'GIMP', category: 'Medien', note: null },
  { id: 'IrfanSkiljan.IrfanView', name: 'IrfanView', publisher: 'Irfan Skiljan', category: 'Medien', note: null },
  { id: 'PDFsam.PDFsam', name: 'PDFsam Basic', publisher: 'PDFsam', category: 'Dokumente', note: null },
  { id: 'Rufus.Rufus', name: 'Rufus', publisher: 'Akeo', category: 'Werkzeuge', note: 'portable Variante ausgeschlossen' },
];
