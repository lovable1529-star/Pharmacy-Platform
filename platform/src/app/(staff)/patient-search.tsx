'use client';

/**
 * The search box that is the point of the home screen.
 *
 * One box that takes a name, a name and a date of birth, a postcode or a phone
 * number, works out which is which, and tolerates misspelling. Nothing fires
 * under three characters — that keeps query volume, and the hosting bill, down.
 *
 * ── Redesign notes ────────────────────────────────────────────────────────
 *
 * Now sits INSIDE the Today hero panel rather than under it, so the first
 * thing on the screen is the thing the pharmacist came to do. That means it no
 * longer supplies its own bottom margin — the hero owns the spacing.
 *
 * "New patient" moved out of the field and up into the hero's action row. A
 * primary button living inside a search input made the field read as a form to
 * be submitted, when in fact it filters as you type and nothing is ever
 * submitted. The destination is unchanged and is now more prominent, not less.
 *
 * The "keep typing" hint moved inline to the right of the field. Below the
 * field it pushed the whole page down by a line the moment anyone touched the
 * keyboard, which is a visible jolt on every single search.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  searchPatients, shouldSearch, ageInYears, SEARCH_MIN_LENGTH, type PatientRecord,
} from '@/lib/patients/search';
import { formatDate } from '@/lib/units';

export function PatientSearch({ patients }: { patients: PatientRecord[] }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchPatients(patients, query), [patients, query]);
  const searching = shouldSearch(query);

  return (
    <div className="relative">
      <div
        className={cn(
          'flex items-center gap-3 rounded-[11px] border bg-surface px-[15px] py-3 shadow-panel transition-[border-color,box-shadow]',
          searching
            ? 'border-brand-300 shadow-[0_0_0_4px_var(--color-brand-50)]'
            : 'border-line focus-within:border-brand-300 focus-within:shadow-[0_0_0_4px_var(--color-brand-50)]',
        )}
      >
        <Search size={19} strokeWidth={2} className="shrink-0 text-brand-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, date of birth, postcode or phone…"
          aria-label="Search patients"
          className="min-w-0 flex-1 bg-transparent text-[15.5px] text-ink outline-none placeholder:text-ink-faint"
        />
        {/* Inline, and only while it applies — see the note at the top of the
            file about the field jumping the page down a line. */}
        {query.trim().length > 0 && !searching ? (
          <span className="hidden shrink-0 whitespace-nowrap font-mono text-[10.5px] text-ink-faint sm:block">
            {SEARCH_MIN_LENGTH - query.trim().length} more character
            {SEARCH_MIN_LENGTH - query.trim().length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {searching ? (
        <div className="absolute inset-x-0 z-20 mt-2 animate-pop overflow-hidden rounded-[11px] border border-line bg-surface shadow-pop">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[14px] text-ink-soft">No patient found for “{query}”.</p>
              <Link href="/patients/new" className="mt-1 inline-block text-[13px] font-medium text-brand-700">
                Create a new record and complete the form with them
              </Link>
            </div>
          ) : (
            results.map(({ patient, matchedOn }) => (
              <Link
                key={patient.id}
                href={`/patients/${patient.id}`}
                className="flex w-full items-center gap-4 border-b border-line-soft px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-sunk"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 font-mono text-[11px] font-medium text-brand-700">
                  {patient.firstName[0]}
                  {patient.lastName[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold text-ink">
                    {patient.firstName} {patient.lastName}
                  </span>
                  <span className="tabular block truncate font-mono text-[11.5px] text-ink-faint">
                    {formatDate(patient.dateOfBirth)} · {ageInYears(patient.dateOfBirth)}y
                    {patient.postcode ? ` · ${patient.postcode}` : ''}
                  </span>
                </span>
                <span className="hidden shrink-0 gap-1.5 sm:flex">
                  {matchedOn.map((m) => (
                    <span
                      key={m}
                      className="rounded-[4px] bg-brand-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-brand-600"
                    >
                      {m}
                    </span>
                  ))}
                </span>
                <ArrowRight size={16} strokeWidth={2} className="shrink-0 text-ink-faint" />
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
