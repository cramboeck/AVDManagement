/**
 * Tests fuer Manifestpruefung und Intune-Abbildung
 */

import { describe, it, expect } from 'vitest';
import { normalizeManifest, ManifestError, buildWin32LobAppPayload, buildWinGetAppPayload, buildPlanFor, detectionKeyPath, effectiveDetectionRules, normalizeRegistryPath, packageIdentifier } from '../src/apps/manifest.js';

const base = { vendor: 'Google', name: 'Chrome', version: '129.0.6668.59', installerType: 'msi', installerFileName: 'googlechromestandaloneenterprise64.msi', msiProductCode: '{12345678-1234-1234-1234-123456789012}' };

describe('normalizeManifest', () => {
  it('fills defaults and validates', () => {
    const m = normalizeManifest(base);
    expect(m).toMatchObject({ architecture: 'x64', language: 'MUI', revision: '01', installContext: 'system', restartBehavior: 'basedOnReturnCode', publisher: 'Google' });
    expect(m.returnCodes.length).toBe(5);
    expect(m.requirements.minimumWindowsRelease).toBe('1809');
  });

  it('rejects incomplete manifests with all problems at once', () => {
    expect(() => normalizeManifest({ vendor: 'X', name: 'Y', version: '1', installerType: 'exe' })).toThrow(ManifestError);
    try {
      normalizeManifest({ vendor: 'X', name: 'Y', version: '1', installerType: 'exe' });
    } catch (e) {
      expect((e as ManifestError).problems).toEqual(expect.arrayContaining(['installerFileName fehlt', 'installCommand fehlt fuer exe']));
    }
    expect(() => normalizeManifest({ ...base, installerType: 'winget' })).toThrow(/wingetPackageIdentifier/);
    expect(() => normalizeManifest({ ...base, installerType: 'store', wingetPackageIdentifier: 'Google.Chrome' })).toThrow(/Store-Produkt-Id/);
    expect(() => normalizeManifest({ ...base, installerType: 'winget', wingetPackageIdentifier: '7zip.7zip' })).toThrow(/sourceInstaller fehlt/);
    expect(() => normalizeManifest({ ...base, name: 'bad;name' })).toThrow(/name ungueltig/);
  });

  it('normalises registry paths and builds the PSADT marker rules', () => {
    expect(normalizeRegistryPath('HKLM:\\SOFTWARE\\X')).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\X');
    expect(normalizeRegistryPath('HKLM\\SOFTWARE\\X')).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\X');
    const m = normalizeManifest({ vendor: 'Contoso', name: 'Tool', version: '2.0', installerType: 'psadt', installerFileName: 'setup.exe' });
    expect(packageIdentifier(m)).toBe('Contoso-Tool-2.0-MUI-01-x64');
    expect(detectionKeyPath('ZSC', m)).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\ZSC_IntuneAppInstall\\Apps\\Contoso-Tool-2.0-MUI-01-x64');
    const rules = effectiveDetectionRules(m, 'ZSC');
    expect(rules[0]).toMatchObject({ type: 'registry', valueName: 'Installed', value: 'Y' });
  });

  it('maps to a win32LobApp payload with full registry key and command lines', () => {
    const m = normalizeManifest(base);
    const payload = buildWin32LobAppPayload(m, { fileName: 'chrome.intunewin' }, 'ZSC');
    expect(payload).toMatchObject({
      '@odata.type': '#microsoft.graph.win32LobApp',
      displayName: 'Google Chrome 129.0.6668.59',
      setupFilePath: 'googlechromestandaloneenterprise64.msi',
      installCommandLine: 'msiexec.exe /i "googlechromestandaloneenterprise64.msi" /qn /norestart',
      uninstallCommandLine: 'msiexec.exe /x {12345678-1234-1234-1234-123456789012} /qn /norestart',
      applicableArchitectures: 'x64',
      minimumSupportedWindowsRelease: '1809',
    });
    const rules = payload.detectionRules as Record<string, unknown>[];
    expect(rules[0]).toMatchObject({ '@odata.type': '#microsoft.graph.win32LobAppProductCodeDetection', productCode: base.msiProductCode });
    const psadt = normalizeManifest({ vendor: 'Contoso', name: 'Tool', version: '2.0', installerType: 'psadt', installerFileName: 'setup.exe' });
    const p2 = buildWin32LobAppPayload(psadt, { fileName: 'tool.intunewin' }, 'ZSC');
    expect((p2.detectionRules as Record<string, unknown>[])[0]).toMatchObject({ keyPath: expect.stringMatching(/^HKEY_LOCAL_MACHINE\\SOFTWARE\\ZSC_IntuneAppInstall/), detectionType: 'string', detectionValue: 'Y' });
    expect(p2.setupFilePath).toBe('Invoke-AppDeployToolkit.ps1');
  });

  it('keeps the PSADT wrapper as Intune command line even when installer arguments are set', () => {
    const psadt = normalizeManifest({ vendor: 'Contoso', name: 'Tool', version: '2.0', installerType: 'psadt', installerFileName: 'setup.exe', installCommand: '/S', uninstallCommand: '"C:\\Program Files\\Tool\\unins.exe" /S' });
    const payload = buildWin32LobAppPayload(psadt, { fileName: 'tool.intunewin' }, 'ZSC');
    expect(payload.installCommandLine).toMatch(/^powershell\.exe .*-DeploymentType Install/);
    expect(payload.uninstallCommandLine).toMatch(/-DeploymentType Uninstall/);
  });

  it('derives a build plan for the worker', () => {
    const psadt = normalizeManifest({ vendor: 'Contoso', name: 'Tool', version: '2.0', installerType: 'psadt', installerFileName: 'setup.exe', installCommand: '/S', processesToClose: ['tool'] });
    const plan = buildPlanFor(psadt, { fileName: 'setup.exe', sha256: 'abc', sizeBytes: 10 }, 'ZSC', { buildId: 'b', packageId: 'p' });
    expect(plan).toMatchObject({
      wrapper: 'psadt',
      setupFile: 'Invoke-AppDeployToolkit.ps1',
      markerKeyPath: 'HKLM:\\SOFTWARE\\ZSC_IntuneAppInstall\\Apps\\Contoso-Tool-2.0-MUI-01-x64',
      installerArguments: '/S',
      processesToClose: ['tool'],
      artifactFileName: 'Contoso-Tool-2.0-MUI-01-x64.intunewin',
    });
    const msi = normalizeManifest(base);
    expect(buildPlanFor(msi, { fileName: base.installerFileName, sha256: 'x', sizeBytes: 1 }, 'ZSC', { buildId: 'b', packageId: 'p' })).toMatchObject({ wrapper: 'plain', setupFile: base.installerFileName, markerKeyPath: null });
    const store = normalizeManifest({ vendor: 'Google', name: 'Chrome', version: 'latest', installerType: 'store', wingetPackageIdentifier: '9NBLGGH4NNS1' });
    expect(() => buildPlanFor(store, { fileName: 'x', sha256: 'x', sizeBytes: 1 }, 'ZSC', { buildId: 'b', packageId: 'p' })).toThrow(/nicht gebaut/);
  });

  it('maps a store manifest to a winGetApp payload', () => {
    const m = normalizeManifest({ vendor: 'Google', name: 'Chrome', version: 'latest', installerType: 'store', wingetPackageIdentifier: '9NBLGGH4NNS1' });
    expect(buildWinGetAppPayload(m)).toMatchObject({ '@odata.type': '#microsoft.graph.winGetApp', packageIdentifier: '9NBLGGH4NNS1', installExperience: { runAsAccount: 'system' } });
  });

  it('builds a wrapper plan for a winget source package with download URL and uninstall hints', () => {
    const source = { packageIdentifier: '7zip.7zip', version: '24.08', url: 'https://www.7-zip.org/a/7z2408-x64.msi', sha256: 'a'.repeat(64), installerType: 'wix', architecture: 'x64', scope: 'machine', silentSwitch: null, productCode: '{23170F69-40C1-2702-2408-000001000000}', displayName: '7-Zip 24.08 (x64 edition)', fileName: '7z2408-x64.msi', resolvedAt: '2026-09-26T00:00:00Z' };
    const m = normalizeManifest({ vendor: 'Igor Pavlov', name: '7-Zip', version: '24.08', installerType: 'winget', wingetPackageIdentifier: '7zip.7zip', wingetVersion: 'latest', sourceInstaller: source });
    expect(m.installerFileName).toBe('7z2408-x64.msi');
    const payload = buildWin32LobAppPayload(m, { fileName: 'x.intunewin' }, 'ZSC');
    expect(payload.setupFilePath).toBe('Invoke-AppDeployToolkit.ps1');
    expect((payload.detectionRules as Record<string, unknown>[])[0]).toMatchObject({ valueName: 'Installed' });
    const plan = buildPlanFor(m, null, 'ZSC', { buildId: 'b', packageId: 'p' });
    expect(plan).toMatchObject({ wrapper: 'psadt', downloadUrl: source.url, installer: { fileName: '7z2408-x64.msi', sha256: source.sha256 }, installerArguments: '', uninstallProductCode: source.productCode, uninstallDisplayName: '7-Zip 24.08 (x64 edition)' });
    const exe = normalizeManifest({ vendor: 'N', name: 'Notepad++', version: '8.7', installerType: 'winget', wingetPackageIdentifier: 'Notepad++.Notepad++', sourceInstaller: { ...source, packageIdentifier: 'Notepad++.Notepad++', installerType: 'nullsoft', silentSwitch: '/S', productCode: null, fileName: 'npp.exe' } });
    expect(buildPlanFor(exe, null, 'ZSC', { buildId: 'b', packageId: 'p' })).toMatchObject({ installerArguments: '/S', uninstallArguments: '/S', uninstallProductCode: null });
  });
});
