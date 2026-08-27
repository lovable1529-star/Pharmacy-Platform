'use client';

/**
 * Safety panel and triage display.
 *
 * These two components carry the clinical weight of the interface, so their
 * rules are stricter than ordinary UI:
 *
 *   - A BLOCK cannot be dismissed. The proceed button is genuinely disabled, not
 *     styled to look disabled.
 *   - A WARN requires a deliberate tick. Acknowledgement is recorded with the
 *     pharmacist's name against the consultation.
 *   - Colour never carries meaning alone. Every state has a text label, because
 *     roughly one in twelve men has a colour vision deficiency and this is a
 *     safety surface.
 */

import { useState } from 'react';
import type { SafetyFinding, SafetyResult } from '@/lib/clinical/safety';
import type { EvaluationResult, Outcome } from '@/types/rule-schema';

const SEVERITY_STYLE = {
  BLOCK: {
    container: 'border-triage-red-700 bg-triage-red-100',
    label: 'Stop',
    labelClass: 'bg-triage-red-700 text-white',
  },
  WARN: {
    container: 'border-triage-amber-700 bg-triage-amber-100',
    label: 'Check',
    labelClass: 'bg-triage-amber-700 text-white',
  },
  INFO: {
    container: 'border-line bg-canvas',
    label: 'Note',
    labelClass: 'bg-ink-soft text-white',
  },
} as const;

