'use client';

import { useConsoleMode } from '@/hooks/use-console-mode';
import { useTenant } from '@/hooks/use-tenant';

/**
 * Hinweis unter der Kopfzeile, solange Aenderungen gesperrt sind: fuer die
 * ganze Konsole oder fuer den aktiven Tenant. Die Sperre selbst setzt die API durch.
 */
export function ReadOnlyBanner() {
  const mode = useConsoleMode();
  const { activeTenant } = useTenant();

  if (mode.data?.readOnly) {
    return (
      <div className="border-b border-warning/40 bg-warning/10 px-6 py-2 text-sm" role="status">
        <strong className="font-medium">Nur-Lese-Betrieb:</strong> Die Konsole legt fuer keinen Tenant schreibende Jobs an. Ausnahmen sind das
        Zuruecknehmen frueherer Aenderungen (z. B. Admin auf Zeit entziehen) und das Einsammeln von Exchange-Daten.
      </div>
    );
  }
  if (activeTenant?.accessMode === 'read-only') {
    return (
      <div className="border-b border-warning/40 bg-warning/10 px-6 py-2 text-sm" role="status">
        <strong className="font-medium">{activeTenant.displayName} ist auf Nur-Lesen gestellt.</strong> Aenderungen an diesem Tenant sind gesperrt;
        umschalten unter Tenants (Rolle Owner).
      </div>
    );
  }
  return null;
}
