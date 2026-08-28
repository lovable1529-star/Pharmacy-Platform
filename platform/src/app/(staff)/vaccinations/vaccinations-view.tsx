'use client';

/**
 * Search first, list second.
 *
 * §26.1. The pharmacist is not browsing — someone is standing there and the
 * question is whether their form already exists. So the box has focus, matches
 * on name or date of birth, and the list underneath is what is left when
 * nothing has been typed.
 *
 * Completed vaccinations stay in the results deliberately. "Did Mrs Kelly have
 * hers?" is a question this screen must answer, and a search that quietly
 * excluded finished records would answer it wrongly by saying nothing.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Syringe, CheckCircle2, UserPlus } from 'lucide-react';
import { EmptyState, PageHeader, Panel, Tag } from '@/components/ui/primitives';
import { formatDate } from '@/lib/units';
import type { VaccinationCandidate } from '@/lib/queries/vaccinations';

/** Three characters, matching the Today search — below that everything matches. */
const MIN_QUERY = 3;

function matches(row: VaccinationCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY) return false;

  if (row.patientName.toLowerCase().includes(q)) return true;

  // Date of birth, however they type it: 1974-03-05, 05/03/1974, 05031974.
  if (row.dateOfBirth) {
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4 && row.dateOfBirth.replace(/\D/g, '').includes(digits)) return true;
    if (row.dateOfBirth.includes(q)) return true;
  }

  return false;
}

export function VaccinationsView({
  rows,
  canRecord,
}: {
  rows: VaccinationCandidate[];
  canRecord: boolean;
}) {
  const [query, setQuery] = useState('');
  const searching = query.trim().length >= MIN_QUERY;

  const results = useMemo(
    () => (searching ? rows.filter((r) => matches(r, query)) : rows.slice(0, 25)),
    [rows, query, searching],
  );

  const waiting = rows.filter((r) => !r.alreadyRecorded).length;

  return (
    <div className="page-shell mx-auto max-w-[calc(1080px_+_var(--nav-freed,0px))] animate-rise px-7 pb-11 pt-7">
      <PageHeader
        title="Vaccinations"
        subtitle="Find the patient, check what they told us, then record what was given."
        actions={
          canRecord ? (
            <Link
              href="/patients/new"
              className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              <UserPlus size={14} strokeWidth={2.2} />
              New patient
            </Link>
          ) : null
        }
      />

      <Panel className="mb-4 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5 rounded-control border border-line bg-canvas px-3 py-2.5 transition-[border-color,box-shadow] focus-within:border-brand-300 focus-within:shadow-[0_0_0_3px_var(--color-brand-50)]">
          <Search size={15} strokeWidth={2} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or date of birth"
            aria-label="Search by name or date of birth"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="tabular shrink-0 font-mono text-[11.5px] text-ink-faint">
            {searching
              ? `${results.length} found`
              : `${waiting} waiting`}
          </span>
        </div>
      </Panel>

      {results.length === 0 ? (
        <Panel>
          <EmptyState
            title={searching ? 'Nobody matches that' : 'Nothing to record yet'}
            body={
              searching
                ? 'Try a surname, or the date of birth. If they have never filled a form in, add them as a new patient.'
                : 'Vaccination forms appear here as patients complete them.'
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-2.5">
          {results.map((row) => (
            <Link
              key={row.submissionId}
              href={`/vaccinations/${row.submissionId}`}
              className="block rounded-panel border border-line bg-surface px-5 py-4 shadow-panel transition-[border-color,box-shadow] hover:border-brand-200 hover:shadow-lift"
            >
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15.5px] font-semibold text-ink">{row.patientName}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="tabular font-mono text-[11.5px] text-ink-faint">
                      {row.dateOfBirth ? formatDate(row.dateOfBirth) : 'No date of birth'}
                    </span>
                    <Tag tone="neutral">{row.serviceName}</Tag>
                    {row.submittedAt ? (
                      <span className="tabular font-mono text-[11.5px] text-ink-faint">
                        {formatDate(row.submittedAt)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0">
                  {row.alreadyRecorded ? (
                    <Tag tone="safe">
                      <CheckCircle2 size={10} strokeWidth={2.4} /> given
                    </Tag>
                  ) : (
                    <Tag tone="brand">
                      <Syringe size={10} strokeWidth={2.4} /> ready to give
                    </Tag>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
