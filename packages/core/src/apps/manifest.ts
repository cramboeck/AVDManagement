/**
 * Paketmanifest: Pruefung und Abbildung auf Intune
 *
 * Install-, Deinstall- und Erkennungslogik entstehen aus einem Manifest.
 * Daraus werden das Graph-Objekt (win32LobApp oder winGetApp) und, fuer
 * PSADT-Pakete, der Erkennungsschluessel abgeleitet, den der Worker beim
 * Bauen in das Paket schreibt. Kein Parsen von Ordnernamen.
 */

import type { AppDetectionRule, AppManifest, PackageArchitecture, ReturnCodeType, StoredFile } from '@zerostress/types';

export const DEFAULT_RETURN_CODES: { code: number; type: ReturnCodeType }[] = [
  { code: 0, type: 'success' },
  { code: 1707, type: 'success' },
  { code: 3010, type: 'softReboot' },
  { code: 1641, type: 'hardReboot' },
  { code: 1618, type: 'retry' },
];

export const WINDOWS_RELEASES = ['1607', '1703', '1709', '1803', '1809', '1903', '1909', '2004', '20H2', '21H1', '21H2', '22H2', '23H2', '24H2'];
const ARCHITECTURES: PackageArchitecture[] = ['x64', 'x86', 'arm64', 'neutral'];
const INSTALLER_TYPES: AppManifest['installerType'][] = ['msi', 'exe', 'psadt', 'intunewin', 'winget'];
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._+()-]{0,79}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$/;
const WINGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PRODUCT_CODE_PATTERN = /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;

export class ManifestError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
  }
}

/**
 * Manifest mit Standardwerten auffuellen und streng pruefen. Wirft ManifestError.
 */
