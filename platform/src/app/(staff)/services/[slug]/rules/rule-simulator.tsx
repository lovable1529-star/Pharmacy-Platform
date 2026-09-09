'use client';

/**
 * Trying the rulebook out, before a patient does.
 *
 * Twice in this build a ruleset returned GREEN for a figure no body produces —
 * a BMI of 290,000 from a height typed in metres, and a 90% weight loss from a
 * previous weight of 880kg. Both cleared their eligibility floors honestly:
 * the rules were doing exactly what they said. Both were found by reading the
 * rules by eye, which is not a method that scales to twenty-four of them.
 *
 * So: put values in, see what comes out. Including values that should never
 * occur, because that is where the interesting failures are — a plausible
 * number tells you very little about a rulebook you already believe in.
 *
 * Runs in the browser. The ruleset is already here and `simulate` is pure, so
 * there is nothing to ask a server for; the verdict updates as you type. It
 * calls the same engine production calls, so what it shows is what a patient
 * would get, not an approximation of it.
 */

import { useMemo, useState } from 'react';
import { FlaskConical, RotateCcw, TriangleAlert } from 'lucide-react';
import { simulate, simulatorInputs } from '@/lib/rules/simulate';
import type { RulesetDefinition } from '@/lib/rules/engine';
import { cn } from '@/lib/cn';
import { Panel, PanelHeader, SectionLabel } from '@/components/ui/primitives';

const OUTCOME_STYLE = {
  RED: 'border-stop-200 bg-stop-50 text-stop-700',
  AMBER: 'border-review-200 bg-review-50 text-review-700',
  GREEN: 'border-safe-200 bg-safe-50 text-safe-700',
} as const;

export function RuleSimulator({ definition }: { definition: RulesetDefinition }) {
  const inputs = useMemo(() => simulatorInputs(definition), [definition]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  /*
   * Every field the rules read is passed, not just the ones somebody has typed
   * in. A path absent from this map is a path the simulator never hears about,
   * and it reported "left unanswered (0) — every field has a value" while
   * eighteen of nineteen boxes were empty. Blank has to be stated to count.
   */
  const result = useMemo(
    () => simulate(definition, Object.fromEntries(
      inputs.map((i) => [i.path, values[i.path] ?? '']),
    )),
    [definition, inputs, values],
  );

  const { evaluation, warnings, omitted } = result;
  const matched = evaluation.trace.filter((t) => t.matched);
  const anythingEntered = Object.values(values).some((v) => v.trim() !== '');

  if (inputs.length === 0) return null;

  return (
    <Panel className="mt-4">
      <PanelHeader
        title="Try it"
        icon={<FlaskConical size={15} strokeWidth={2} />}
        action={
          <div className="flex items-center gap-2">
            {anythingEntered ? (
              <button
                type="button"
                onClick={() => setValues({})}
                className="inline-flex items-center gap-1.5 rounded-[6px] border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-200 hover:text-brand-700"
              >
                <RotateCcw size={12} strokeWidth={2.2} />
                Clear
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="rounded-[6px] border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-brand-200 hover:text-brand-700"
            >
              {open ? 'Hide' : 'Open'}
            </button>
          </div>
        }
      />

      {open ? (
        <div className="px-5 pb-5">
          <p className="mb-4 text-[13px] leading-[1.55] text-ink-soft">
            Nothing here is saved. These are the {inputs.length} fields the rules
            actually read. Leave one
            blank to see what happens when a patient does not answer it — a blank
            is treated as unanswered, and any rule needing it is{' '}
            <strong className="font-semibold text-ink">skipped, not passed</strong>.
            Type <span className="font-mono text-[12px]">true</span> or{' '}
            <span className="font-mono text-[12px]">false</span> for a yes/no.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {inputs.map((input) => (
              <label key={input.path} className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">
                  {input.key}
                </span>
                <span className="mb-1.5 block font-mono text-[11px] text-ink-faint">
                  {input.path}
                </span>
                <input
                  type="text"
                  value={values[input.path] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [input.path]: e.target.value }))
                  }
                  placeholder="unanswered"
                  className="w-full rounded-control border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-ink-faint focus:border-brand-400 focus:shadow-[0_0_0_3px_var(--color-brand-50)] focus:outline-none"
                />
              </label>
            ))}
          </div>

          {/*
            Shown but never corrected. A simulator that quietly clamped an absurd
            figure would hide the exact bug this exists to expose.
          */}
          {warnings.length > 0 ? (
            <div className="mt-4 rounded-control border border-review-200 bg-review-50 px-3.5 py-3">
              <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-review-700">
                <TriangleAlert size={14} strokeWidth={2.1} />
                Values a patient could not produce
              </div>
              <ul className="space-y-0.5 text-[12.5px] leading-[1.5] text-review-700">
                {warnings.map((w) => (
                  <li key={w.path}>
                    <span className="font-mono">{w.path}</span> — {w.message}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12.5px] leading-[1.5] text-review-700">
                The verdict below is still what a patient would get. If it is not
                RED, a typo of this size passes triage.
              </p>
            </div>
          ) : null}

          <div className="mt-5 border-t border-line-soft pt-4">
            <SectionLabel>Verdict</SectionLabel>

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  'rounded-control border px-3 py-1.5 font-mono text-[13px] font-semibold uppercase tracking-wide',
                  OUTCOME_STYLE[evaluation.outcome],
                )}
              >
                {evaluation.outcome}
              </span>
              <span className="text-[13px] text-ink-soft">
                {evaluation.decidingRuleId
                  ? `decided by "${matched.find((m) => m.ruleId === evaluation.decidingRuleId)?.label ?? evaluation.decidingRuleId}"`
                  : `nothing matched — the ruleset's default of ${definition.defaultOutcome} stands`}
              </span>
            </div>

            {evaluation.message ? (
              <p className="mt-2.5 text-[13px] leading-[1.55] text-ink-soft">
                <span className="font-medium text-ink">To the pharmacist:</span>{' '}
                {evaluation.message}
              </p>
            ) : null}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <SectionLabel>Matched ({matched.length})</SectionLabel>
                {matched.length === 0 ? (
                  <p className="mt-1.5 text-[12.5px] text-ink-faint">No rule matched.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {matched.map((m) => (
                      <li key={m.ruleId} className="text-[12.5px] leading-[1.45] text-ink-soft">
                        <span
                          className={cn(
                            'mr-1.5 rounded-[4px] border px-1 py-px font-mono text-[9.5px] uppercase',
                            OUTCOME_STYLE[m.outcome],
                          )}
                        >
                          {m.outcome}
                        </span>
                        {m.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <SectionLabel>Left unanswered ({omitted.length})</SectionLabel>
                {omitted.length === 0 ? (
                  <p className="mt-1.5 text-[12.5px] text-ink-faint">
                    Every field has a value.
                  </p>
                ) : (
                  <p className="mt-1.5 font-mono text-[11.5px] leading-[1.55] text-ink-faint">
                    {omitted.join(', ')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
