'use client';

import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { ScriptResultView } from '@/components/devices/scripts-tab';
import type { Device, Job, ScriptRunResult } from '@zerostress/types';

export interface WingetTarget {
  packageId: string;
  mode: 'install' | 'upgrade' | 'uninstall';
  displayName: string | null;
  installedVersion: string | null;
  availableVersion: string | null;
  version?: string | null;
}

/**
 * winget install/upgrade auf einem Geraet: Vorschau und Ausfuehrung
 * uebernimmt der Job device.winget-install.
 */
export function WingetInstallDialog({ tenantId, device, target, onClose, onCompleted }: { tenantId: string; device: Device; target: WingetTarget; onClose: () => void; onCompleted: () => void }) {
  const managedDeviceId = device.intune?.managedDeviceId;
  const label = target.displayName ? `${target.displayName} (${target.packageId})` : target.packageId;
  return (
    <JobActionDialog
      title={target.mode === 'upgrade' ? `Update installieren: ${label}` : target.mode === 'uninstall' ? `Deinstallieren: ${label}` : `Installieren: ${label}`}
      description={target.mode === 'uninstall' ? `Auf ${device.name} per winget im Maschinenkontext entfernen. Ueber Intune zugewiesene Software kommt beim naechsten Abgleich zurueck.` : `Auf ${device.name} per winget im Maschinenkontext. Nur dieses Geraet; fuer viele Geraete das Paket im Katalog ausrollen.`}
      confirmLabel={target.mode === 'upgrade' ? 'Update starten' : target.mode === 'uninstall' ? 'Deinstallieren' : 'Installation starten'}
      tone={target.mode === 'uninstall' ? 'destructive' : 'default'}
      createJob={() =>
        api.post<Job>(`/tenants/${tenantId}/jobs/winget-install`, {
          managedDeviceId,
          deviceName: device.name,
          packageId: target.packageId,
          mode: target.mode,
          version: target.version ?? null,
          displayName: target.displayName,
          installedVersion: target.installedVersion,
          availableVersion: target.availableVersion,
        })
      }
      renderResult={(job) => <ScriptResultView result={job.result as unknown as ScriptRunResult | null} error={job.error} />}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}
