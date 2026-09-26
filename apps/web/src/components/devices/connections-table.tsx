'use client';

import clsx from 'clsx';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { formatDateTime } from '@/components/identity/sign-in-table';
import type { ConnectionReport, ConnectionSummary, RemoteScope } from '@zerostress/types';

export const scopeLabels: Record<RemoteScope, string> = {
  private: 'privat',
  public: 'oeffentlich',
  loopback: 'lokal',
  'link-local': 'link-local',
  multicast: 'multicast',
  unknown: 'unbekannt',
};

const scopeClass: Record<RemoteScope, string> = {
  private: 'bg-primary/10 text-primary',
  public: 'bg-warning/10 text-warning',
  loopback: 'bg-muted text-muted-foreground',
  'link-local': 'bg-muted text-muted-foreground',
  multicast: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

function columns(withDevices: boolean): ColumnDef<ConnectionSummary>[] {
  const cols: ColumnDef<ConnectionSummary>[] = [
    {
      id: 'remote',
      header: 'Ziel',
      accessor: (r) => r.remoteUrl ?? r.remoteIp,
      cell: (r) => (
        <>
          <span className="block font-medium">{r.remoteUrl ?? r.remoteIp}</span>
          {r.remoteUrl && <span className="block font-mono text-xs text-muted-foreground">{r.remoteIp}</span>}
        </>
      ),
    },
    {
      id: 'scope',
      header: 'Bereich',
      accessor: (r) => r.scope,
      filterOptions: (['public', 'private', 'loopback', 'link-local', 'multicast'] as RemoteScope[]).map((s) => ({ value: s, label: scopeLabels[s] })),
      searchable: false,
      cell: (r) => <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs', scopeClass[r.scope])}>{scopeLabels[r.scope]}</span>,
    },
    { id: 'ports', header: 'Ports', accessor: (r) => r.ports.join(', '), cell: (r) => <span className="font-mono text-xs">{r.ports.join(', ') || '—'}</span> },
    { id: 'processes', header: 'Prozesse', accessor: (r) => r.processes.join(', '), cell: (r) => <span className="text-xs text-muted-foreground">{r.processes.join(', ') || '—'}</span> },
    {
      id: 'direction',
      header: 'Richtung',
      accessor: (r) => r.direction,
      filterOptions: [
        { value: 'outbound', label: 'ausgehend' },
        { value: 'inbound', label: 'eingehend' },
        { value: 'mixed', label: 'beides' },
      ],
      searchable: false,
      cell: (r) => <span className="text-xs text-muted-foreground">{r.direction === 'outbound' ? 'ausgehend' : r.direction === 'inbound' ? 'eingehend' : 'beides'}</span>,
    },
  ];
  if (withDevices) cols.push({ id: 'devices', header: 'Geraete', accessor: (r) => r.deviceCount ?? 0, align: 'right', cell: (r) => <span className="tabular-nums">{r.deviceCount ?? '—'}</span> });
  cols.push({ id: 'count', header: 'Verbindungen', accessor: (r) => r.count, align: 'right', cell: (r) => <span className="tabular-nums">{r.count.toLocaleString('de-DE')}</span> });
  cols.push({ id: 'last', header: 'Zuletzt', accessor: (r) => (r.lastSeen ? new Date(r.lastSeen) : null), cell: (r) => <span className="text-xs text-muted-foreground">{r.lastSeen ? formatDateTime(r.lastSeen) : '—'}</span> });
  return cols;
}

/** Tabelle der Zieladressen; tenantweit mit Geraetezahl. */
export function ConnectionsTable({ report, storageKey, exportFileName, withDevices }: { report: ConnectionReport; storageKey: string; exportFileName: string; withDevices: boolean }) {
  const publicCount = report.items.filter((i) => i.scope === 'public').length;
  const privateCount = report.items.filter((i) => i.scope === 'private').length;
  const processes = new Map<string, number>();
  for (const i of report.items) for (const p of i.processes) processes.set(p, (processes.get(p) ?? 0) + i.count);
  const topProcesses = Array.from(processes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Ziele" value={report.items.length} sub={report.truncated ? 'gekuerzt auf die haeufigsten' : undefined} />
        <Stat label="Oeffentliche Ziele" value={publicCount} tone={publicCount > 0 ? 'warning' : undefined} />
        <Stat label="Private Ziele" value={privateCount} />
        <Stat label="Verbindungen" value={report.totalConnections.toLocaleString('de-DE')} sub={`${report.days} Tage`} />
      </div>
      {topProcesses.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Haeufigste Prozesse: {topProcesses.map(([p, n]) => `${p} (${n.toLocaleString('de-DE')})`).join(', ')}
        </p>
      )}
      <DataTable rows={report.items} columns={columns(withDevices)} getRowId={(r) => r.remoteIp} storageKey={storageKey} initialSort={{ columnId: withDevices ? 'devices' : 'count', direction: 'desc' }} searchPlaceholder="Host, IP, Prozess, Port..." exportFileName={exportFileName} dense />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'warning' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-xl font-semibold tabular-nums', tone === 'warning' && 'text-warning')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
