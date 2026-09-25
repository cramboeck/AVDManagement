'use client';

import Link from 'next/link';
import type { CapabilityUnavailableReason } from '@zerostress/types';

interface CapabilityNoticeProps {
  what: string;
  reason: CapabilityUnavailableReason;
  missingPermission: string | null;
  detail: string | null;
  compact?: boolean;
}

// Fehlende Lizenz, Berechtigung oder Onboarding ist ein erwarteter Zustand mit naechstem Schritt
export function CapabilityNotice({ what, reason, missingPermission, detail, compact = false }: CapabilityNoticeProps) {
  const content = describe(what, reason, missingPermission);

  return (
    <div className={compact ? 'rounded-md border border-dashed px-3 py-2' : 'rounded-lg border border-dashed p-5'} role="status">
      <p className={compact ? 'text-sm font-medium' : 'font-medium'}>{content.title}</p>
      <p className={compact ? 'mt-0.5 text-xs text-muted-foreground' : 'mt-1 text-sm text-muted-foreground'}>{content.body}</p>
      {detail && !compact && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Technische Details</summary>
          <p className="mt-1 break-words font-mono">{detail}</p>
        </details>
      )}
    </div>
  );
}

function describe(what: string, reason: CapabilityUnavailableReason, missingPermission: string | null) {
  switch (reason) {
    case 'premium-required':
      return {
        title: 'Entra ID P1 erforderlich',
        body: (
          <>
            Microsoft stellt {what} nur fuer Tenants mit Entra ID P1 oder P2 bereit (enthalten z. B. in Microsoft 365
            Business Premium, E3 und E5). Sobald der Tenant lizenziert ist, erscheinen die Daten hier ohne weitere
            Einrichtung.
          </>
        ),
      };
    case 'not-licensed':
      return {
        title: 'Defender for Endpoint nicht lizenziert',
        body: (
          <>
            Fuer {what} braucht der Tenant Defender for Business (in Microsoft 365 Business Premium) oder Defender for
            Endpoint P2. Ohne Lizenz existiert die Defender-API in diesem Tenant nicht.
          </>
        ),
      };
    case 'not-onboarded':
      return {
        title: 'Nicht in Defender onboarded',
        body: <>{what} gibt es nur fuer Geraete, die in Defender for Endpoint onboarded sind.</>,
      };
    case 'permission-missing':
    default:
      return {
        title: `Berechtigung fehlt: ${missingPermission ?? 'unbekannt'}`,
        body: (
          <>
            Fuer {what} braucht die App-Registrierung die Anwendungsberechtigung{' '}
            <span className="font-mono">{missingPermission}</span>. Berechtigung im Entra-Portal hinzufuegen, danach
            unter{' '}
            <Link href="/tenants" className="text-primary underline-offset-2 hover:underline">
              Tenants
            </Link>{' '}
            den Consent erneuern.
          </>
        ),
      };
  }
}
