'use client';

import Link from 'next/link';
import type { CapabilityUnavailableReason } from '@zerostress/types';

interface CapabilityNoticeProps {
  what: string;
  reason: CapabilityUnavailableReason;
  missingPermission: string | null;
  detail: string | null;
}

// Fehlende Lizenz oder Berechtigung ist ein erwarteter Zustand mit naechstem Schritt
export function CapabilityNotice({ what, reason, missingPermission, detail }: CapabilityNoticeProps) {
  const isPremium = reason === 'premium-required';

  return (
    <div className="rounded-lg border border-dashed p-5" role="status">
      <p className="font-medium">
        {isPremium ? 'Entra ID P1 erforderlich' : `Berechtigung fehlt: ${missingPermission ?? 'unbekannt'}`}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isPremium ? (
          <>
            Microsoft stellt {what} nur fuer Tenants mit Entra ID P1 oder P2 bereit (enthalten z. B. in
            Microsoft 365 Business Premium, E3 und E5). Sobald der Tenant lizenziert ist, erscheinen die
            Daten hier ohne weitere Einrichtung.
          </>
        ) : (
          <>
            Fuer {what} braucht die App-Registrierung die Anwendungsberechtigung{' '}
            <span className="font-mono">{missingPermission}</span>. Berechtigung im Entra-Portal
            hinzufuegen, danach unter{' '}
            <Link href="/tenants" className="text-primary underline-offset-2 hover:underline">
              Tenants
            </Link>{' '}
            den Admin-Consent erneuern.
          </>
        )}
      </p>
      {detail && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Technische Details</summary>
          <p className="mt-1 break-words font-mono">{detail}</p>
        </details>
      )}
    </div>
  );
}
