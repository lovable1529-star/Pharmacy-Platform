'use client';

/**
 * Pick the patient, then fill in their questionnaire.
 *
 * The questionnaire itself is the patient's own form, opened with a resume
 * token, rather than a staff-only copy. §6.5 asks for "the same clinical
 * information", and the cheapest way to guarantee sameness is for it to be
 * literally the same form: a parallel staff version would drift the first time
 * the questionnaire changed, and nobody would notice until two patients had
 * been asked different questions about the same medicine.
 *
 * The search matches the ways staff actually identify somebody at a counter —
 * surname, date of birth, or the Repeat Care ID printed on their paperwork.
 */

import { useMemo, useState } from 'react';
import { Search, ArrowRight, AlertTriangle, UserRound } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmptyState, PageHeader, Panel, Tag } from '@/components/ui/primitives';
import { formatDate } from '@/lib/units';
import { startInternalRequest, type EnrolledPatient } from './actions';

function matches(p: EnrolledPatient, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (p.name.toLowerCase().includes(q)) return true;
  if ((p.externalRef ?? '').toLowerCase().includes(q)) return true;

  const digits = q.replace(/\D/g, '');
  if (digits.length >= 4 && p.dateOfBirth.replace(/\D/g, '').includes(digits)) return true;

  return false;
}

export function InternalRequestForm({
  patients,
  branchId,
  companyId,
}: {
  patients: EnrolledPatient[];
  branchId: string;
  companyId: string | null;
}) {
  const [query, setQuery] = useState('');
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(
    () => patients.filter((p) => matches(p, query)).slice(0, 40),
    [patients, query],
  );

  async function start(p: EnrolledPatient) {
    setBusyFor(p.patientId);
    setError(null);

    const result = await startInternalRequest({
      patientId: p.patientId,
      serviceId: p.serviceId,
      branchId,
      companyId,
    });

    if (!result.ok) {
      setError(result.error);
      setBusyFor(null);
      return;
    }

    // Straight into the questionnaire the patient would have filled in. A full
    // navigation, because it is a different part of the app.
    window.location.href = `/f/${p.serviceSlug}?s=${result.token}`;
  }

  return (
    <>
      <PageHeader
        title="Repeat request on their behalf"
        subtitle="For a patient who has come in rather than filled the form in at home. It records the same supply entry either way."
      />

      <Panel className="mb-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5 rounded-control border border-line bg-canvas px-3 py-2.5 transition-[border-color,box-shadow] focus-within:border-brand-300 focus-within:shadow-[0_0_0_3px_var(--color-brand-50)]">
          <Search size={15} strokeWidth={2} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, date of birth, or Repeat Care ID"
            aria-label="Find a patient on repeat care"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="tabular shrink-0 font-mono text-[11.5px] text-ink-faint">
            {results.length}
          </span>
        </div>
      </Panel>

      {error ? (
        <div className="mb-4 flex items-start gap-2 rounded-control border border-stop-200 bg-stop-50 px-3.5 py-2.5">
          <AlertTriangle size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-stop-600" />
          <p className="text-[13px] text-stop-700">{error}</p>
        </div>
      ) : null}

      {patients.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nobody is on repeat care yet"
            body="A pharmacist enrols a patient from their record after an initial consultation and a first follow-up."
          />
        </Panel>
      ) : results.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nobody matches"
            body="Only patients with an active repeat care enrolment appear here. Somebody paused or stopped has been taken off the pathway deliberately."
          />
        </Panel>
      ) : (
        <div className="grid gap-2.5">
          {results.map((p) => (
            <Panel key={p.enrolmentId} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <UserRound size={16} strokeWidth={2} className="shrink-0 text-ink-faint" />

                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold text-ink">{p.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="tabular font-mono text-[11.5px] text-ink-faint">
                      {formatDate(p.dateOfBirth)}
                    </span>
                    {p.externalRef ? (
                      <span className="tabular font-mono text-[11.5px] text-ink-faint">
                        {p.externalRef}
                      </span>
                    ) : null}
                    <Tag tone="neutral">{p.serviceName}</Tag>
                    {p.medicine && p.strength ? (
                      <span className="text-[12.5px] text-ink-soft">
                        currently {p.medicine} {p.strength}
                      </span>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busyFor !== null}
                  onClick={() => start(p)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700',
                    busyFor !== null && 'cursor-not-allowed opacity-45',
                  )}
                >
                  {busyFor === p.patientId ? 'Opening…' : 'Start'}
                  {busyFor === p.patientId ? null : <ArrowRight size={14} strokeWidth={2.2} />}
                </button>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <p className="mt-5 text-[12.5px] text-ink-faint">
        This opens the same questionnaire the patient would fill in, so the
        triage rules, the dose limits and the consent wording are identical.
        Anything you add is recorded as having been captured by you.
      </p>
    </>
  );
}
