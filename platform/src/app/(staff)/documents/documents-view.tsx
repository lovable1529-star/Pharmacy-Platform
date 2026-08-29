'use client';

/**
 * The register.
 *
 * Filtered by category through the URL, so a filtered view is a link. Grouped
 * by day underneath, because the question people bring to a register is
 * usually "what came out of Tuesday", and a flat list of four hundred rows
 * answers it only by being read.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Search, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmptyState, PageHeader, Panel, Tag } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/lib/units';
import { CATEGORY_LABELS, type DocumentCategory } from '@/lib/documents/register';

interface Row {
  id: string;
  category: DocumentCategory;
  title: string;
  storagePath: string;
  patientId: string | null;
  patientName: string | null;
  mimeType: string | null;
  createdAt: string;
}

/** A stored object versus a route that regenerates the record. */
function isInternalLink(path: string): boolean {
  return path.startsWith('/');
}

export function DocumentsView({
  rows,
  counts,
  category,
  capped,
}: {
  rows: Row[];
  counts: Record<string, number>;
  category: DocumentCategory | null;
  capped: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q)
        || (r.patientName ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  const byDay = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of filtered) {
      const key = row.createdAt.slice(0, 10);
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()];
  }, [filtered]);

  const total = Object.values(counts).reduce((n, c) => n + c, 0);

  function choose(next: DocumentCategory | null) {
    router.push(next ? `/documents?category=${next}` : '/documents');
  }

  return (
    <div className="page-shell mx-auto max-w-[calc(1080px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Documents"
        subtitle={`${total} record${total === 1 ? '' : 's'} produced by the system.`}
      />

      {/* Category filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => choose(null)}
          aria-pressed={category === null}
          className={cn(
            'tabular rounded-control border px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.05em] transition-colors',
            category === null
              ? 'border-ink bg-ink text-white'
              : 'border-line text-ink-soft hover:border-brand-300',
          )}
        >
          {total} all
        </button>
        {(Object.keys(CATEGORY_LABELS) as DocumentCategory[])
          .filter((key) => (counts[key] ?? 0) > 0)
          .map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => choose(category === key ? null : key)}
              aria-pressed={category === key}
              className={cn(
                'rounded-control border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                category === key
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-line text-ink-soft hover:border-brand-300 hover:text-ink',
              )}
            >
              {CATEGORY_LABELS[key]}
              <span className="tabular ml-1.5 font-mono text-[11px] opacity-70">
                {counts[key]}
              </span>
            </button>
          ))}
      </div>

      <Panel className="mb-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5 rounded-control border border-line bg-canvas px-3 py-2 transition-[border-color,box-shadow] focus-within:border-brand-300 focus-within:shadow-[0_0_0_3px_var(--color-brand-50)]">
          <Search size={14} strokeWidth={2} className="shrink-0 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or patient"
            aria-label="Search documents"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="tabular shrink-0 font-mono text-[11.5px] text-ink-faint">
            {filtered.length}
          </span>
        </div>
      </Panel>

      {capped ? (
        <p className="mb-4 rounded-control border border-review-200 bg-review-50 px-3.5 py-2.5 text-[13px] text-review-700">
          Showing the most recent 400. Filter by category to narrow it — this is
          not the whole register.
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState
            title={query ? 'Nothing matches' : 'No documents yet'}
            body={
              query
                ? 'Try a patient name, or clear the search.'
                : 'Records appear here as consultations, vaccinations and prescriptions are completed.'
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4">
          {byDay.map(([day, items]) => (
            <section key={day}>
              <div className="mb-2 flex items-baseline gap-2.5">
                <h2 className="text-[13.5px] font-semibold text-ink">{formatDate(day)}</h2>
                <span className="tabular font-mono text-[11.5px] text-ink-faint">
                  {items.length}
                </span>
              </div>

              <Panel>
                {items.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0"
                  >
                    <FileText size={15} strokeWidth={2} className="shrink-0 text-ink-faint" />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">
                        {row.title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Tag tone="neutral">{CATEGORY_LABELS[row.category]}</Tag>
                        {row.patientName && row.patientId ? (
                          <Link
                            href={`/patients/${row.patientId}`}
                            className="text-[12px] text-brand-600 underline underline-offset-2"
                          >
                            {row.patientName}
                          </Link>
                        ) : null}
                      </span>
                    </span>

                    <span className="tabular hidden shrink-0 font-mono text-[11px] text-ink-faint sm:block">
                      {formatDateTime(row.createdAt)}
                    </span>

                    {/*
                      Only ever an internal route. §16.2 — patient documents use
                      private storage with an authenticated check, never a
                      public URL, so there is nothing here to link straight to.
                    */}
                    {isInternalLink(row.storagePath) ? (
                      <Link
                        href={row.storagePath}
                        className="flex shrink-0 items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-300 hover:text-ink"
                      >
                        Open
                        <ExternalLink size={12} strokeWidth={2.2} />
                      </Link>
                    ) : (
                      <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                        stored file
                      </span>
                    )}
                  </div>
                ))}
              </Panel>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
