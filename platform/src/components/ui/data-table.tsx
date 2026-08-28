'use client';


/**
 * The one table pattern.
 *
 * Every list in the product uses this — patients, inventory, consultations,
 * reports. Learn it once on one screen and you know it everywhere, which is
 * most of what separates software that feels professional from software that
 * feels assembled.
 *
 * Filter, sort, paginate and export, with tabular numerals wherever digits line
 * up. Wide tables scroll inside their own container so the page body never
 * scrolls sideways.
 */

import { useMemo, useState } from 'react';
import { ArrowUpDown, Download, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmptyState } from './primitives';

export interface Column<T> {
  key: string;
  header: string;
  /** What to render. Falls back to the raw value. */
  render?: (row: T) => React.ReactNode;
  /** What to sort, filter and export on. */
  value?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  /** Numbers that line up in a column. */
  numeric?: boolean;
  width?: string;
  /**
   * Let this column's text wrap onto a second line.
   *
   * Off by default: single-line rows are what make a long table scannable, and
   * every column in the product today is a name, a date, a code or a count.
   * Set it if you ever add one holding a sentence — a wide table that scrolls
   * sideways beats a ragged one whose row heights all differ.
   */
  wrap?: boolean;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyBody?: string;
  onRowClick?: (row: T) => void;
  /** Filename stem for CSV export. Omit to hide the export button. */
  exportName?: string;
  pageSize?: number;
  toolbar?: React.ReactNode;
}

function cellValue<T>(column: Column<T>, row: T): string | number | null {
  if (column.value) return column.value(row);
  const raw = (row as Record<string, unknown>)[column.key];
  if (raw === null || raw === undefined) return null;
  return typeof raw === 'number' ? raw : String(raw);
}

function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const escape = (value: string | number | null) => {
    if (value === null) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    columns.map((c) => escape(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => escape(cellValue(c, row))).join(',')),
  ].join('\n');
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchPlaceholder = 'Filter…',
  emptyTitle = 'Nothing here yet',
  emptyBody,
  onRowClick,
  exportName,
  pageSize = 25,
  toolbar,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      columns.some((c) => String(cellValue(c, row) ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, columns, query]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const column = columns.find((c) => c.key === sortKey);
    if (!column) return filtered;

    return [...filtered].sort((a, b) => {
      const left = cellValue(column, a);
      const right = cellValue(column, b);
      if (left === right) return 0;
      if (left === null) return 1;
      if (right === null) return -1;

      const comparison =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), 'en-GB');

      return descending ? -comparison : comparison;
    });
  }, [filtered, columns, sortKey, descending]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) setDescending((d) => !d);
    else { setSortKey(key); setDescending(false); }
    setPage(0);
  }

  function exportCsv() {
    if (!exportName) return;
    const blob = new Blob([toCsv(sorted, columns)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportName}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        {/* The whole field lights up on focus, not just the <input> inside it —
            otherwise the ring appears around the text and leaves the icon and
            the border it shares looking detached. */}
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-control border border-line bg-canvas px-3 py-2 transition-[border-color,box-shadow] focus-within:border-brand-300 focus-within:shadow-[0_0_0_3px_var(--color-brand-50)]">
          <Search size={14} strokeWidth={2} className="shrink-0 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>

        {toolbar}

        <span className="tabular font-mono text-[11.5px] text-ink-faint">
          {sorted.length} {sorted.length === 1 ? 'row' : 'rows'}
        </span>

        {exportName ? (
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
          >
            <Download size={13} strokeWidth={2} />
            CSV
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      'border-b border-line bg-sunk px-4 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-faint',
                      c.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        'inline-flex items-center gap-1 transition-colors hover:text-ink',
                        sortKey === c.key && 'text-ink',
                      )}
                    >
                      {c.header}
                      {/* Faint on every column so the control is discoverable,
                          solid on the one actually in force. Previously all
                          six looked identical and nothing said which column
                          the table was sorted by. */}
                      <ArrowUpDown
                        size={10}
                        strokeWidth={2.2}
                        className={cn('transition-opacity', sortKey === c.key ? 'opacity-100' : 'opacity-40')}
                      />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-line-soft last:border-b-0',
                    onRowClick && 'cursor-pointer transition-colors hover:bg-sunk',
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        // Middle rather than top: rows carrying a pill or a
                        // small button next to plain text looked top-heavy,
                        // with the text riding above the control beside it.
                        'px-4 py-2.5 align-middle text-ink',
                        !c.wrap && 'whitespace-nowrap',
                        c.align === 'right' && 'text-right',
                        c.numeric && 'tabular font-mono text-[12.5px]',
                      )}
                    >
                      {c.render ? c.render(row) : (cellValue(c, row) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <span className="tabular font-mono text-[11.5px] text-ink-faint">
            Page {current + 1} of {pageCount}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={current === 0}
              aria-label="Previous page"
              className="rounded-[6px] border border-line p-1.5 text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
            >
              <ChevronLeft size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={current >= pageCount - 1}
              aria-label="Next page"
              className="rounded-[6px] border border-line p-1.5 text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
            >
              <ChevronRight size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
