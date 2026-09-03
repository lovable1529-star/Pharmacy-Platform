'use client';

/**
 * Tuning the clinical rules.
 *
 * Edits accumulate and publish together as ONE new version. Saving each rule
 * on its own would put six versions in the history for one afternoon's work
 * and make "what changed, and why" unanswerable — which is the question the
 * version history exists to answer.
 *
 * Read-only until somebody opens a rule. This screen is read far more often
 * than it is edited: a pharmacist checking why a request came back amber wants
 * to read the rulebook, not be presented with a form.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, ChevronRight, RotateCcw, TriangleAlert } from 'lucide-react';
import { publishRuleChanges } from './actions';
import {
  addressLeaves, editProblems, OUTCOMES, type RuleEdit,
} from '@/lib/rules/edit';
import { byOutcome, describeCondition, type RuleCoverage } from '@/lib/rules/coverage';
import type { Outcome, RulesetDefinition } from '@/lib/rules/engine';
import { Notice, Panel, Tag } from '@/components/ui/primitives';

const OUTCOME_TONE = { RED: 'stop', AMBER: 'review', GREEN: 'safe' } as const;

const OUTCOME_MEANING = {
  RED: 'Cannot be supplied on the form alone. A pharmacist has to act.',
  AMBER: 'A pharmacist reads it and decides.',
  GREEN: 'Nothing flagged — authorise and supply.',
} as const;

const inputClass =
  'rounded-control border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink '
  + 'outline-none transition-colors focus:border-brand-400';

const labelClass = 'block font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint';

/** One rule's pending changes, keyed by rule id. */
type Pending = Record<string, RuleEdit>;

function pathKey(path: number[]): string {
  return path.join('.');
}

