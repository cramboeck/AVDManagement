'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { SnapshotStatus } from '@/components/inventory/snapshot-status';
import { formatRelative } from '@/components/devices/device-badges';
import type { NetworkSite, NetworkSubnet, NetworkTopology, NetworkTopologyDevice } from '@zerostress/types';

export default function NetworkPage() {
  const { activeTenant, isLoading: tenantLoading } = useTenant();

  const query = useQuery({
    queryKey: ['network-topology', activeTenant?.id],
    queryFn: () => api.get<NetworkTopology>(`/tenants/${activeTenant!.id}/network/topology`),
    enabled: !!activeTenant,
    staleTime: 5 * 60 * 1000,
  });

  if (tenantLoading) return <LoadingTable />;
  if (!activeTenant) return <NoTenantSelected />;

  const topology = query.data;
  const totalDevices = (topology?.sites.reduce((n, s) => n + s.deviceCount, 0) ?? 0) + (topology?.withoutAddress.length ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Netzwerk</h1>
          <p className="text-sm text-muted-foreground">
            Standorte und Subnetze, abgeleitet aus den zuletzt vom Defender-Sensor gemeldeten Adressen: gleiche oeffentliche IP heisst gleicher
            Standort, gleiches /24 heisst gleiches Subnetz.
          </p>
        </div>
        <SnapshotStatus tenantId={activeTenant.id} kinds={['devices']} invalidate={[['network-topology', activeTenant.id], ['devices', activeTenant.id]]} />
      </div>

      {query.isLoading ? (
        <LoadingTable rows={6} />
      ) : query.error ? (
        <ErrorState error={query.error as Error} onRetry={query.refetch} />
      ) : !topology ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Standorte" value={topology.sites.filter((s) => s.externalIp !== null).length} />
            <Stat label="Subnetze" value={topology.sites.reduce((n, s) => n + s.subnets.length, 0)} />
            <Stat label="Geraete mit Adresse" value={totalDevices - topology.withoutAddress.length} />
            <Stat label="Ohne Adresse" value={topology.withoutAddress.length} tone={topology.withoutAddress.length > 0 ? 'muted' : undefined} />
          </div>

          {topology.sites.length === 0 ? (
            <EmptyState
              title="Keine Adressen bekannt"
              description="Der Defender-Sensor hat fuer diesen Tenant noch keine IP-Adressen gemeldet. Ohne Defender for Endpoint bleibt diese Seite leer."
            />
          ) : (
            <div className="space-y-4">
              {topology.sites.map((site) => (
                <SiteCard key={site.externalIp ?? 'unknown'} site={site} />
              ))}
            </div>
          )}

          {topology.withoutAddress.length > 0 && (
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">Geraete ohne bekannte Adresse ({topology.withoutAddress.length})</summary>
              <p className="mt-1 text-xs text-muted-foreground">Nicht in Defender onboarded oder vom Sensor noch nie mit Adresse gemeldet.</p>
              <DeviceList devices={topology.withoutAddress} showIp={false} />
            </details>
          )}
        </>
      )}
    </div>
  );
}

function SiteCard({ site }: { site: NetworkSite }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-lg border">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-accent/50">
        <div>
          <h2 className="font-medium">{site.externalIp ? <>Standort <span className="font-mono">{site.externalIp}</span></> : 'Standort unbekannt'}</h2>
          <p className="text-xs text-muted-foreground">
            {site.subnets.length} Subnetz{site.subnets.length === 1 ? '' : 'e'} · {site.deviceCount} Geraet{site.deviceCount === 1 ? '' : 'e'}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{open ? 'Einklappen' : 'Ausklappen'}</span>
      </button>
      {open && (
        <div className="divide-y border-t">
          {site.subnets.map((subnet) => (
            <SubnetRow key={subnet.cidr} subnet={subnet} />
          ))}
        </div>
      )}
    </section>
  );
}

function SubnetRow({ subnet }: { subnet: NetworkSubnet }) {
  const [open, setOpen] = useState(subnet.devices.length <= 12);
  return (
    <div className="px-4 py-3">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span className="font-mono text-sm">{subnet.cidr}</span>
        <span className="text-xs text-muted-foreground">
          {subnet.devices.length} Geraet{subnet.devices.length === 1 ? '' : 'e'} · {open ? 'Einklappen' : 'Ausklappen'}
        </span>
      </button>
      {open && <DeviceList devices={subnet.devices} showIp />}
    </div>
  );
}

function DeviceList({ devices, showIp }: { devices: NetworkTopologyDevice[]; showIp: boolean }) {
  return (
    <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
      {devices.map((d) => (
        <li key={d.id}>
          <Link
            href={`/devices/${encodeURIComponent(d.id)}`}
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="truncate">
              <span className="font-medium">{d.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{d.operatingSystem ?? '—'} · aktiv {formatRelative(d.lastActivityAt)}</span>
            </span>
            {showIp && <span className="shrink-0 font-mono text-xs text-muted-foreground">{d.ipAddress}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'muted' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'muted' && 'text-muted-foreground')}>{value}</p>
    </div>
  );
}
