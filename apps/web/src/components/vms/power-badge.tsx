'use client';

import clsx from 'clsx';
import type { VmPowerState } from '@zerostress/types';

export const powerMeta: Record<VmPowerState, { label: string; className: string }> = {
  running: { label: 'laeuft', className: 'bg-success/10 text-success' },
  stopped: { label: 'gestoppt (kostet)', className: 'bg-warning/10 text-warning' },
  deallocated: { label: 'freigegeben', className: 'bg-muted text-muted-foreground' },
  starting: { label: 'startet', className: 'bg-primary/10 text-primary' },
  stopping: { label: 'stoppt', className: 'bg-warning/10 text-warning' },
  deallocating: { label: 'wird freigegeben', className: 'bg-warning/10 text-warning' },
  unknown: { label: 'unbekannt', className: 'bg-muted text-muted-foreground' },
};

export function PowerBadge({ state }: { state: VmPowerState }) {
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', powerMeta[state].className)}>{powerMeta[state].label}</span>;
}

