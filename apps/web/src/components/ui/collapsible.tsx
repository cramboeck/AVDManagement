'use client';

import { useId, useState } from 'react';
import clsx from 'clsx';

interface CollapsibleProps {
  // Kurze Zusammenfassung, die immer sichtbar bleibt
  summary: React.ReactNode;
  // Rechts in der Kopfzeile, z. B. Zaehler oder Badge
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Ausklappbereich fuer lange Inhalte: Kopfzeile mit Zusammenfassung, Inhalt
 * erst auf Wunsch. Tastatur: Enter/Leertaste auf der Kopfzeile.
 */
export function Collapsible({ summary, aside, defaultOpen = false, className, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={clsx('rounded-md border', className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={clsx('inline-block text-xs text-muted-foreground transition-transform', open && 'rotate-90')}>
            ▶
          </span>
          <span className="min-w-0 truncate">{summary}</span>
        </span>
        {aside && <span className="shrink-0 text-xs text-muted-foreground">{aside}</span>}
      </button>
      {open && (
        <div id={id} className="border-t px-3 py-3">
          {children}
        </div>
      )}
    </div>
  );
}
