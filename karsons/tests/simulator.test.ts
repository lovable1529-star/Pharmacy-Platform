import { describe, expect, it } from 'vitest';
import { findReplayDiscrepancies, ruleUtilisation, simulate, type HistoricalCase } from '@/lib/rules/simulator';
import { GLP1_REPEAT_RULESET } from '@/lib/rules/glp1-ruleset';
import type { RulesetDefinition } from '@/types/rule-schema';

function historicalCase(
  ref: string,
  answers: Record<string, unknown>,
  derived: Record<string, unknown>,
  recordedOutcome: 'GREEN' | 'AMBER' | 'RED',
): HistoricalCase {
  return {
    submissionId: `sub_${ref}`,
    reference: ref,
    submittedAt: new Date('2026-07-01'),
    context: { answers, derived },
    recordedOutcome,
  };
}

const stable = {
  answers: {
    medicine: 'Mounjaro', doseRequest: 'Same', supplyMonths: 1,
    pregnant: 'No', breastfeeding: 'No', adverseEffects: 'None',
    redFlagSymptoms: 'No', missedDoses: 0, healthChanges: 'No',
    appetiteSuppression: 'Full suppression all week',
    snacking: 'Less than 3 regular meals, no snacks', hydration: '≥ 2.0 L/day',
  },
  derived: { age: 44, bmi: 31.2, weightLossPercent: 3.1, weeksOnCurrentDose: 8, doseStepChange: 0 },
};

describe('simulate', () => {
  const cases = [
    historicalCase('A', stable.answers, stable.derived, 'GREEN'),
    historicalCase('B', { ...stable.answers, missedDoses: 1 }, stable.derived, 'AMBER'),
    historicalCase('C', { ...stable.answers, pregnant: 'Yes' }, stable.derived, 'RED'),
  ];

  it('reports no change when the ruleset is unchanged', () => {
    const summary = simulate(GLP1_REPEAT_RULESET, cases);
    expect(summary.changed).toBe(0);
    expect(summary.totalCases).toBe(3);
  });

  it('detects cases that would newly be permitted', () => {
    // Disable the missed-dose rule and case B should fall through to GREEN.
    const draft: RulesetDefinition = {
      ...GLP1_REPEAT_RULESET,
      rules: GLP1_REPEAT_RULESET.rules.map((r) =>
        r.id === 'adherence-missed-1' ? { ...r, enabled: false } : r,
      ),
    };

    const summary = simulate(draft, cases);
    expect(summary.changed).toBe(1);
    expect(summary.looser).toBe(1);
    expect(summary.newlyPermitted.map((c) => c.reference)).toEqual(['B']);
  });

  it('detects cases that would newly be blocked', () => {
    const draft: RulesetDefinition = {
      ...GLP1_REPEAT_RULESET,
      rules: [
        ...GLP1_REPEAT_RULESET.rules,
        {
          id: 'new-strict', label: 'Block BMI over 30', priority: 2000, outcome: 'RED',
          when: { field: 'derived.bmi', op: 'gt', value: 30 },
        },
      ],
    };

    const summary = simulate(draft, cases);
    expect(summary.newlyBlocked.length).toBeGreaterThan(0);
    expect(summary.stricter).toBeGreaterThan(0);
  });

  it('reports the outcome distribution before and after', () => {
    const summary = simulate(GLP1_REPEAT_RULESET, cases);
    expect(summary.distribution.before).toEqual({ GREEN: 1, AMBER: 1, RED: 1 });
    expect(summary.distribution.after).toEqual({ GREEN: 1, AMBER: 1, RED: 1 });
  });

  it('lists changed cases first — that is what the client came to see', () => {
    const draft: RulesetDefinition = {
      ...GLP1_REPEAT_RULESET,
      rules: GLP1_REPEAT_RULESET.rules.map((r) =>
        r.id === 'adherence-missed-1' ? { ...r, enabled: false } : r,
      ),
    };
    expect(simulate(draft, cases).comparisons[0]?.changed).toBe(true);
  });

  it('keeps the full reasoning for each simulated case', () => {
    const summary = simulate(GLP1_REPEAT_RULESET, cases);
    expect(summary.comparisons[0]?.result.trace.length).toBeGreaterThan(0);
  });

  it('handles an empty case set without dividing by zero', () => {
    const summary = simulate(GLP1_REPEAT_RULESET, []);
    expect(summary.totalCases).toBe(0);
    expect(summary.changed).toBe(0);
  });
});

describe('findReplayDiscrepancies', () => {
  it('finds nothing when recorded outcomes match a replay', () => {
    const cases = [historicalCase('A', stable.answers, stable.derived, 'GREEN')];
    expect(findReplayDiscrepancies(GLP1_REPEAT_RULESET, cases)).toHaveLength(0);
  });

  it('flags a recorded outcome the current rules would not produce', () => {
    // Signals a rule edited in place rather than versioned — a data-integrity
    // problem that should surface, not stay hidden.
    const cases = [historicalCase('A', stable.answers, stable.derived, 'RED')];
    expect(findReplayDiscrepancies(GLP1_REPEAT_RULESET, cases)).toHaveLength(1);
  });
});

describe('ruleUtilisation', () => {
  it('ranks rules by how often they fire', () => {
    const cases = [
      historicalCase('A', { ...stable.answers, pregnant: 'Yes' }, stable.derived, 'RED'),
      historicalCase('B', { ...stable.answers, pregnant: 'Yes' }, stable.derived, 'RED'),
      historicalCase('C', stable.answers, stable.derived, 'GREEN'),
    ];

    const utilisation = ruleUtilisation(GLP1_REPEAT_RULESET, cases);
    const pregnancy = utilisation.find((r) => r.ruleId === 'elig-pregnancy');

    expect(pregnancy?.firedCount).toBe(2);
    expect(pregnancy?.firedPercent).toBeCloseTo(66.7, 0);
  });

  it('shows rules that never fire — dead weight, or wrong', () => {
    const cases = [historicalCase('A', stable.answers, stable.derived, 'GREEN')];
    const never = ruleUtilisation(GLP1_REPEAT_RULESET, cases).filter((r) => r.firedCount === 0);
    expect(never.length).toBeGreaterThan(0);
  });
});
