'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';

export type SortDirection = 'asc' | 'desc';
export type CellValue = string | number | boolean | Date | null | undefined;

export interface ColumnDef<T> {
  id: string;
  header: string;
  // Wert fuer Suche, Filter und Export (und Sortierung, wenn kein sortValue gesetzt ist)
  accessor: (row: T) => CellValue;
  // Abweichender Sortierwert, z. B. Rang statt Bezeichnung bei Schweregraden
  sortValue?: (row: T) => CellValue;
  // Darstellung; Standard ist der formatierte Accessor-Wert
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  searchable?: boolean;
  filterOptions?: { value: string; label: string }[];
  filterLabel?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  defaultHidden?: boolean;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: ColumnDef<T>[];
  getRowId: (row: T) => string;
  // Schluessel fuer gemerkte Einstellungen (Sortierung, Seitengroesse, Spalten, Filter)
  storageKey: string;
  initialSort?: { columnId: string; direction: SortDirection };
  initialPageSize?: number;
  searchPlaceholder?: string;
  // Aus, wenn die Seite bereits serverseitig sucht
  enableSearch?: boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyState?: React.ReactNode;
  toolbar?: React.ReactNode;
  exportFileName?: string;
  dense?: boolean;
}

interface PersistedState {
  sort: { columnId: string; direction: SortDirection } | null;
  pageSize: number;
  hiddenColumns: string[];
  filters: Record<string, string>;
}

const PAGE_SIZES = [25, 50, 100, 250];

function loadState(key: string): Partial<PersistedState> | null {
  try {
    const raw = window.localStorage.getItem(`datatable:${key}`);
    return raw ? (JSON.parse(raw) as Partial<PersistedState>) : null;
  } catch {
    return null;
  }
}

function saveState(key: string, state: PersistedState): void {
  try {
    window.localStorage.setItem(`datatable:${key}`, JSON.stringify(state));
  } catch {
    // Speicher nicht verfuegbar (privater Modus): Einstellungen gelten dann nur fuer die Sitzung
  }
}

function compareValues(a: CellValue, b: CellValue): number {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '' ? 0 : 1;
  if (b === null || b === undefined || b === '') return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });
}

export function formatCellValue(value: CellValue): string {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) return value.toLocaleString('de-DE');
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  return String(value);
}

