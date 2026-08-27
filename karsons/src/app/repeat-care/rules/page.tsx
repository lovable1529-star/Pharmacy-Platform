'use client';

/**
 * Clinical rules and simulator.
 *
 * The demo centrepiece. The client toggles a rule off and immediately sees
 * which historical decisions would have changed — including a prominent list of
 * anything that would newly be permitted.
 *
 * This works because `evaluateRuleset` is pure. Replaying past submissions
 * against a draft ruleset is a real answer, not an approximation.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { GLP1_REPEAT_RULESET } from '@/lib/rules/glp1-ruleset';
import { simulate, ruleUtilisation, type HistoricalCase } from '@/lib/rules/simulator';
import { evaluateRuleset } from '@/lib/rules/engine';
import { deriveValues } from '@/lib/clinical/derived';
import { REPEAT_REQUESTS } from '@/lib/demo/data';
import { RuleEditor, describeRule } from '@/components/rule-builder/rule-editor';
import type { Outcome, Rule, RulesetDefinition } from '@/types/rule-schema';

const BADGE: Record<Outcome, string> = {
  RED: 'bg-triage-red-700 text-white',
  AMBER: 'bg-triage-amber-700 text-white',
  GREEN: 'bg-clinical-green-700 text-white',
};

/**
 * Historical cases for the simulator.
 *
 * Built from the demo requests, expanded with variations so the simulation has
 * enough breadth to be meaningful. In production this reads real historical
 * submissions with their recorded outcomes.
 */
function buildHistory(): HistoricalCase[] {
  const cases: HistoricalCase[] = [];

  REPEAT_REQUESTS.forEach((request, index) => {
    for (let variant = 0; variant < 8; variant += 1) {
      const derived = deriveValues({
        medicine: request.medicine,
        currentStrength: request.currentStrength,
        requestedStrength: request.requestedStrength,
        weightKg: request.weightKg + variant * 1.5,
        heightCm: request.heightCm,
        dateOfBirth: request.dateOfBirth,
        previousSupplies: request.previousSupplies,
      });

      const answers = {
        ...request.answers,
        missedDoses: variant % 4 === 3 ? 1 : 0,
        adverseEffects: variant % 5 === 4 ? 'Moderate' : 'None',
      };

      const context = { answers, derived: { ...derived } };

      cases.push({
        submissionId: `hist_${index}_${variant}`,
        reference: `Case ${index * 8 + variant + 1}`,
        submittedAt: new Date(Date.now() - (index * 8 + variant) * 86_400_000),
        context,
        // The recorded outcome is what the live rules produced at the time.
        recordedOutcome: evaluateRuleset(GLP1_REPEAT_RULESET, context).outcome,
      });
    }
  });

  return cases;
}

