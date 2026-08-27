'use client';

/**
 * Search-first patient workspace.
 *
 * The client's clearest complaint about the Zoho build was *"it's unclear where
 * the pharmacist needs to go."* The answer is this screen. It opens focused on a
 * single search box, because nearly every task starts by finding a patient.
 *
 * Deliberate behaviours:
 *   - one box accepts a name, a date of birth, a phone number or a postcode
 *   - searching waits for 3 characters and debounces, to keep query volume (and
 *     therefore the Supabase bill) down
 *   - "New patient" is always available, and runs duplicate detection before
 *     creating anything
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SEARCH_DEBOUNCE_MS, shouldSearch } from '@/lib/performance';
import { ageInYears, type ScoredPatient, type PatientRecord } from '@/lib/patients/search';

function formatDob(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Highlights the fields that caused a match, so ranking is legible. */
function MatchBadge({ field }: { field: string }) {
  const labels: Record<string, string> = {
    firstName: 'first name',
    lastName: 'surname',
    dateOfBirth: 'date of birth',
    phone: 'phone',
    postcode: 'postcode',
  };
  return (
    <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700">
      {labels[field] ?? field}
    </span>
  );
}

export function PatientSearch({
  onSearch,
  onSelect,
  onCreateNew,
}: {
  onSearch: (query: string) => Promise<ScoredPatient<PatientRecord>[]>;
  onSelect: (patientId: string) => void;
  onCreateNew: (query: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ScoredPatient<PatientRecord>[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'done'>('idle');
  const [highlighted, setHighlighted] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Guards against an older, slower response overwriting a newer one. */
  const requestId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(
    async (value: string) => {
      if (!shouldSearch(value)) {
        setResults([]);
        setStatus('idle');
        return;
      }

      const id = ++requestId.current;
      setStatus('searching');

      const found = await onSearch(value);
      if (id !== requestId.current) return; // A newer search has superseded this one.

      setResults(found);
      setHighlighted(0);
      setStatus('done');
    },
    [onSearch],
  );

  function handleChange(value: string) {
    setQuery(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void runSearch(value), SEARCH_DEBOUNCE_MS);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = results[highlighted];
      if (selected) onSelect(selected.patient.id);
    }
  }

  const empty = status === 'done' && results.length === 0;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl">Find a patient</h1>
      <p className="mb-5 text-sm text-ink-soft">
        Search by name, date of birth, phone number or postcode. You do not need all of them.
      </p>

      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Kelly, or 05/03/1974"
          aria-label="Search patients"
          aria-describedby="search-hint"
          className="w-full rounded-xl border-2 border-line bg-surface px-4 py-3.5 text-lg focus:border-brand-600"
        />
        {status === 'searching' && (
          <span className="absolute right-4 top-4 text-sm text-ink-soft" role="status">
            Searching…
          </span>
        )}
      </div>

      <p id="search-hint" className="mt-2 text-xs text-ink-soft">
        Type at least three letters. Use the arrow keys and Enter to select.
      </p>

      {/* Screen readers need the result count announced, not just rendered. */}
      <div aria-live="polite" className="sr-only">
        {status === 'done' ? `${results.length} patients found` : ''}
      </div>

      {results.length > 0 && (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {results.map((result, index) => (
            <li key={result.patient.id}>
              <button
                type="button"
                onClick={() => onSelect(result.patient.id)}
                onMouseEnter={() => setHighlighted(index)}
                className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left ${
                  index === highlighted ? 'bg-brand-50' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {result.patient.firstName} {result.patient.lastName}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                    <span className="font-mono">{formatDob(result.patient.dateOfBirth)}</span>
                    <span>· {ageInYears(result.patient.dateOfBirth)} years</span>
                    {result.patient.postcode && <span>· {result.patient.postcode}</span>}
                  </span>
                </span>
                <span className="flex flex-none gap-1">
                  {result.matched.map((field) => (
                    <MatchBadge key={field} field={field} />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {empty && (
        <div className="mt-4 rounded-card border border-dashed border-brand-300 bg-brand-50 p-6 text-center">
          <p className="mb-1 font-semibold">No patient found</p>
          <p className="mb-4 text-sm text-ink-soft">
            Check the spelling, or add them as a new patient.
          </p>
          <button
            type="button"
            onClick={() => onCreateNew(query)}
            className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Add new patient
          </button>
        </div>
      )}

      {status === 'idle' && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => onCreateNew('')}
            className="text-sm font-semibold text-brand-600 underline-offset-4 hover:underline"
          >
            Or add a new patient
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Duplicate warning shown before a new patient is created.
 *
 * Suggests, never merges. Duplicates are a real clinical risk — half the allergy
 * history in one record, half in the other — but auto-merging two people who
 * happen to share a name and birthday is worse.
 */
export function DuplicateWarning({
  candidates,
  onUseExisting,
  onCreateAnyway,
}: {
  candidates: { patient: PatientRecord; confidence: 'high' | 'medium' | 'low'; reasons: string[] }[];
  onUseExisting: (patientId: string) => void;
  onCreateAnyway: () => void;
}) {
  if (candidates.length === 0) return null;

  const tone = {
    high: 'border-triage-amber-700 bg-triage-amber-100',
    medium: 'border-brand-300 bg-brand-50',
    low: 'border-line bg-canvas',
  };

  return (
    <section
      aria-labelledby="duplicate-heading"
      className="rounded-card border border-triage-amber-700 bg-triage-amber-100 p-5"
    >
      <h2 id="duplicate-heading" className="mb-1 text-base">
        This patient may already exist
      </h2>
      <p className="mb-4 text-sm text-ink-soft">
        Creating a second record splits their history. Use an existing record where you can.
      </p>

      <ul className="mb-4 space-y-2">
        {candidates.map(({ patient, confidence, reasons }) => (
          <li key={patient.id} className={`rounded-lg border p-3 ${tone[confidence]}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">
                  {patient.firstName} {patient.lastName}
                </div>
                <div className="font-mono text-xs text-ink-soft">{formatDob(patient.dateOfBirth)}</div>
                <div className="mt-1 text-xs text-ink-soft">{reasons.join(' · ')}</div>
              </div>
              <button
                type="button"
                onClick={() => onUseExisting(patient.id)}
                className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Use this record
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onCreateAnyway}
        className="text-sm font-semibold text-brand-700 underline underline-offset-4"
      >
        None of these — create a new record
      </button>
    </section>
  );
}