export function normalizeManifest(input: Partial<AppManifest> & Record<string, unknown>): AppManifest {
  const problems: string[] = [];
  const str = (key: keyof AppManifest, pattern: RegExp | null, required: boolean): string => {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim()) {
      if (required) problems.push(`${key} fehlt`);
      return '';
    }
    const trimmed = value.trim();
    if (pattern && !pattern.test(trimmed)) problems.push(`${key} ungueltig: '${trimmed}'`);
    return trimmed;
  };

  const installerType = INSTALLER_TYPES.includes(input.installerType as AppManifest['installerType']) ? (input.installerType as AppManifest['installerType']) : null;
  if (!installerType) problems.push('installerType muss msi, exe, psadt, intunewin oder winget sein');

  const manifest: AppManifest = {
    schemaVersion: 1,
    vendor: str('vendor', NAME_PATTERN, true),
    name: str('name', NAME_PATTERN, true),
    version: str('version', VERSION_PATTERN, true),
    architecture: ARCHITECTURES.includes(input.architecture as PackageArchitecture) ? (input.architecture as PackageArchitecture) : 'x64',
    language: str('language', /^[A-Za-z-]{2,10}$/, false) || 'MUI',
    revision: str('revision', /^[0-9]{1,3}$/, false) || '01',
    installerType: installerType ?? 'exe',
    installerFileName: str('installerFileName', /^[^\\/:*?"<>|]{1,200}$/, false) || null,
    installCommand: typeof input.installCommand === 'string' && input.installCommand.trim() ? input.installCommand.trim() : null,
    uninstallCommand: typeof input.uninstallCommand === 'string' && input.uninstallCommand.trim() ? input.uninstallCommand.trim() : null,
    msiProductCode: str('msiProductCode', PRODUCT_CODE_PATTERN, false) || null,
    processesToClose: Array.isArray(input.processesToClose) ? input.processesToClose.filter((p): p is string => typeof p === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(p)) : [],
    detection: Array.isArray(input.detection) ? (input.detection as AppDetectionRule[]).map(normalizeRule).filter((r): r is AppDetectionRule => r !== null) : [],
    requirements: {
      minimumWindowsRelease: typeof input.requirements?.minimumWindowsRelease === 'string' && WINDOWS_RELEASES.includes(input.requirements.minimumWindowsRelease) ? input.requirements.minimumWindowsRelease : '1809',
      architecture: input.requirements?.architecture === 'x86' || input.requirements?.architecture === 'both' ? input.requirements.architecture : 'x64',
      minDiskMb: typeof input.requirements?.minDiskMb === 'number' && input.requirements.minDiskMb > 0 ? Math.round(input.requirements.minDiskMb) : null,
      minRamMb: typeof input.requirements?.minRamMb === 'number' && input.requirements.minRamMb > 0 ? Math.round(input.requirements.minRamMb) : null,
    },
    returnCodes:
      Array.isArray(input.returnCodes) && input.returnCodes.length > 0
        ? input.returnCodes.filter((r): r is { code: number; type: ReturnCodeType } => typeof r?.code === 'number' && ['success', 'softReboot', 'hardReboot', 'retry', 'failed'].includes(String(r.type)))
        : DEFAULT_RETURN_CODES,
    restartBehavior: ['basedOnReturnCode', 'allow', 'suppress', 'force'].includes(String(input.restartBehavior)) ? (input.restartBehavior as AppManifest['restartBehavior']) : 'basedOnReturnCode',
    installContext: input.installContext === 'user' ? 'user' : 'system',
    description: typeof input.description === 'string' && input.description.trim() ? input.description.trim().slice(0, 1000) : '',
    publisher: str('publisher', null, false) || str('vendor', null, false),
    informationUrl: urlOrNull(input.informationUrl),
    privacyUrl: urlOrNull(input.privacyUrl),
    owner: typeof input.owner === 'string' && input.owner.trim() ? input.owner.trim().slice(0, 100) : null,
    notes: typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 2000) : null,
    wingetPackageIdentifier: str('wingetPackageIdentifier', WINGET_ID_PATTERN, false) || null,
  };

  if (manifest.installerType === 'winget' && !manifest.wingetPackageIdentifier) problems.push('wingetPackageIdentifier fehlt (z. B. Google.Chrome)');
  if ((manifest.installerType === 'msi' || manifest.installerType === 'exe') && !manifest.installerFileName) problems.push('installerFileName fehlt');
  if (manifest.installerType === 'exe' && !manifest.installCommand) problems.push('installCommand fehlt fuer exe');
  if (manifest.installerType === 'intunewin' && manifest.detection.length === 0) problems.push('intunewin braucht mindestens eine Erkennungsregel');
  if (manifest.installerType === 'intunewin' && (!manifest.installCommand || !manifest.uninstallCommand)) problems.push('intunewin braucht installCommand und uninstallCommand');
  if (manifest.installerType === 'msi' && !manifest.msiProductCode && manifest.detection.length === 0) problems.push('msi braucht msiProductCode oder eine Erkennungsregel');
  if (!manifest.description) manifest.description = `${manifest.vendor} ${manifest.name} ${manifest.version}`;
  if (!manifest.returnCodes.some((r) => r.type === 'success')) problems.push('returnCodes brauchen mindestens einen Erfolgscode');

  if (problems.length > 0) throw new ManifestError(problems);
  return manifest;
}

function urlOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return /^https?:\/\/[^\s]+$/.test(value.trim()) ? value.trim() : null;
}

function normalizeRule(rule: AppDetectionRule): AppDetectionRule | null {
  if (!rule || typeof rule !== 'object') return null;
  switch (rule.type) {
    case 'registry':
      if (!rule.keyPath) return null;
      return {
        type: 'registry',
        keyPath: normalizeRegistryPath(rule.keyPath),
        valueName: rule.valueName || null,
        detectionType: ['exists', 'string', 'version', 'integer'].includes(rule.detectionType) ? rule.detectionType : 'exists',
        operator: rule.operator ?? null,
        value: rule.value ?? null,
        check32BitOn64System: rule.check32BitOn64System === true,
      };
    case 'msi':
      if (!rule.productCode || !PRODUCT_CODE_PATTERN.test(rule.productCode)) return null;
      return { type: 'msi', productCode: rule.productCode, productVersion: rule.productVersion ?? null, operator: rule.operator ?? null };
    case 'file':
      if (!rule.path || !rule.fileOrFolderName) return null;
      return {
        type: 'file',
        path: rule.path,
        fileOrFolderName: rule.fileOrFolderName,
        detectionType: ['exists', 'version', 'sizeInMB', 'modifiedDate', 'createdDate'].includes(rule.detectionType) ? rule.detectionType : 'exists',
        operator: rule.operator ?? null,
        value: rule.value ?? null,
        check32BitOn64System: rule.check32BitOn64System === true,
      };
    case 'script':
      if (!rule.script) return null;
      return { type: 'script', script: rule.script, enforceSignatureCheck: rule.enforceSignatureCheck === true, runAs32Bit: rule.runAs32Bit === true };
    default:
      return null;
  }
}