function toCsv<T>(rows: T[], columns: ColumnDef<T>[]): string {
  const escape = (value: CellValue): string => {
    const text = value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value);
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((c) => escape(c.header)).join(';')];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(c.accessor(row))).join(';'));
  }
  // BOM, damit Excel UTF-8 erkennt
  return `﻿${lines.join('\r\n')}`;
}

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  storageKey,
  initialSort,
  initialPageSize = 50,
  searchPlaceholder = 'Suchen...',
  enableSearch = true,
  onRowClick,
  rowClassName,
  emptyState,
  toolbar,
  exportFileName,
  dense = false,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<PersistedState['sort']>(initialSort ?? null);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(
    columns.filter((c) => c.defaultHidden).map((c) => c.id)
  );
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const hydrated = useRef(false);

  // Gemerkte Einstellungen erst nach dem Mount laden, damit Server- und Client-Render uebereinstimmen
  useEffect(() => {
    const stored = loadState(storageKey);
    if (stored) {
      if (stored.sort && columns.some((c) => c.id === stored.sort?.columnId)) setSort(stored.sort);
      if (stored.pageSize && PAGE_SIZES.includes(stored.pageSize)) setPageSize(stored.pageSize);
      if (stored.hiddenColumns) setHiddenColumns(stored.hiddenColumns.filter((id) => columns.some((c) => c.id === id)));
      if (stored.filters) setFilters(stored.filters);
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated.current) return;
    saveState(storageKey, { sort, pageSize, hiddenColumns, filters });
  }, [storageKey, sort, pageSize, hiddenColumns, filters]);

  useEffect(() => {
    setPage(0);
  }, [search, filters, sort, pageSize, rows]);

  const visibleColumns = columns.filter((c) => !hiddenColumns.includes(c.id));
  const filterColumns = columns.filter((c) => c.filterOptions && c.filterOptions.length > 0);

  const processed = useMemo(() => {
    const term = search.trim().toLowerCase();
    let result = rows;

    for (const [columnId, value] of Object.entries(filters)) {
      if (!value) continue;
      const column = columns.find((c) => c.id === columnId);
      if (!column) continue;
      result = result.filter((row) => String(column.accessor(row) ?? '') === value);
    }

    if (term) {
      const searchable = columns.filter((c) => c.searchable !== false);
      result = result.filter((row) =>
        searchable.some((c) => {
          const value = c.accessor(row);
          return value !== null && value !== undefined && formatCellValue(value).toLowerCase().includes(term);
        })
      );
    }

    if (sort) {
      const column = columns.find((c) => c.id === sort.columnId);
      if (column) {
        const factor = sort.direction === 'asc' ? 1 : -1;
        const value = column.sortValue ?? column.accessor;
        result = [...result].sort((a, b) => compareValues(value(a), value(b)) * factor);
      }
    }

    return result;
  }, [rows, columns, filters, search, sort]);

  const pageCount = Math.max(1, Math.ceil(processed.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = processed.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const toggleSort = (column: ColumnDef<T>) => {
    if (column.sortable === false) return;
    setSort((current) => {
      if (!current || current.columnId !== column.id) return { columnId: column.id, direction: 'asc' };
      if (current.direction === 'asc') return { columnId: column.id, direction: 'desc' };
      return null;
    });
  };

  const exportCsv = () => {
    const csv = toCsv(processed, visibleColumns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportFileName ?? storageKey}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const cellPadding = dense ? 'px-3 py-1.5' : 'px-3 py-2';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {enableSearch && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 w-64 rounded-md border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        )}
        {filterColumns.map((column) => (
          <select
            key={column.id}
            value={filters[column.id] ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, [column.id]: e.target.value }))}
            aria-label={column.filterLabel ?? column.header}
            className={clsx(
              'h-9 rounded-md border bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              filters[column.id] && 'border-primary'
            )}
          >
            <option value="">{column.filterLabel ?? column.header}: alle</option>
            {column.filterOptions!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        {(activeFilterCount > 0 || search) && (
          <button
            onClick={() => {
              setFilters({});
              setSearch('');
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Zuruecksetzen
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <span className="text-xs text-muted-foreground">
            {processed.length === rows.length ? `${rows.length}` : `${processed.length} von ${rows.length}`}
          </span>
          <div className="relative">
            <button
              onClick={() => setColumnsOpen((o) => !o)}
              aria-expanded={columnsOpen}
              className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
            >
              Spalten
            </button>
            {columnsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColumnsOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border bg-background p-2 shadow-lg">
                  {columns.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.includes(c.id)}
                        onChange={(e) =>
                          setHiddenColumns((h) => (e.target.checked ? h.filter((id) => id !== c.id) : [...h, c.id]))
                        }
                        className="h-4 w-4"
                      />
                      {c.header}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={exportCsv} disabled={processed.length === 0} className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
            CSV
          </button>
        </div>
      </div>

      {processed.length === 0 ? (
        emptyState ?? <p className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">Keine Eintraege.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                {visibleColumns.map((column) => {
                  const active = sort?.columnId === column.id;
                  const sortable = column.sortable !== false;
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={clsx(cellPadding, 'font-medium', column.align === 'right' && 'text-right', column.align === 'center' && 'text-center', !column.align && 'text-left', column.className)}
                    >
                      {sortable ? (
                        <button
                          onClick={() => toggleSort(column)}
                          className={clsx('inline-flex items-center gap-1 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary', active ? 'text-foreground' : 'text-muted-foreground')}
                        >
                          {column.header}
                          <span aria-hidden="true" className="text-xs">
                            {active ? (sort!.direction === 'asc' ? '▲' : '▼') : '⇅'}
                          </span>
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{column.header}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={getRowId(row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter') onRowClick(row);
                        }
                      : undefined
                  }
                  className={clsx(
                    'border-b last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-accent/50 focus:outline-none focus-visible:bg-accent',
                    rowClassName?.(row)
                  )}
                >
                  {visibleColumns.map((column) => (
                    <td
                      key={column.id}
                      className={clsx(cellPadding, 'align-top', column.align === 'right' && 'text-right', column.align === 'center' && 'text-center', column.className)}
                    >
                      {column.cell ? column.cell(row) : formatCellValue(column.accessor(row))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {processed.length > PAGE_SIZES[0] && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Pro Seite
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, processed.length)} von {processed.length}
            </span>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={currentPage === 0} className="rounded-md border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50">
              Zurueck
            </button>
            <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={currentPage >= pageCount - 1} className="rounded-md border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50">
              Weiter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
