'use client';

/**
 * Repeat care review queue.
 *
 * Every outstanding request is triaged live through the real decision engine —
 * nothing is precomputed or faked. The outcomes you see are produced by
 * `evaluateRuleset` running over values from `deriveValues`, the same code paths
 * that would run in production.
 *
 * Note the framing throughout: GREEN reads "no concerns flagged", never
 * "approved", and every outcome including GREEN requires a pharmacist to
 * confirm. See docs/modules/decision-engine.md for why that matters.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { TriageOutcome, ClinicianConfirmation } from '@/components/clinical/safety-panel';
import { REPEAT_REQUESTS } from '@/lib/demo/data';
import { evaluateRuleset } from '@/lib/rules/engine';
import { GLP1_REPEAT_RULESET } from '@/lib/rules/glp1-ruleset';
import { deriveValues, derivationWarnings } from '@/lib/clinical/derived';
import type { Outcome } from '@/types/rule-schema';

const OUTCOME_ORDER: Record<Outcome, number> = { RED: 0, AMBER: 1, GREEN: 2 };

const BADGE: Record<Outcome, string> = {
  RED: 'bg-triage-red-700 text-white',
  AMBER: 'bg-triage-amber-700 text-white',
  GREEN: 'bg-clinical-green-700 text-white',
};

export default function RepeatCarePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, string>>({});

  const triaged = useMemo(
    () =>
      REPEAT_REQUESTS.map((request) => {
        const derived = deriveValues({
          medicine: request.medicine,
          currentStrength: request.currentStrength,
          requestedStrength: request.requestedStrength,
          weightKg: request.weightKg,
          heightCm: request.heightCm,
          dateOfBirth: request.dateOfBirth,
          previousSupplies: request.previousSupplies,
        });

        const evaluation = evaluateRuleset(GLP1_REPEAT_RULESET, {
          answers: request.answers,
          derived: { ...derived },
        });

        return { request, derived, evaluation, warnings: derivationWarnings(derived) };
      }).sort((a, b) => OUTCOME_ORDER[a.evaluation.outcome] - OUTCOME_ORDER[b.evaluation.outcome]),
    [],
  );

  const selected = triaged.find((t) => t.request.id === selectedId);

  const counts = triaged.reduce(
    (acc, t) => ({ ...acc, [t.evaluation.outcome]: (acc[t.evaluation.outcome] ?? 0) + 1 }),
    {} as Record<Outcome, number>,
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl">Repeat care</h1>
          <p className="text-sm text-ink-soft">
            Requests are sorted so the concerning ones come first. You decide every supply.
          </p>
        </div>
        <Link href="/repeat-care/rules"
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold">
          Clinical rules
        </Link>
      </div>

      <div className="mb-5 flex gap-2">
        {(['RED', 'AMBER', 'GREEN'] as Outcome[]).map((outcome) => (
          <div key={outcome} className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm">
            <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold ${BADGE[outcome]}`}>
              {outcome}
            </span>
            <span className="font-semibold">{counts[outcome] ?? 0}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <ul className="space-y-2">
          {triaged.map(({ request, evaluation }) => (
            <li key={request.id}>
              <button type="button" onClick={() => setSelectedId(request.id)}
                className={`w-full rounded-card border p-4 text-left ${
                  selectedId === request.id ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface'
                }`}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{request.patientName}</span>
                  <span className={`flex-none rounded px-2 py-0.5 font-mono text-[11px] font-bold ${BADGE[evaluation.outcome]}`}>
                    {evaluation.outcome}
                  </span>
                </div>
                <div className="text-xs text-ink-soft">
                  {request.medicine} {request.currentStrength}
                  {request.requestedStrength !== request.currentStrength && (
                    <span className="font-semibold text-ink"> → {request.requestedStrength}</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-ink-soft">
                  {request.submittedAt.toLocaleDateString('en-GB')}
                  {decided[request.id] && (
                    <span className="ml-2 font-semibold text-clinical-green-700">
                      · {decided[request.id]}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div>
          {!selected ? (
            <div className="rounded-card border border-dashed border-line p-12 text-center text-sm text-ink-soft">
              Select a request to review it.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-card border border-line bg-surface p-5">
                <h2 className="mb-3 text-base">{selected.request.patientName}</h2>
                <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                  <div className="flex gap-3"><dt className="w-32 text-ink-soft">Medicine</dt><dd className="font-semibold">{selected.request.medicine}</dd></div>
                  <div className="flex gap-3"><dt className="w-32 text-ink-soft">Currently on</dt><dd className="font-semibold">{selected.request.currentStrength}</dd></div>
                  <div className="flex gap-3"><dt className="w-32 text-ink-soft">Requesting</dt><dd className="font-semibold">{selected.request.requestedStrength}</dd></div>
                  <div className="flex gap-3"><dt className="w-32 text-ink-soft">Weight</dt><dd className="font-semibold">{selected.request.weightKg} kg</dd></div>
                  <div className="flex gap-3"><dt className="w-32 text-ink-soft">Supplies to date</dt><dd className="font-semibold">{selected.derived.suppliesToDate}</dd></div>
                  <div className="flex gap-3"><dt className="w-32 text-ink-soft">Weeks on dose</dt><dd className="font-semibold">{selected.derived.weeksOnCurrentDose ?? '—'}</dd></div>
                </dl>

                {selected.request.answers.patientQuestion ? (
                  <div className="mt-4 rounded-lg border-l-[3px] border-triage-amber-700 bg-triage-amber-100 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-triage-amber-700">
                      The patient asked a question
                    </p>
                    <p className="mt-1 text-sm">{String(selected.request.answers.patientQuestion)}</p>
                  </div>
                ) : null}

                {selected.warnings.length > 0 && (
                  <div className="mt-4 rounded-lg border border-line bg-canvas p-3">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-soft">
                      Could not be verified automatically
                    </p>
                    <ul className="list-inside list-disc text-sm text-ink-soft">
                      {selected.warnings.map((w) => <li key={w}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              <TriageOutcome evaluation={selected.evaluation} />

              <ClinicianConfirmation
                outcome={selected.evaluation.outcome}
                onConfirm={() =>
                  setDecided((d) => ({ ...d, [selected.request.id]: 'Confirmed' }))
                }
                onDecline={() =>
                  setDecided((d) => ({ ...d, [selected.request.id]: 'Declined' }))
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