/**
 * Graph verlangt den vollen Stammnamen; HKLM:\\ oder HKLM\\ sind haeufige Kurzformen.
 */
export function normalizeRegistryPath(keyPath: string): string {
  return keyPath
    .trim()
    .replace(/^HKLM:?\\/i, 'HKEY_LOCAL_MACHINE\\')
    .replace(/^HKCU:?\\/i, 'HKEY_CURRENT_USER\\')
    .replace(/^HKEY_LOCAL_MACHINE:\\/i, 'HKEY_LOCAL_MACHINE\\');
}

/**
 * Bezeichner eines Pakets: gleich im Registry-Schluessel, im Paketordner und im Anzeigenamen.
 */
export function packageIdentifier(m: Pick<AppManifest, 'vendor' | 'name' | 'version' | 'language' | 'revision' | 'architecture'>): string {
  const clean = (v: string) => v.replace(/[^A-Za-z0-9.+-]/g, '');
  return `${clean(m.vendor)}-${clean(m.name)}-${clean(m.version)}-${clean(m.language)}-${clean(m.revision)}-${m.architecture}`;
}

export function detectionKeyPath(prefix: string, m: AppManifest): string {
  return `HKEY_LOCAL_MACHINE\\SOFTWARE\\${prefix}_IntuneAppInstall\\Apps\\${packageIdentifier(m)}`;
}

export function packageDisplayName(m: AppManifest): string {
  return `${m.vendor} ${m.name} ${m.version}`;
}

/**
 * Erkennungsregeln: das Manifest plus, bei PSADT, der Marker mit Installed = Y
 * (nicht nur "Schluessel existiert", sonst gilt eine Deinstallation als installiert).
 */
export function effectiveDetectionRules(m: AppManifest, prefix: string): AppDetectionRule[] {
  if (m.installerType === 'psadt') {
    return [
      { type: 'registry', keyPath: detectionKeyPath(prefix, m), valueName: 'Installed', detectionType: 'string', operator: 'equal', value: 'Y', check32BitOn64System: false },
      { type: 'registry', keyPath: detectionKeyPath(prefix, m), valueName: 'DisplayVersion', detectionType: 'string', operator: 'equal', value: m.version, check32BitOn64System: false },
    ];
  }
  if (m.installerType === 'msi' && m.detection.length === 0 && m.msiProductCode) {
    return [{ type: 'msi', productCode: m.msiProductCode, productVersion: m.version, operator: 'greaterThanOrEqual' }];
  }
  return m.detection;
}

function graphRule(rule: AppDetectionRule): Record<string, unknown> {
  switch (rule.type) {
    case 'registry':
      return {
        '@odata.type': '#microsoft.graph.win32LobAppRegistryDetection',
        check32BitOn64System: rule.check32BitOn64System,
        keyPath: rule.keyPath,
        valueName: rule.valueName,
        detectionType: rule.detectionType,
        operator: rule.detectionType === 'exists' ? 'notConfigured' : (rule.operator ?? 'equal'),
        detectionValue: rule.detectionType === 'exists' ? null : rule.value,
      };
    case 'msi':
      return {
        '@odata.type': '#microsoft.graph.win32LobAppProductCodeDetection',
        productCode: rule.productCode,
        productVersion: rule.productVersion,
        productVersionOperator: rule.productVersion ? (rule.operator ?? 'greaterThanOrEqual') : 'notConfigured',
      };
    case 'file':
      return {
        '@odata.type': '#microsoft.graph.win32LobAppFileSystemDetection',
        check32BitOn64System: rule.check32BitOn64System,
        path: rule.path,
        fileOrFolderName: rule.fileOrFolderName,
        detectionType: rule.detectionType,
        operator: rule.detectionType === 'exists' ? 'notConfigured' : (rule.operator ?? 'equal'),
        detectionValue: rule.detectionType === 'exists' ? null : rule.value,
      };
    case 'script':
      return {
        '@odata.type': '#microsoft.graph.win32LobAppPowerShellScriptDetection',
        enforceSignatureCheck: rule.enforceSignatureCheck,
        runAs32Bit: rule.runAs32Bit,
        scriptContent: Buffer.from(rule.script, 'utf8').toString('base64'),
      };
  }
}

