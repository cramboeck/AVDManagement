'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ErrorBanner } from '@/components/ui/error-state';
import { LoadingSpinner } from '@/components/ui/loading';
import { installerTypeLabels } from '@/components/apps/package-badges';
import { WingetSourcePicker } from '@/components/apps/winget-source-picker';
import type { AppDetectionRule, AppManifest, PackageInstallerType } from '@zerostress/types';

export type ManifestDraft = Partial<AppManifest> & { installerType: PackageInstallerType };

const emptyDraft: ManifestDraft = {
  installerType: 'psadt',
  vendor: '',
  name: '',
  version: '',
  architecture: 'x64',
  language: 'MUI',
  revision: '01',
  installerFileName: '',
  installCommand: '',
  uninstallCommand: '',
  msiProductCode: '',
  processesToClose: [],
  detection: [],
  installContext: 'system',
  restartBehavior: 'basedOnReturnCode',
  description: '',
  publisher: '',
  wingetPackageIdentifier: '',
  requirements: { minimumWindowsRelease: '1809', architecture: 'x64', minDiskMb: null, minRamMb: null },
};

const typeHints: Record<PackageInstallerType, string> = {
  psadt: 'Installer hochladen; der Build-Worker erzeugt den PSADT-Wrapper, die Erkennung und das .intunewin. Empfohlen fuer EXE mit Konfiguration.',
  msi: 'Installer hochladen; der Worker packt es zum .intunewin. Erkennung ueber den Produktcode.',
  exe: 'Installer hochladen; Kommandozeile fuer stilles Setup und Erkennungsregel angeben.',
  intunewin: 'Fertiges .intunewin hochladen (z. B. aus PackageFactory); Kommandozeilen und Erkennung wie im Paket.',
  winget: 'Installer aus dem winget-Community-Katalog: Id waehlen, aus dem Katalog laden, der Worker baut daraus ein Win32-Paket mit PSADT-Wrapper und eigener Erkennung. Versionen bleiben unter Kontrolle.',
  store: 'Sonderfall Microsoft Store: Intune installiert die App selbst aus dem Store. Nur fuer Store-Produkt-Ids (12 Zeichen), nicht fuer Community-Pakete.',
};

