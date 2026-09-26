/**
 * Tests fuer den winget-Katalog: Pfade, Versionen, Installerwahl, Aufloesung ueber GitHub (gemockt)
 */

import { describe, it, expect, vi } from 'vitest';
import { WingetClient, WingetError, WINGET_BASE_SET, compareVersions, isStoreProductId, isWingetId, manifestFolder, newestVersion, selectInstaller } from '../src/apps/winget.js';

const NOW = new Date('2026-09-26T00:00:00Z');

const installerYaml = `PackageIdentifier: 7zip.7zip
PackageVersion: 24.08
InstallerType: wix
Scope: machine
Installers:
- Architecture: x86
  InstallerUrl: https://www.7-zip.org/a/7z2408.msi
  InstallerSha256: ${'B'.repeat(64)}
- Architecture: x64
  InstallerUrl: https://www.7-zip.org/a/7z2408-x64.msi
  InstallerSha256: ${'A'.repeat(64)}
  ProductCode: '{23170F69-40C1-2702-2408-000001000000}'
  AppsAndFeaturesEntries:
  - DisplayName: 7-Zip 24.08 (x64 edition)
- Architecture: x64
  InstallerType: exe
  InstallerUrl: https://www.7-zip.org/a/7z2408-x64.exe
  InstallerSha256: ${'C'.repeat(64)}
  InstallerSwitches:
    Silent: /S
- Architecture: arm64
  InstallerType: exe
  InstallerUrl: https://www.7-zip.org/a/7z2408-arm64.exe
  InstallerSha256: ${'D'.repeat(64)}
ManifestType: installer
ManifestVersion: 1.6.0
`;
const versionYaml = 'PackageIdentifier: 7zip.7zip\nPackageVersion: 24.08\nDefaultLocale: en-US\nManifestType: version\n';
const localeYaml = 'Publisher: Igor Pavlov\nPackageName: 7-Zip\nShortDescription: Free and open source file archiver\nPackageUrl: https://www.7-zip.org/\nLicense: LGPL-2.1\n';

function fetchMock(status = 200) {
  return vi.fn(async (url: string) => {
    if (url.includes('/contents/manifests/7/7zip/7zip')) return { ok: true, status: 200, text: async () => '', json: async () => [{ name: '23.01', type: 'dir' }, { name: '24.08', type: 'dir' }, { name: '9.20', type: 'dir' }, { name: '.validation', type: 'dir' }] };
    if (url.includes('/contents/manifests/n/Nobody/Nothing')) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    if (url.includes('/contents/')) return { ok: status === 200, status, text: async () => '', json: async () => [] };
    if (url.endsWith('7zip.7zip.installer.yaml')) return { ok: true, status: 200, text: async () => installerYaml, json: async () => ({}) };
    if (url.endsWith('7zip.7zip.yaml')) return { ok: true, status: 200, text: async () => versionYaml, json: async () => ({}) };
    if (url.endsWith('7zip.7zip.locale.en-US.yaml')) return { ok: true, status: 200, text: async () => localeYaml, json: async () => ({}) };
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  });
}

describe('winget helpers', () => {
  it('validates ids, builds manifest paths and sorts versions', () => {
    expect(isWingetId('7zip.7zip')).toBe(true);
    expect(isWingetId('Microsoft.VCRedist.2015+.x64')).toBe(true);
    expect(isWingetId('9NBLGGH4NNS1')).toBe(false);
    expect(isStoreProductId('9NBLGGH4NNS1')).toBe(true);
    expect(manifestFolder('Microsoft.VisualStudioCode.Insiders')).toBe('manifests/m/Microsoft/VisualStudioCode/Insiders');
    expect(newestVersion(['9.20', '24.08', '23.01', '24.08.1'])).toBe('24.08.1');
    expect(compareVersions('1.2', '1.10')).toBeLessThan(0);
  });

  it('prefers x64 machine MSI installers and skips unsupported ones', () => {
    const manifest = { PackageIdentifier: 'x', PackageVersion: '1', Installers: [
      { Architecture: 'x64', InstallerType: 'msix', InstallerUrl: 'https://a/x.msix', InstallerSha256: 'a'.repeat(64) },
      { Architecture: 'x64', InstallerType: 'exe', Scope: 'user', InstallerUrl: 'https://a/u.exe', InstallerSha256: 'b'.repeat(64) },
      { Architecture: 'x64', InstallerType: 'inno', Scope: 'machine', InstallerUrl: 'https://a/m.exe', InstallerSha256: 'c'.repeat(64) },
      { Architecture: 'x64', InstallerType: 'msi', InstallerUrl: 'https://a/m.msi', InstallerSha256: 'd'.repeat(64) },
    ] };
    const { installer, skipped } = selectInstaller(manifest, 'x64', NOW);
    expect(installer).toMatchObject({ installerType: 'inno', url: 'https://a/m.exe', silentSwitch: '/VERYSILENT /NORESTART /SP- /SUPPRESSMSGBOXES' });
    expect(skipped.some((s) => s.includes('msix'))).toBe(true);
    expect(skipped.some((s) => s.includes('Benutzer-Scope'))).toBe(true);
    expect(selectInstaller({ PackageIdentifier: 'x', PackageVersion: '1', Installers: [{ Architecture: 'x64', InstallerType: 'zip', InstallerUrl: 'https://a/x.zip', InstallerSha256: 'a'.repeat(64) }] }, 'x64', NOW).installer).toBeNull();
  });

  it('has a base set of well-formed ids', () => {
    expect(WINGET_BASE_SET.length).toBeGreaterThan(30);
    for (const e of WINGET_BASE_SET) expect(isWingetId(e.id)).toBe(true);
    expect(new Set(WINGET_BASE_SET.map((e) => e.id)).size).toBe(WINGET_BASE_SET.length);
  });
});

describe('WingetClient', () => {
  it('resolves the newest version with locale data and the best installer', async () => {
    const fetchImpl = fetchMock();
    const client = new WingetClient({ fetchImpl, githubToken: 'tok' }, () => NOW);
    const r = await client.resolve('7zip.7zip', 'latest', 'x64');
    expect(r).toMatchObject({ version: '24.08', publisher: 'Igor Pavlov', name: '7-Zip', license: 'LGPL-2.1', availableVersions: ['24.08', '23.01', '9.20'] });
    expect(r.installer).toMatchObject({ installerType: 'wix', url: 'https://www.7-zip.org/a/7z2408-x64.msi', sha256: 'a'.repeat(64), productCode: '{23170F69-40C1-2702-2408-000001000000}', displayName: '7-Zip 24.08 (x64 edition)', fileName: '7z2408-x64.msi', scope: 'machine' });
    expect(r.skipped.length).toBeGreaterThan(0);
    const headers = (fetchImpl.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer tok');
    const arm = await client.resolve('7zip.7zip', '24.08', 'arm64');
    expect(arm.installer.installerType).toBe('exe');
  });

  it('reports missing packages, missing versions and rate limits', async () => {
    const client = new WingetClient({ fetchImpl: fetchMock() }, () => NOW);
    await expect(client.resolve('Nobody.Nothing', 'latest')).rejects.toMatchObject({ code: 'not-found' });
    await expect(client.resolve('7zip.7zip', '1.0')).rejects.toMatchObject({ code: 'not-found' });
    await expect(client.resolve('not an id', 'latest')).rejects.toBeInstanceOf(WingetError);
    const limited = new WingetClient({ fetchImpl: fetchMock(403) }, () => NOW);
    await expect(limited.listVersions('Google.Chrome')).rejects.toMatchObject({ code: 'rate-limited' });
  });
});
