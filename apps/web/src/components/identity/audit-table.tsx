'use client';

import clsx from 'clsx';
import type { DirectoryAuditEvent } from '@zerostress/types';
import { formatDateTime } from './sign-in-table';

const resultClasses: Record<DirectoryAuditEvent['result'], string> = {
  success: 'bg-success/10 text-success',
  failure: 'bg-destructive/10 text-destructive',
  timeout: 'bg-warning/10 text-warning',
  unknown: 'bg-muted text-muted-foreground',
};

export function AuditTable({ events }: { events: DirectoryAuditEvent[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Zeit</th>
            <th className="px-3 py-2 font-medium">Aktivitaet</th>
            <th className="px-3 py-2 font-medium">Ergebnis</th>
            <th className="px-3 py-2 font-medium">Ausgeloest von</th>
            <th className="px-3 py-2 font-medium">Ziel</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const changes = event.targets.flatMap((t) => t.modifiedProperties);
            return (
              <tr key={event.id} className="border-b align-top last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground" title={event.activityAt}>
                  {formatDateTime(event.activityAt)}
                </td>
                <td className="px-3 py-2">
                  <span className="block font-medium">{event.activity}</span>
                  <span className="block text-xs text-muted-foreground">{event.category}</span>
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
                </td>
                <td className="px-3 py-2">
                  <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', resultClasses[event.result])}>
                    {event.result}
                  </span>
                  {event.resultReason && (
                    <p className="mt-0.5 max-w-[14rem] truncate text-xs text-muted-foreground" title={event.resultReason}>
                      {event.resultReason}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="block">{event.initiatedBy.displayName ?? event.initiatedBy.userPrincipalName ?? '—'}</span>
                  <span className="block text-muted-foreground">
                    {event.initiatedBy.kind === 'app' ? 'Anwendung' : event.initiatedBy.userPrincipalName ?? ''}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {event.targets.length === 0
                    ? '—'
                    : event.targets.map((target, index) => (
                        <span key={`${target.id}-${index}`} className="block">
                          {target.displayName ?? target.userPrincipalName ?? target.id ?? '—'}
                          {target.type && <span className="text-muted-foreground"> ({target.type})</span>}
                        </span>
                      ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
