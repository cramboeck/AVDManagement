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
    const winget = normalizeManifest({ vendor: 'Google', name: 'Chrome', version: 'latest', installerType: 'winget', wingetPackageIdentifier: 'Google.Chrome' });
    expect(() => buildPlanFor(winget, { fileName: 'x', sha256: 'x', sizeBytes: 1 }, 'ZSC', { buildId: 'b', packageId: 'p' })).toThrow(/nicht gebaut/);
  });

  it('maps a winget manifest to a winGetApp payload', () => {
    const m = normalizeManifest({ vendor: 'Google', name: 'Chrome', version: 'latest', installerType: 'winget', wingetPackageIdentifier: 'Google.Chrome' });
    expect(buildWinGetAppPayload(m)).toMatchObject({ '@odata.type': '#microsoft.graph.winGetApp', packageIdentifier: 'Google.Chrome', installExperience: { runAsAccount: 'system' } });
  });
});
