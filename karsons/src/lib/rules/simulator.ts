/**
 * Rule simulator.
 *
 * Replays a draft ruleset against historical submissions and reports exactly
 * which past decisions would change.
 *
 * This is possible only because `evaluateRuleset` is pure — no I/O, no clock, no
 * hidden state. Given the same submission and the same rules it always produces
 * the same answer, so "what would have happened" is a real question with a real
 * answer rather than a guess.
 *
 * It turns a clinical rule change from a leap of faith into an evidenced
 * decision, and it is the single feature most likely to make the client trust
 * the engine enough to author rules himself.
 */

import { evaluateRuleset } from '@/lib/rules/engine';
import type {
  EvaluationContext,
  EvaluationResult,
  Outcome,
  RulesetDefinition,
} from '@/types/rule-schema';
import { OUTCOME_SEVERITY } from '@/types/rule-schema';

export interface HistoricalCase {
  submissionId: string;
  /** Anonymised label for the UI — never a patient name. */
  reference: string;
  submittedAt: Date;
  context: EvaluationContext;
  /** What the live rules decided at the time. */
  recordedOutcome: Outcome;
}

export interface CaseComparison {
  submissionId: string;
  reference: string;
  submittedAt: Date;
  before: Outcome;
  after: Outcome;
  changed: boolean;
  /** Did the change make the outcome stricter or more permissive? */
  direction: 'stricter' | 'looser' | 'unchanged';
  result: EvaluationResult;
}

export interface SimulationSummary {
  totalCases: number;
  changed: number;
  stricter: number;
  looser: number;
  /** Counts before and after, by outcome. */
  distribution: {
    before: Record<Outcome, number>;
    after: Record<Outcome, number>;
  };
  /**
   * Cases that would move from RED or AMBER to GREEN. These deserve the closest
   * scrutiny — a rule change that quietly stops flagging a safety concern is the
   * dangerous kind.
   */
  newlyPermitted: CaseComparison[];
  /** Cases that would newly be blocked. Usually intentional, but worth seeing. */
  newlyBlocked: CaseComparison[];
  comparisons: CaseComparison[];
}

function emptyDistribution(): Record<Outcome, number> {
  return { GREEN: 0, AMBER: 0, RED: 0 };
}

function directionOf(before: Outcome, after: Outcome): CaseComparison['direction'] {
  const delta = OUTCOME_SEVERITY[after] - OUTCOME_SEVERITY[before];
  if (delta > 0) return 'stricter';
  if (delta < 0) return 'looser';
  return 'unchanged';
}

/**
 * Runs a draft ruleset over historical cases.
 *
 * Deliberately compares against `recordedOutcome` — what was actually decided at
 * the time — rather than re-running the old ruleset. If the two ever disagree
 * that is itself worth knowing, and it is caught by `findReplayDiscrepancies`.
 */
export function simulate(
  draft: RulesetDefinition,
  cases: HistoricalCase[],
): SimulationSummary {
  const comparisons: CaseComparison[] = cases.map((historical) => {
    const result = evaluateRuleset(draft, historical.context);
    const before = historical.recordedOutcome;
    const after = result.outcome;

    return {
      submissionId: historical.submissionId,
      reference: historical.reference,
      submittedAt: historical.submittedAt,
      before,
      after,
      changed: before !== after,
      direction: directionOf(before, after),
      result,
    };
  });

  const distribution = { before: emptyDistribution(), after: emptyDistribution() };
  for (const comparison of comparisons) {
    distribution.before[comparison.before] += 1;
    distribution.after[comparison.after] += 1;
  }

  const changed = comparisons.filter((c) => c.changed);

  return {
    totalCases: cases.length,
    changed: changed.length,
    stricter: comparisons.filter((c) => c.direction === 'stricter').length,
    looser: comparisons.filter((c) => c.direction === 'looser').length,
    distribution,
    newlyPermitted: changed.filter((c) => c.after === 'GREEN' && c.before !== 'GREEN'),
    newlyBlocked: changed.filter((c) => c.after === 'RED' && c.before !== 'RED'),
    comparisons: [...comparisons].sort((a, b) => {
      // Changed cases first — that is what the client came to see.
      if (a.changed !== b.changed) return a.changed ? -1 : 1;
      return b.submittedAt.getTime() - a.submittedAt.getTime();
    }),
  };
}

/**
 * Replays the *current published* ruleset against history.
 *
 * Any disagreement with what was recorded means something is wrong — a rule was
 * edited in place instead of versioned, or a derived value is being computed
 * differently now than it was then. Either is a serious data-integrity problem
 * and should surface in the compliance centre, not stay hidden.
 */
export function findReplayDiscrepancies(
  published: RulesetDefinition,
  cases: HistoricalCase[],
): CaseComparison[] {
  return simulate(published, cases).comparisons.filter((c) => c.changed);
}

/**
 * Which rules actually earn their place.
 *
 * A rule that has never fired across a year of real submissions is either dead
 * weight or wrong. Both are worth knowing before the ruleset grows to fifty
 * rules nobody understands.
 */
export function ruleUtilisation(
  ruleset: RulesetDefinition,
  cases: HistoricalCase[],
): { ruleId: string; label: string; firedCount: number; firedPercent: number }[] {
  const counts = new Map<string, number>(ruleset.rules.map((r) => [r.id, 0]));

  for (const historical of cases) {
    const result = evaluateRuleset(ruleset, historical.context);
    for (const entry of result.trace) {
      if (entry.matched) counts.set(entry.ruleId, (counts.get(entry.ruleId) ?? 0) + 1);
    }
  }

  return ruleset.rules
    .map((rule) => {
      const firedCount = counts.get(rule.id) ?? 0;
      return {
        ruleId: rule.id,
        label: rule.label,
        firedCount,
        firedPercent: cases.length === 0 ? 0 : Math.round((firedCount / cases.length) * 1000) / 10,
      };
    })
    .sort((a, b) => b.firedCount - a.firedCount);
}
