'use client';

import { useTenant } from '@/hooks/use-tenant';
import { NoTenantSelected } from '@/components/ui/empty-state';
import { LoadingPage } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';

export default function DashboardPage() {
  const { activeTenant, isLoading, error, refetch } = useTenant();

  if (isLoading) {
    return <LoadingPage message="Lade Tenants..." />;
  }

  if (error) {
    return <ErrorState error={error} onRetry={refetch} />;
  }

  if (!activeTenant) {
    return <NoTenantSelected />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{activeTenant.displayName}</h1>
        <p className="text-sm text-muted-foreground">
          {activeTenant.primaryDomain}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Benutzer"
          value="--"
          description="Aktive Identitaeten"
        />
        <StatCard
          label="Geraete"
          value="--"
          description="Intune-verwaltet"
        />
        <StatCard
          label="Lizenzen"
          value="--"
          description="Zugewiesene SKUs"
        />
        <StatCard
          label="Jobs"
          value="--"
          description="Ausstehend"
        />
      </div>

      <div className="rounded-lg border p-6">
        <h2 className="mb-4 text-lg font-medium">Aktuelle Aktivitaeten</h2>
        <p className="text-sm text-muted-foreground">
          Hier erscheinen kuerzlich ausgefuehrte Jobs und wichtige Ereignisse.
        </p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