export default function RulesPage() {
  const history = useMemo(buildHistory, []);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());

  // Rules the client has edited or added in this session. Kept separate from
  // the published set so "Reset changes" genuinely restores the original.
  const [edits, setEdits] = useState<Record<string, Rule>>({});
  const [editing, setEditing] = useState<Rule | null>(null);

  const baseRules: Rule[] = useMemo(() => {
    const merged = GLP1_REPEAT_RULESET.rules.map((rule) => edits[rule.id] ?? rule);
    const added = Object.values(edits).filter(
      (rule) => !GLP1_REPEAT_RULESET.rules.some((r) => r.id === rule.id),
    );
    return [...merged, ...added];
  }, [edits]);

  const draft: RulesetDefinition = useMemo(
    () => ({
      ...GLP1_REPEAT_RULESET,
      rules: baseRules.map((rule) =>
        disabled.has(rule.id) ? { ...rule, enabled: false } : rule,
      ),
    }),
    [baseRules, disabled],
  );

  const summary = useMemo(() => simulate(draft, history), [draft, history]);
  const utilisation = useMemo(() => ruleUtilisation(draft, history), [draft, history]);
  const utilisationById = useMemo(
    () => new Map(utilisation.map((u) => [u.ruleId, u])),
    [utilisation],
  );

  function toggle(ruleId: string) {
    setDisabled((current) => {
      const next = new Set(current);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }

  const dirty = disabled.size > 0 || Object.keys(edits).length > 0;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/repeat-care" className="mb-4 inline-block text-sm font-semibold text-brand-600">
        ← Back to repeat care
      </Link>

      <h1 className="mb-1 text-2xl">Clinical rules</h1>
      <p className="mb-6 text-sm text-ink-soft">
        Change a rule and see exactly which past decisions would have been different, before
        anything goes live.
      </p>

      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base">
              {baseRules.length} rules
              <span className="ml-2 text-sm font-normal text-ink-soft">
                highest priority first
              </span>
            </h2>
            {dirty && (
              <button type="button" onClick={() => { setDisabled(new Set()); setEdits({}); }}
                className="text-sm font-semibold text-brand-600">
                Reset changes
              </button>
            )}
          </div>

          {editing && (
            <div className="mb-4">
              <RuleEditor
                rule={editing}
                onChange={setEditing}
                onCancel={() => setEditing(null)}
                onSave={() => {
                  setEdits((current) => ({ ...current, [editing.id]: editing }));
                  setEditing(null);
                }}
              />
            </div>
          )}

          <button
            type="button"
            onClick={() =>
              setEditing({
                id: `rule_${Date.now()}`,
                label: '',
                priority: 500,
                outcome: 'AMBER',
                when: { field: 'derived.bmi', op: 'gte', value: 25 },
              })
            }
            className="mb-3 w-full rounded-lg border border-dashed border-brand-300 py-2.5 text-sm font-semibold text-brand-700"
          >
            + Write a new rule
          </button>

          <ul className="space-y-2">
            {[...baseRules]
              .sort((a, b) => b.priority - a.priority)
              .map((rule) => {
                const off = disabled.has(rule.id);
                const stats = utilisationById.get(rule.id);

                return (
                  <li key={rule.id}
                    className={`rounded-card border p-4 ${off ? 'border-line bg-canvas opacity-60' : 'border-line bg-surface'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold ${BADGE[rule.outcome]}`}>
                            {rule.outcome}
                          </span>
                          <span className="font-semibold">{rule.label}</span>
                        </div>
                        <p className="mt-1 text-sm text-ink-soft">{describeRule(rule)}</p>
                        {edits[rule.id] && (
                          <p className="mt-0.5 text-xs font-semibold text-brand-600">Edited — not yet published</p>
                        )}
                        <p className="mt-1 font-mono text-[11px] text-ink-soft">
                          priority {rule.priority}
                          {stats ? ` · fired in ${stats.firedPercent}% of past cases` : ''}
                          {stats?.firedCount === 0 && ' · never fires'}
                        </p>
                      </div>

                      <div className="flex flex-none items-center gap-3">
                        <button type="button" onClick={() => setEditing(rule)}
                          className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">
                          Edit
                        </button>
                        <label className="flex cursor-pointer items-center gap-2 text-xs">
                          <input type="checkbox" checked={!off} onChange={() => toggle(rule.id)} />
                          <span>{off ? 'Off' : 'On'}</span>
                        </label>
                      </div>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>

        <aside className="lg:sticky lg:top-5 lg:self-start">
          <div className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-1 text-base">Simulation</h2>
            <p className="mb-4 text-sm text-ink-soft">
              Replayed against {summary.totalCases} past requests.
            </p>

            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              {(['RED', 'AMBER', 'GREEN'] as Outcome[]).map((outcome) => {
                const before = summary.distribution.before[outcome];
                const after = summary.distribution.after[outcome];
                const delta = after - before;

                return (
                  <div key={outcome} className="rounded-lg border border-line p-3">
                    <div className={`mx-auto mb-1 w-fit rounded px-2 py-0.5 font-mono text-[10px] font-bold ${BADGE[outcome]}`}>
                      {outcome}
                    </div>
                    <div className="font-display text-2xl">{after}</div>
                    {delta !== 0 && (
                      <div className={`text-xs font-semibold ${delta > 0 ? 'text-triage-amber-700' : 'text-brand-600'}`}>
                        {delta > 0 ? '+' : ''}{delta}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {summary.changed === 0 ? (
              <p className="rounded-lg border border-line bg-canvas p-4 text-center text-sm text-ink-soft">
                No decisions would change.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="rounded-lg border border-brand-300 bg-brand-50 p-3 text-sm">
                  <span className="font-semibold">{summary.changed}</span> of {summary.totalCases}{' '}
                  decisions would change — {summary.looser} more permissive, {summary.stricter}{' '}
                  stricter.
                </p>

                {/*
                  Newly permitted cases are surfaced most prominently. A rule
                  change that quietly stops flagging a safety concern is the
                  dangerous kind, and it should be impossible to miss.
                */}
                {summary.newlyPermitted.length > 0 && (
                  <div className="rounded-lg border border-triage-red-700 bg-triage-red-100 p-3">
                    <p className="mb-1 text-sm font-bold text-triage-red-700">
                      {summary.newlyPermitted.length} case
                      {summary.newlyPermitted.length === 1 ? '' : 's'} would now pass without being
                      flagged
                    </p>
                    <p className="text-xs text-ink-soft">
                      These were previously blocked or sent for review. Check this is what you
                      intended.
                    </p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {summary.newlyPermitted.slice(0, 5).map((c) => (
                        <li key={c.submissionId} className="font-mono">
                          {c.reference}: {c.before} → {c.after}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.newlyBlocked.length > 0 && (
                  <div className="rounded-lg border border-triage-amber-700 bg-triage-amber-100 p-3">
                    <p className="text-sm font-bold text-triage-amber-700">
                      {summary.newlyBlocked.length} case
                      {summary.newlyBlocked.length === 1 ? '' : 's'} would now be blocked
                    </p>
                  </div>
                )}
              </div>
            )}

            <button type="button" disabled={!dirty}
              className="mt-5 w-full rounded-full bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">
              Publish as new version
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-soft">
              Publishing creates a version. Past decisions keep the rules they were made under.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
