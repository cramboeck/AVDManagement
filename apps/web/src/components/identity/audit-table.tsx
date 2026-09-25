'use client';

import clsx from 'clsx';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import type { DirectoryAuditEvent } from '@zerostress/types';
import { formatDateTime } from './sign-in-table';

const resultLabels: Record<DirectoryAuditEvent['result'], string> = {
  success: 'Erfolgreich',
  failure: 'Fehlgeschlagen',
  timeout: 'Zeitueberschreitung',
  unknown: 'Unbekannt',
};

const resultClasses: Record<DirectoryAuditEvent['result'], string> = {
  success: 'bg-success/10 text-success',
  failure: 'bg-destructive/10 text-destructive',
  timeout: 'bg-warning/10 text-warning',
  unknown: 'bg-muted text-muted-foreground',
};

const columns: ColumnDef<DirectoryAuditEvent>[] = [
  {
    id: 'activityAt',
    header: 'Zeit',
    accessor: (e) => new Date(e.activityAt),
    cell: (e) => (
      <span className="whitespace-nowrap text-muted-foreground" title={e.activityAt}>
        {formatDateTime(e.activityAt)}
      </span>
    ),
  },
  {
    id: 'activity',
    header: 'Aktivitaet',
    accessor: (e) => e.activity,
    cell: (e) => {
      const changes = e.targets.flatMap((t) => t.modifiedProperties);
      return (
        <>
          <span className="block font-medium">{e.activity}</span>
          {changes.length > 0 && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {changes.length} Aenderung{changes.length === 1 ? '' : 'en'}
              </summary>
              <table className="mt-1 w-full">
                <tbody>
                  {changes.map((change, index) => (
                    <tr key={`${change.name}-${index}`} className="border-t">
                      <td className="py-0.5 pr-2 font-mono">{change.name}</td>
                      <td className="py-0.5 pr-2 text-muted-foreground">{change.oldValue ?? '—'}</td>
                      <td className="py-0.5 font-medium">{change.newValue ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      );
    },
  },
  {
    id: 'category',
    header: 'Kategorie',
    accessor: (e) => e.category,
    className: 'text-xs text-muted-foreground',
  },
  {
    id: 'result',
    header: 'Ergebnis',
    accessor: (e) => resultLabels[e.result],
    filterOptions: (Object.keys(resultLabels) as DirectoryAuditEvent['result'][]).map((r) => ({ value: resultLabels[r], label: resultLabels[r] })),
    cell: (e) => (
      <>
        <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', resultClasses[e.result])}>{resultLabels[e.result]}</span>
        {e.resultReason && (
          <p className="mt-0.5 max-w-[14rem] truncate text-xs text-muted-foreground" title={e.resultReason}>
            {e.resultReason}
          </p>
        )}
      </>
    ),
  },
  {
    id: 'initiatedBy',
    header: 'Ausgeloest von',
    accessor: (e) => e.initiatedBy.userPrincipalName ?? e.initiatedBy.displayName ?? null,
    cell: (e) => (
      <span className="text-xs">
        <span className="block">{e.initiatedBy.displayName ?? e.initiatedBy.userPrincipalName ?? '—'}</span>
        <span className="block text-muted-foreground">{e.initiatedBy.kind === 'app' ? 'Anwendung' : e.initiatedBy.userPrincipalName ?? ''}</span>
      </span>
    ),
  },
  {
    id: 'target',
    header: 'Ziel',
    accessor: (e) => e.targets.map((t) => t.displayName ?? t.userPrincipalName ?? t.id ?? '').join(', ') || null,
    cell: (e) => (
      <span className="text-xs">
        {e.targets.length === 0
          ? '—'
          : e.targets.map((target, index) => (
              <span key={`${target.id}-${index}`} className="block">
                {target.displayName ?? target.userPrincipalName ?? target.id ?? '—'}
                {target.type && <span className="text-muted-foreground"> ({target.type})</span>}
              </span>
            ))}
      </span>
    ),
  },
];

export function AuditTable({ events, storageKey = 'directory-audit' }: { events: DirectoryAuditEvent[]; storageKey?: string }) {
  return (
    <DataTable
      rows={events}
      columns={columns}
      getRowId={(e) => e.id}
      storageKey={storageKey}
      initialSort={{ columnId: 'activityAt', direction: 'desc' }}
      searchPlaceholder="Aktivitaet, Akteur, Ziel..."
      exportFileName="verzeichnisaudit"
      dense
    />
  );
}