export function SafetyPanel({
  result,
  onAcknowledge,
}: {
  result: SafetyResult;
  onAcknowledge?: (acknowledged: boolean) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  if (result.findings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-clinical-green-600 bg-clinical-green-100 px-4 py-3 text-sm text-clinical-green-700">
        <span className="font-semibold">All checks passed.</span>
        <span>No allergy conflicts, batch valid, stock available.</span>
      </div>
    );
  }

  return (
    <section aria-labelledby="safety-heading" className="space-y-2">
      <h2 id="safety-heading" className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
        Safety checks
      </h2>

      {result.findings.map((finding: SafetyFinding, index) => {
        const style = SEVERITY_STYLE[finding.severity];
        return (
          <div
            key={`${finding.code}-${index}`}
            role={finding.severity === 'BLOCK' ? 'alert' : 'status'}
            className={`rounded-card border p-4 ${style.container}`}
          >
            <div className="flex items-start gap-3">
              {/* Text label, not just colour. */}
              <span
                className={`flex-none rounded px-2 py-0.5 text-[11px] font-bold uppercase ${style.labelClass}`}
              >
                {style.label}
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{finding.message}</p>
                {finding.detail && <p className="mt-1 text-sm text-ink-soft">{finding.detail}</p>}
              </div>
            </div>
          </div>
        );
      })}

      {result.requiresAcknowledgement && result.canProceed && (
        <label className="flex cursor-pointer items-start gap-3 rounded-card border border-line bg-surface p-4">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => {
              setAcknowledged(e.target.checked);
              onAcknowledge?.(e.target.checked);
            }}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-sm">
            I have reviewed the warnings above and confirm it is appropriate to proceed.
            <span className="mt-0.5 block text-xs text-ink-soft">
              This is recorded against the consultation with your name.
            </span>
          </span>
        </label>
      )}

      {!result.canProceed && (
        <p className="text-sm font-semibold text-triage-red-700">
          This cannot proceed until the issues above are resolved.
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────

const OUTCOME_STYLE: Record<Outcome, { label: string; container: string; badge: string }> = {
  GREEN: {
    label: 'No concerns flagged',
    container: 'border-clinical-green-600 bg-clinical-green-100',
    badge: 'bg-clinical-green-700 text-white',
  },
  AMBER: {
    label: 'Needs your review',
    container: 'border-triage-amber-700 bg-triage-amber-100',
    badge: 'bg-triage-amber-700 text-white',
  },
  RED: {
    label: 'Do not supply',
    container: 'border-triage-red-700 bg-triage-red-100',
    badge: 'bg-triage-red-700 text-white',
  },
};

/**
 * Triage outcome with its full reasoning.
 *
 * The trace is expandable rather than hidden. A pharmacist asked to confirm a
 * decision must be able to see exactly which rules fired and why — a black box
 * that says "GREEN" is not something anyone should sign their registration
 * number against.
 *
 * Note the GREEN wording: "no concerns flagged", never "approved". The system
 * triages; the pharmacist decides. See docs/modules/decision-engine.md.
 */
export function TriageOutcome({
  evaluation,
  showTrace = false,
}: {
  evaluation: EvaluationResult;
  showTrace?: boolean;
}) {
  const [expanded, setExpanded] = useState(showTrace);
  const style = OUTCOME_STYLE[evaluation.outcome];
  const firedRules = evaluation.trace.filter((entry) => entry.matched);

  return (
    <section aria-labelledby="triage-heading" className={`rounded-card border p-5 ${style.container}`}>
      <div className="mb-3 flex items-center gap-3">
        <span className={`rounded px-2.5 py-1 font-mono text-xs font-bold ${style.badge}`}>
          {evaluation.outcome}
        </span>
        <h2 id="triage-heading" className="text-base">
          {style.label}
        </h2>
      </div>

      {evaluation.message && <p className="mb-3 font-semibold">{evaluation.message}</p>}

      {evaluation.advice.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Advice for the patient
          </h3>
          <ul className="space-y-1 text-sm">
            {evaluation.advice.map((item, index) => (
              <li key={index} className="flex gap-2">
                <span aria-hidden>·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="text-sm font-semibold text-brand-700 underline underline-offset-4"
      >
        {expanded ? 'Hide reasoning' : `Why? (${firedRules.length} of ${evaluation.trace.length} rules matched)`}
      </button>

      {expanded && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-4">
          {Object.keys(evaluation.derived).length > 0 && (
            <div className="mb-4">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Values used
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                {Object.entries(evaluation.derived).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs text-ink-soft">{key}</dt>
                    <dd className="font-mono font-semibold">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Rules evaluated
          </h3>
          <ol className="space-y-1">
            {evaluation.trace.map((entry) => (
              <li
                key={entry.ruleId}
                className={`flex items-baseline justify-between gap-3 rounded px-2 py-1 text-sm ${
                  entry.matched ? 'bg-brand-50 font-semibold' : 'text-ink-soft'
                }`}
              >
                <span className="min-w-0">
                  <span className="truncate">{entry.label}</span>
                  {entry.skippedReason && (
                    <span className="ml-2 text-xs italic">({entry.skippedReason})</span>
                  )}
                </span>
                <span className="flex-none font-mono text-[11px]">
                  {entry.matched ? entry.outcome : 'no match'}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/**
 * Confirmation control for a triaged request.
 *
 * Present on every outcome including GREEN. There is deliberately no
 * "auto-approve" path — see CLAUDE.md §3. This is the control that keeps the
 * product outside medical device regulation.
 */
export function ClinicianConfirmation({
  outcome,
  onConfirm,
  onDecline,
  disabled,
}: {
  outcome: Outcome;
  onConfirm: (note?: string) => void;
  onDecline: (reason: string) => void;
  disabled?: boolean;
}) {
  const [note, setNote] = useState('');
  const [declining, setDeclining] = useState(false);

  if (outcome === 'RED') {
    return (
      <div className="rounded-card border border-line bg-surface p-5">
        <p className="mb-3 text-sm">
          This request cannot be supplied. The patient has been asked to book an appointment.
        </p>
        <label className="mb-2 block text-sm font-semibold" htmlFor="red-note">
          Add a note (optional)
        </label>
        <textarea
          id="red-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mb-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
          rows={3}
        />
        <button
          type="button"
          onClick={() => onDecline(note || 'Blocked by clinical rules')}
          className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white"
        >
          Record and notify patient
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <p className="mb-3 text-sm text-ink-soft">
        The system has checked this request against your clinical rules. The decision to supply is
        yours.
      </p>

      <label className="mb-2 block text-sm font-semibold" htmlFor="confirm-note">
        Clinical note {outcome === 'AMBER' ? '(required)' : '(optional)'}
      </label>
      <textarea
        id="confirm-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        className="mb-4 w-full rounded-lg border border-line px-3 py-2 text-sm"
        placeholder={outcome === 'AMBER' ? 'Record why you are approving or declining' : ''}
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={disabled || (outcome === 'AMBER' && note.trim().length === 0)}
          onClick={() => onConfirm(note || undefined)}
          className="rounded-full bg-clinical-green-600 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Confirm and issue
        </button>
        <button
          type="button"
          onClick={() => setDeclining(true)}
          className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold"
        >
          Decline
        </button>
      </div>

      {declining && (
        <div className="mt-4 rounded-lg border border-line p-3">
          <p className="mb-2 text-sm font-semibold">Why are you declining?</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mb-2 w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={note.trim().length === 0}
            onClick={() => onDecline(note)}
            className="rounded-full bg-triage-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Confirm decline
          </button>
        </div>
      )}
    </div>
  );
}
