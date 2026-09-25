'use client';

import { useState } from 'react';
import clsx from 'clsx';

export interface TableRow {
  label: string;
  values: (string | number)[];
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  // Tabellenansicht: der barrierefreie Zwilling jedes Diagramms
  tableHeaders: string[];
  tableRows: TableRow[];
  isFetching?: boolean;
  footnote?: string;
  children: React.ReactNode;
}

export function ChartCard({ title, subtitle, tableHeaders, tableRows, isFetching = false, footnote, children }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);

  return (
    <figure className={clsx('rounded-lg border p-4 transition-opacity', isFetching && 'opacity-60')}>
      <figcaption className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <button
          onClick={() => setShowTable((s) => !s)}
          aria-pressed={showTable}
          className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {showTable ? 'Diagramm' : 'Tabelle'}
        </button>
      </figcaption>

      {showTable ? (
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              {tableHeaders.map((h) => (
                <th key={h} className="py-1 pr-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.label} className="border-b last:border-0">
                <td className="py-1 pr-3">{row.label}</td>
                {row.values.map((v, i) => (
                  <td key={i} className="py-1 pr-3 tabular-nums">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}

      {footnote && <p className="mt-3 text-xs text-muted-foreground">{footnote}</p>}
    </figure>
  );
}