export function RulesClient({
  definition, coverage, serviceId, version, editable,
}: {
  definition: RulesetDefinition;
  coverage: RuleCoverage[];
  serviceId: string;
  version: number;
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ version: number; summary: string[] } | null>(null);

  const edits = Object.values(pending);
  const problems = editProblems(definition, edits);
  const changedCount = edits.length;

  function patch(ruleId: string, change: Partial<RuleEdit>) {
    setPublished(null);
    setPending((previous) => {
      const next = { ...previous };
      const existing = next[ruleId] ?? { ruleId };
      next[ruleId] = { ...existing, ...change };
      return next;
    });
  }

  function patchValue(ruleId: string, path: number[], value: unknown, isRange = false) {
    setPublished(null);
    setPending((previous) => {
      const existing = previous[ruleId] ?? { ruleId };
      const others = (existing.conditionValues ?? [])
        .filter((c) => pathKey(c.path) !== pathKey(path));

      return {
        ...previous,
        [ruleId]: {
          ...existing,
          conditionValues: [
            ...others,
            isRange
              ? { path, range: value as [number, number] }
              : { path, value },
          ],
        },
      };
    });
  }

  function discard() {
    setPending({});
    setError(null);
    setPublished(null);
  }

  async function publish() {
    if (problems.length > 0) { setError(problems.join(' ')); return; }

    setBusy(true);
    setError(null);

    const result = await publishRuleChanges({ serviceId, baseVersion: version, edits });

    setBusy(false);
    if (!result.ok) { setError(result.error); return; }

    setPending({});
    setPublished({ version: result.version, summary: result.summary });
    router.refresh();
  }

  return (
    <>
      {published ? (
        <Notice tone="safe" className="mb-4" title={`Published rules v${published.version}`}>
          {published.summary.length > 0 ? (
            <ul className="mt-0.5 list-disc pl-4">
              {published.summary.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : (
            'Nothing had changed, so no new version was created.'
          )}
        </Notice>
      ) : null}

      <div className="grid gap-5">
        {byOutcome(coverage).map((group) => (
          <section key={group.outcome}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <Tag tone={OUTCOME_TONE[group.outcome]}>{group.outcome}</Tag>
              <span className="text-[13px] text-ink-faint">
                {OUTCOME_MEANING[group.outcome]}
              </span>
              <span className="tabular ml-auto font-mono text-[11.5px] text-ink-faint">
                {group.rules.length} {group.rules.length === 1 ? 'rule' : 'rules'}
              </span>
            </div>

            <div className="grid gap-2">
              {group.rules.map((rule) => {
                const source = definition.rules.find((r) => r.id === rule.ruleId);
                if (!source) return null;

                const edit = pending[rule.ruleId];
                const dirty = edit !== undefined;
                const expanded = open === rule.ruleId;
                const leaves = addressLeaves(source.when);

                const outcome = edit?.outcome ?? source.outcome;
                const enabled = edit?.enabled ?? source.enabled !== false;

                return (
                  <Panel
                    key={rule.ruleId}
                    className={`px-5 py-[13px] ${
                      rule.broken ? 'border-stop-200 bg-stop-50/40'
                        : dirty ? 'border-brand-300 bg-brand-50/30' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : rule.ruleId)}
                        aria-expanded={expanded}
                        className="mt-[3px] shrink-0 text-ink-faint transition-colors hover:text-ink"
                      >
                        {expanded
                          ? <ChevronDown size={14} strokeWidth={2.2} />
                          : <ChevronRight size={14} strokeWidth={2.2} />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <h3 className={`text-[14.5px] font-semibold ${enabled ? 'text-ink' : 'text-ink-faint line-through'}`}>
                          {rule.label}
                        </h3>

                        <p className="mt-1 text-[13px] leading-[1.5] text-ink-soft">
                          when <span className="text-ink">{describeCondition(source.when)}</span>
                        </p>

                        {source.message ? (
                          <p className="mt-1 text-[12.5px] italic leading-[1.5] text-ink-faint">
                            Staff see: {source.message}
                          </p>
                        ) : null}

                        {rule.broken ? (
                          <p className="mt-1.5 text-[12.5px] font-medium text-stop-700">
                            Never matches — the form does not ask{' '}
                            <span className="font-mono">
                              {rule.dependencies.filter((d) => d.status === 'missing')
                                .map((d) => d.key).join(', ')}
                            </span>
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {dirty ? <Tag tone="brand">edited</Tag> : null}
                        {!enabled ? <Tag tone="neutral">off</Tag> : null}
                        <span
                          className="tabular font-mono text-[11px] text-ink-faint"
                          title="Higher is considered first among equally severe matches"
                        >
                          p{edit?.priority ?? source.priority}
                        </span>
                      </div>
                    </div>

                    {expanded && editable ? (
                      <div className="mt-3.5 grid gap-3 border-t border-line-soft pt-3.5">
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <span className={labelClass}>Decides</span>
                            <div className="mt-1 flex gap-1.5">
                              {OUTCOMES.map((o) => (
                                <button
                                  key={o}
                                  type="button"
                                  onClick={() => patch(rule.ruleId, { outcome: o as Outcome })}
                                  aria-pressed={outcome === o}
                                  className={`rounded-control border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
                                    outcome === o
                                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                                      : 'border-line bg-surface text-ink-soft hover:text-ink'
                                  }`}
                                >
                                  {o}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className={labelClass} htmlFor={`p-${rule.ruleId}`}>
                              Priority
                            </label>
                            <input
                              id={`p-${rule.ruleId}`}
                              type="number"
                              className={`${inputClass} tabular mt-1 w-[92px]`}
                              value={edit?.priority ?? source.priority}
                              onChange={(e) =>
                                patch(rule.ruleId, { priority: Number.parseInt(e.target.value, 10) })}
                            />
                          </div>

                          <label className="flex items-center gap-2 pb-1.5 text-[13px] text-ink-soft">
                            <input
                              type="checkbox"
                              className="h-[15px] w-[15px] accent-[var(--brand-600)]"
                              checked={enabled}
                              onChange={(e) => patch(rule.ruleId, { enabled: e.target.checked })}
                            />
                            Rule is on
                          </label>
                        </div>

                        {/*
                          Values only. Changing "BMI under 23" to "BMI under 25"
                          is tuning a pharmacist can do; rewriting the shape of
                          the condition is a different act and is not offered
                          here — see lib/rules/edit.ts.
                        */}
                        {leaves.length > 0 ? (
                          <div>
                            <span className={labelClass}>Thresholds</span>
                            <div className="mt-1 grid gap-2">
                              {leaves.map(({ path, leaf }) => {
                                const key = pathKey(path);
                                const staged = edit?.conditionValues
                                  ?.find((c) => pathKey(c.path) === key);

                                if (leaf.op === 'exists' || leaf.op === 'notExists') {
                                  return (
                                    <p key={key} className="text-[12.5px] text-ink-faint">
                                      {describeCondition(leaf)} — nothing to set
                                    </p>
                                  );
                                }

                                if (leaf.op === 'between') {
                                  const range = (staged?.range ?? leaf.range ?? [0, 0]) as [number, number];
                                  return (
                                    <div key={key} className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft">
                                      <span className="min-w-[130px]">{describeCondition({ ...leaf, range })}</span>
                                      <input
                                        type="number" step="any"
                                        className={`${inputClass} tabular w-[88px]`}
                                        value={range[0]}
                                        onChange={(e) => patchValue(rule.ruleId, path,
                                          [Number(e.target.value), range[1]], true)}
                                      />
                                      <span>to</span>
                                      <input
                                        type="number" step="any"
                                        className={`${inputClass} tabular w-[88px]`}
                                        value={range[1]}
                                        onChange={(e) => patchValue(rule.ruleId, path,
                                          [range[0], Number(e.target.value)], true)}
                                      />
                                    </div>
                                  );
                                }

                                const current = staged?.value ?? leaf.value;

                                if (Array.isArray(current)) {
                                  return (
                                    <div key={key} className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft">
                                      <span className="min-w-[130px]">
                                        {leaf.field.split('.').slice(1).join('.')} is one of
                                      </span>
                                      <input
                                        className={`${inputClass} min-w-[220px] flex-1`}
                                        value={current.join(', ')}
                                        onChange={(e) => patchValue(rule.ruleId, path,
                                          e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
                                      />
                                    </div>
                                  );
                                }

                                const numeric = typeof (leaf.value ?? current) === 'number';

                                return (
                                  <div key={key} className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft">
                                    <span className="min-w-[130px]">
                                      {describeCondition({ ...leaf, value: current })}
                                    </span>
                                    <input
                                      type={numeric ? 'number' : 'text'}
                                      step="any"
                                      className={`${inputClass} ${numeric ? 'tabular w-[110px]' : 'min-w-[180px] flex-1'}`}
                                      value={String(current ?? '')}
                                      onChange={(e) => patchValue(rule.ruleId, path,
                                        numeric ? Number(e.target.value) : e.target.value)}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        <div>
                          <label className={labelClass} htmlFor={`m-${rule.ruleId}`}>
                            What staff see
                          </label>
                          <input
                            id={`m-${rule.ruleId}`}
                            className={`${inputClass} mt-1 w-full`}
                            value={edit?.message ?? source.message ?? ''}
                            onChange={(e) => patch(rule.ruleId, { message: e.target.value })}
                            placeholder="Optional"
                          />
                        </div>

                        <div>
                          <label className={labelClass} htmlFor={`pm-${rule.ruleId}`}>
                            What the patient sees
                          </label>
                          <input
                            id={`pm-${rule.ruleId}`}
                            className={`${inputClass} mt-1 w-full`}
                            value={edit?.patientMessage ?? source.patientMessage ?? ''}
                            onChange={(e) => patch(rule.ruleId, { patientMessage: e.target.value })}
                            placeholder="Optional — never a dose recommendation"
                          />
                        </div>
                      </div>
                    ) : null}
                  </Panel>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/*
        One publish for the whole afternoon's tuning. A bar rather than a button
        in the corner, because it has to be findable from wherever somebody
        scrolled to.
      */}
      {editable && changedCount > 0 ? (
        <div className="sticky bottom-4 z-20 mt-5">
          <div className="flex flex-wrap items-center gap-3 rounded-panel border border-brand-200 bg-surface px-4 py-3 shadow-pop">
            <span className="text-[13.5px] text-ink">
              <strong className="font-semibold">{changedCount}</strong>{' '}
              {changedCount === 1 ? 'rule' : 'rules'} changed
            </span>

            <span className="text-[12.5px] text-ink-faint">
              Publishes rules v{version + 1}. v{version} stays exactly as it is.
            </span>

            <button
              type="button"
              onClick={discard}
              disabled={busy}
              className="ml-auto flex items-center gap-1.5 text-[12.5px] font-medium text-ink-faint transition-colors hover:text-ink"
            >
              <RotateCcw size={13} strokeWidth={2} />
              Discard
            </button>

            <button
              type="button"
              onClick={publish}
              disabled={busy || problems.length > 0}
              className="flex items-center gap-1.5 rounded-control bg-brand-600 px-3.5 py-[8px] text-[12.5px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={13} strokeWidth={2.4} />
              {busy ? 'Publishing…' : 'Publish changes'}
            </button>
          </div>

          {problems.length > 0 ? (
            <div className="mt-2">
              <Notice tone="review" icon={<TriangleAlert size={15} strokeWidth={2.1} />}>
                {problems.join(' ')}
              </Notice>
            </div>
          ) : null}

          {error ? (
            <div className="mt-2"><Notice tone="stop">{error}</Notice></div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