interface PackageFormProps {
  initial?: AppManifest;
  submitLabel: string;
  pending: boolean;
  error: Error | null;
  problems?: string[];
  lockIdentity?: boolean;
  onSubmit: (draft: ManifestDraft) => void;
  onCancel: () => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';

export function PackageForm({ initial, submitLabel, pending, error, problems, lockIdentity = false, onSubmit, onCancel }: PackageFormProps) {
  const [draft, setDraft] = useState<ManifestDraft>(initial ? { ...initial } : emptyDraft);
  const [regKey, setRegKey] = useState(initial?.detection.find((d) => d.type === 'registry')?.type === 'registry' ? ((initial.detection.find((d) => d.type === 'registry') as { keyPath: string }).keyPath ?? '') : '');
  const [filePath, setFilePath] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const set = <K extends keyof ManifestDraft>(key: K, value: ManifestDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const t = draft.installerType;

  const submit = () => {
    const detection: AppDetectionRule[] = [...(draft.detection ?? [])].filter((d) => d.type !== 'registry' && d.type !== 'file');
    if (regKey.trim()) detection.push({ type: 'registry', keyPath: regKey.trim(), valueName: null, detectionType: 'exists', operator: null, value: null, check32BitOn64System: false });
    if (filePath.trim()) {
      const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
      detection.push({ type: 'file', path: filePath.slice(0, idx), fileOrFolderName: filePath.slice(idx + 1), detectionType: 'exists', operator: null, value: null, check32BitOn64System: false });
    }
    onSubmit({ ...draft, detection });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="package-form-title">
        <div className="border-b px-4 py-3">
          <h2 id="package-form-title" className="font-medium">
            {initial ? 'Paket bearbeiten' : 'Neues Paket'}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Ein Manifest, aus dem Installation, Deinstallation und Erkennung entstehen. Nichts wird erst im Intune-Portal nachgepflegt.</p>
        </div>
        <div className="space-y-4 p-4">
          <ErrorBanner error={error} onDismiss={() => undefined} />
          {problems && problems.length > 0 && (
            <ul className="list-disc rounded-md border border-destructive/30 bg-destructive/5 px-6 py-2 text-sm text-destructive">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <fieldset>
            <legend className="mb-1 text-sm font-medium">Pakettyp</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(installerTypeLabels) as PackageInstallerType[]).map((k) => (
                <button key={k} type="button" disabled={lockIdentity} onClick={() => set('installerType', k)} aria-pressed={t === k} className={clsx('rounded-full border px-3 py-1 text-xs', t === k ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent', lockIdentity && 'opacity-60')}>
                  {installerTypeLabels[k]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{typeHints[t]}</p>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hersteller">
              <input className={inputClass} disabled={lockIdentity} value={draft.vendor ?? ''} onChange={(e) => set('vendor', e.target.value)} placeholder="Google" />
            </Field>
            <Field label="Name">
              <input className={inputClass} disabled={lockIdentity} value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="Chrome" />
            </Field>
            <Field label="Version" hint={t === 'store' ? 'Bei Store-Apps nur informativ, z. B. latest' : t === 'winget' ? 'Kommt aus der Katalogaufloesung unten' : undefined}>
              <input className={inputClass} disabled={lockIdentity || t === 'winget'} value={draft.version ?? ''} onChange={(e) => set('version', e.target.value)} placeholder="129.0.6668.59" />
            </Field>
            <Field label="Architektur">
              <select className={inputClass} disabled={lockIdentity} value={draft.architecture ?? 'x64'} onChange={(e) => set('architecture', e.target.value as AppManifest['architecture'])}>
                <option value="x64">x64</option>
                <option value="x86">x86</option>
                <option value="arm64">arm64</option>
                <option value="neutral">neutral</option>
              </select>
            </Field>
          </div>

          {t === 'store' ? (
            <Field label="Store-Produkt-Id" hint="Aus der Store-URL (apps.microsoft.com/detail/<Id>), z. B. 9NBLGGH4NNS1. Community-Ids wie 7zip.7zip gehoeren zum Typ winget-Katalog.">
              <input className={inputClass} value={draft.wingetPackageIdentifier ?? ''} onChange={(e) => set('wingetPackageIdentifier', e.target.value.toUpperCase())} placeholder="9NBLGGH4NNS1" />
            </Field>
          ) : t === 'winget' ? (
            <>
              <WingetSourcePicker draft={draft} locked={lockIdentity} onApply={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Kontext">
                  <select className={inputClass} value={draft.installContext ?? 'system'} onChange={(e) => set('installContext', e.target.value as AppManifest['installContext'])}>
                    <option value="system">System</option>
                    <option value="user">Benutzer</option>
                  </select>
                </Field>
                <Field label="Neustart">
                  <select className={inputClass} value={draft.restartBehavior ?? 'basedOnReturnCode'} onChange={(e) => set('restartBehavior', e.target.value as AppManifest['restartBehavior'])}>
                    <option value="basedOnReturnCode">Nach Rueckgabecode</option>
                    <option value="suppress">Unterdruecken</option>
                    <option value="allow">Erlauben</option>
                    <option value="force">Erzwingen</option>
                  </select>
                </Field>
                <Field label="Prozesse schliessen" hint="Kommagetrennt, ohne .exe">
                  <input className={inputClass} value={(draft.processesToClose ?? []).join(', ')} onChange={(e) => set('processesToClose', e.target.value.split(',').map((p) => p.trim()).filter(Boolean))} placeholder="7zFM" />
                </Field>
              </div>
              <Field label="Deinstallationsbefehl (optional)" hint="Leer: MSI ueber Produktcode, sonst der Eintrag unter Apps und Features aus dem Katalog">
                <input className={inputClass} value={draft.uninstallCommand ?? ''} onChange={(e) => set('uninstallCommand', e.target.value)} placeholder='"C:\\Program Files\\App\\uninstall.exe" /S' />
              </Field>
            </>
          ) : (
            <>
              {t !== 'intunewin' && (
                <Field label="Installer-Dateiname" hint="Wird beim Upload automatisch gesetzt; hier nur, wenn die Kommandozeile ihn vorher braucht">
                  <input className={inputClass} value={draft.installerFileName ?? ''} onChange={(e) => set('installerFileName', e.target.value)} placeholder="setup.exe" />
                </Field>
              )}
              {t === 'msi' && (
                <Field label="MSI-Produktcode" hint="Aus dem MSI (Orca oder msiexec /lv); dient der Erkennung">
                  <input className={inputClass} value={draft.msiProductCode ?? ''} onChange={(e) => set('msiProductCode', e.target.value)} placeholder="{12345678-1234-1234-1234-123456789012}" />
                </Field>
              )}
              {(t === 'exe' || t === 'intunewin' || t === 'psadt') && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t === 'psadt' ? 'Stille Installationsparameter' : 'Installationsbefehl'} hint={t === 'psadt' ? 'Parameter des Installers, z. B. /S oder /quiet; der Wrapper ruft den Installer damit auf' : 'Vollstaendige Kommandozeile'}>
                    <input className={inputClass} value={draft.installCommand ?? ''} onChange={(e) => set('installCommand', e.target.value)} placeholder={t === 'psadt' ? '/S' : 'setup.exe /S'} />
                  </Field>
                  <Field label={t === 'psadt' ? 'Deinstallationsbefehl (optional)' : 'Deinstallationsbefehl'}>
                    <input className={inputClass} value={draft.uninstallCommand ?? ''} onChange={(e) => set('uninstallCommand', e.target.value)} placeholder='"C:\Program Files\App\uninstall.exe" /S' />
                  </Field>
                </div>
              )}
              {t !== 'psadt' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Erkennung: Registry-Schluessel" hint="Existenz, z. B. HKLM\SOFTWARE\Vendor\App">
                    <input className={inputClass} value={regKey} onChange={(e) => setRegKey(e.target.value)} placeholder="HKLM\SOFTWARE\Google\Chrome" />
                  </Field>
                  <Field label="Erkennung: Datei" hint="Vollstaendiger Pfad zur Datei">
                    <input className={inputClass} value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="C:\Program Files\Google\Chrome\Application\chrome.exe" />
                  </Field>
                </div>
              )}
              {t === 'psadt' && <p className="text-xs text-muted-foreground">Erkennung: der Worker schreibt beim Installieren einen Registry-Marker mit Installed = Y und Version; Intune prueft genau diesen Marker.</p>}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Kontext">
                  <select className={inputClass} value={draft.installContext ?? 'system'} onChange={(e) => set('installContext', e.target.value as AppManifest['installContext'])}>
                    <option value="system">System</option>
                    <option value="user">Benutzer</option>
                  </select>
                </Field>
                <Field label="Neustart">
                  <select className={inputClass} value={draft.restartBehavior ?? 'basedOnReturnCode'} onChange={(e) => set('restartBehavior', e.target.value as AppManifest['restartBehavior'])}>
                    <option value="basedOnReturnCode">Nach Rueckgabecode</option>
                    <option value="suppress">Unterdruecken</option>
                    <option value="allow">Erlauben</option>
                    <option value="force">Erzwingen</option>
                  </select>
                </Field>
                <Field label="Prozesse schliessen" hint="Kommagetrennt, ohne .exe">
                  <input className={inputClass} value={(draft.processesToClose ?? []).join(', ')} onChange={(e) => set('processesToClose', e.target.value.split(',').map((p) => p.trim()).filter(Boolean))} placeholder="chrome" />
                </Field>
              </div>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Herausgeber (Intune)">
              <input className={inputClass} value={draft.publisher ?? ''} onChange={(e) => set('publisher', e.target.value)} placeholder="wie Hersteller" />
            </Field>
            <Field label="Beschreibung">
              <input className={inputClass} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Sichtbar im Unternehmensportal" />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button type="button" onClick={submit} disabled={pending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {pending && <LoadingSpinner size="sm" className="text-primary-foreground" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