export function installCommandLine(m: AppManifest): string {
  if (m.installCommand) return m.installCommand;
  if (m.installerType === 'psadt') return 'powershell.exe -ExecutionPolicy Bypass -NoProfile -File "Invoke-AppDeployToolkit.ps1" -DeploymentType Install -DeployMode Silent';
  if (m.installerType === 'msi') return `msiexec.exe /i "${m.installerFileName}" /qn /norestart`;
  return m.installerFileName ? `"${m.installerFileName}" /S` : '';
}

export function uninstallCommandLine(m: AppManifest): string {
  if (m.uninstallCommand) return m.uninstallCommand;
  if (m.installerType === 'psadt') return 'powershell.exe -ExecutionPolicy Bypass -NoProfile -File "Invoke-AppDeployToolkit.ps1" -DeploymentType Uninstall -DeployMode Silent';
  if (m.installerType === 'msi' && m.msiProductCode) return `msiexec.exe /x ${m.msiProductCode} /qn /norestart`;
  return installCommandLine(m);
}

/**
 * Graph-Objekt fuer eine Win32-App (ohne Inhalt; der kommt ueber die Content-Version).
 */
export function buildWin32LobAppPayload(m: AppManifest, artifact: Pick<StoredFile, 'fileName'>, prefix: string): Record<string, unknown> {
  const setupFilePath = m.installerType === 'psadt' ? 'Invoke-AppDeployToolkit.ps1' : (m.installerFileName ?? artifact.fileName);
  return {
    '@odata.type': '#microsoft.graph.win32LobApp',
    displayName: packageDisplayName(m),
    description: m.description,
    publisher: m.publisher,
    owner: m.owner,
    notes: m.notes ? `${m.notes}\nZeroStress Cockpit: ${packageIdentifier(m)}` : `ZeroStress Cockpit: ${packageIdentifier(m)}`,
    informationUrl: m.informationUrl,
    privacyInformationUrl: m.privacyUrl,
    isFeatured: false,
    fileName: artifact.fileName,
    setupFilePath,
    installCommandLine: installCommandLine(m),
    uninstallCommandLine: uninstallCommandLine(m),
    applicableArchitectures: m.requirements.architecture === 'both' ? 'x86,x64' : m.requirements.architecture,
    minimumSupportedWindowsRelease: m.requirements.minimumWindowsRelease ?? '1809',
    minimumFreeDiskSpaceInMB: m.requirements.minDiskMb,
    minimumMemoryInMB: m.requirements.minRamMb,
    installExperience: { runAsAccount: m.installContext, deviceRestartBehavior: m.restartBehavior },
    detectionRules: effectiveDetectionRules(m, prefix).map(graphRule),
    returnCodes: m.returnCodes.map((r) => ({ returnCode: r.code, type: r.type })),
    roleScopeTagIds: ['0'],
  };
}

/**
 * Graph-Objekt fuer eine winget-App aus dem Microsoft-Store-Katalog (kein Upload).
 */
export function buildWinGetAppPayload(m: AppManifest): Record<string, unknown> {
  return {
    '@odata.type': '#microsoft.graph.winGetApp',
    displayName: packageDisplayName(m),
    description: m.description,
    publisher: m.publisher,
    packageIdentifier: m.wingetPackageIdentifier,
    installExperience: { runAsAccount: m.installContext },
    notes: `ZeroStress Cockpit: ${packageIdentifier(m)}`,
    roleScopeTagIds: ['0'],
  };
}
