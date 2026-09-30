'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { ScriptResultView } from '@/components/devices/scripts-tab';
import type { Device, Job, ScriptRunResult } from '@zerostress/types';

export interface AppUninstallTarget {
  displayName: string;
  version: string | null;
  publisher: string | null;
  kind: 'registry' | 'appx';
}

const inputClass = 'w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * Deinstallation ohne winget: Registry-Eintrag oder Appx-Paket. Vor dem Job
 * lassen sich Argumente fuer den Deinstaller angeben; das braucht es nur,
 * wenn ein frueherer Lauf "kein stiller Schalter bekannt" gemeldet hat.
 */
export function AppUninstallDialog({ tenantId, device, target, onClose, onCompleted }: { tenantId: string; device: Device; target: AppUninstallTarget; onClose: () => void; onCompleted: () => void }) {
  const managedDeviceId = device.intune?.managedDeviceId;
  const [extraArgs, setExtraArgs] = useState('');
  const [started, setStarted] = useState(false);
  const label = target.version ? `${target.displayName} ${target.version}` : target.displayName;

  if (!started) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby="app-uninstall-title">
          <div className="border-b px-4 py-3">
            <h2 id="app-uninstall-title" className="font-medium">
              Deinstallieren: {label}
            </h2>
          </div>
          <div className="space-y-3 p-4 text-sm">
            <p className="text-muted-foreground">
              {target.kind === 'appx'
                ? `Store-/MSIX-Paket auf ${device.name} fuer alle Benutzer entfernen.`
                : `Auf ${device.name} ueber den Registry-Eintrag mit genau diesem Namen. Das Skript kennt die stillen Schalter fuer MSI, Inno Setup, NSIS und InstallShield; unbekannte Deinstaller startet es nicht ohne Argumente.`}
            </p>
            {target.kind === 'registry' && (
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">Zusaetzliche Argumente fuer den Deinstaller (nur wenn ein Lauf sie verlangt hat, z. B. /S oder /quiet)</span>
                <input className={inputClass} value={extraArgs} maxLength={200} onChange={(e) => setExtraArgs(e.target.value)} placeholder="leer lassen fuer automatische Erkennung" autoFocus />
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-4 py-3">
            <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-accent">
              Abbrechen
            </button>
            <button onClick={() => setStarted(true)} className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90">
              Vorschau erstellen
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <JobActionDialog
      title={`Deinstallieren: ${label}`}
      description={`Auf ${device.name} als SYSTEM, ohne Rueckfrage an angemeldete Benutzer.`}
      confirmLabel="Deinstallieren"
      tone="destructive"
      createJob={() =>
        api.post<Job>(`/tenants/${tenantId}/jobs/app-uninstall`, {
          managedDeviceId,
          deviceName: device.name,
          displayName: target.displayName,
          version: target.version,
          publisher: target.publisher,
          kind: target.kind,
          extraArgs: extraArgs.trim() || null,
        })
      }
      renderResult={(job) => <ScriptResultView result={job.result as unknown as ScriptRunResult | null} error={job.error} />}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}
