import { describe, expect, it } from 'vitest';
import { evaluateCondition, evaluateRuleset, resolvePath } from '@/lib/rules/engine';
import type { EvaluationContext, RulesetDefinition } from '@/types/rule-schema';

function ctx(answers: Record<string, unknown>, derived: Record<string, unknown> = {}): EvaluationContext {
  return { answers, derived };
}

describe('resolvePath', () => {
  it('resolves nested paths', () => {
    expect(resolvePath(ctx({ weightKg: 92 }), 'answers.weightKg')).toBe(92);
    expect(resolvePath(ctx({}, { bmi: 27.4 }), 'derived.bmi')).toBe(27.4);
  });

  it('returns undefined for missing paths rather than throwing', () => {
    expect(resolvePath(ctx({}), 'answers.nothing.here')).toBeUndefined();
  });
});

describe('comparison operators', () => {
  const context = ctx({
    weight: 92,
    medicine: 'Mounjaro',
    symptoms: ['nausea', 'headache'],
    note: 'Feeling much better',
  }, { bmi: 24.2 });

  it('handles equality', () => {
    expect(evaluateCondition({ field: 'answers.medicine', op: 'eq', value: 'Mounjaro' }, context)).toBe(true);
    expect(evaluateCondition({ field: 'answers.medicine', op: 'neq', value: 'Wegovy' }, context)).toBe(true);
  });

  it('handles numeric comparison', () => {
    expect(evaluateCondition({ field: 'answers.weight', op: 'gt', value: 90 }, context)).toBe(true);
    expect(evaluateCondition({ field: 'answers.weight', op: 'lte', value: 92 }, context)).toBe(true);
  });

  it('handles set membership', () => {
    expect(evaluateCondition({ field: 'answers.medicine', op: 'in', value: ['Mounjaro', 'Wegovy'] }, context)).toBe(true);
    expect(evaluateCondition({ field: 'answers.medicine', op: 'nin', value: ['Saxenda'] }, context)).toBe(true);
  });

  it('handles contains for arrays and strings', () => {
    expect(evaluateCondition({ field: 'answers.symptoms', op: 'contains', value: 'nausea' }, context)).toBe(true);
    expect(evaluateCondition({ field: 'answers.note', op: 'contains', value: 'BETTER' }, context)).toBe(true);
  });

  it('handles inclusive between', () => {
    expect(evaluateCondition({ field: 'derived.bmi', op: 'between', range: [23, 24.9] }, context)).toBe(true);
    expect(evaluateCondition({ field: 'derived.bmi', op: 'between', range: [25, 30] }, context)).toBe(false);
  });

  it('treats empty string as absent for existence checks', () => {
    const c = ctx({ note: '' });
    expect(evaluateCondition({ field: 'answers.note', op: 'exists' }, c)).toBe(false);
    expect(evaluateCondition({ field: 'answers.note', op: 'notExists' }, c)).toBe(true);
  });
});

describe('boolean composition', () => {
  const context = ctx({ a: 1, b: 2 });

  it('all requires every child to match', () => {
    expect(evaluateCondition({ all: [
      { field: 'answers.a', op: 'eq', value: 1 },
      { field: 'answers.b', op: 'eq', value: 2 },
    ] }, context)).toBe(true);

    expect(evaluateCondition({ all: [
      { field: 'answers.a', op: 'eq', value: 1 },
      { field: 'answers.b', op: 'eq', value: 99 },
    ] }, context)).toBe(false);
  });

  it('any requires one child to match', () => {
    expect(evaluateCondition({ any: [
      { field: 'answers.a', op: 'eq', value: 99 },
      { field: 'answers.b', op: 'eq', value: 2 },
    ] }, context)).toBe(true);
  });

  it('not inverts', () => {
    expect(evaluateCondition({ not: { field: 'answers.a', op: 'eq', value: 99 } }, context)).toBe(true);
  });

  it('nests arbitrarily deep', () => {
    expect(evaluateCondition({
      all: [
        { field: 'answers.a', op: 'eq', value: 1 },
        { any: [
          { field: 'answers.b', op: 'eq', value: 99 },
          { not: { field: 'answers.b', op: 'eq', value: 99 } },
        ] },
      ],
    }, context)).toBe(true);
  });
});

describe('evaluateRuleset', () => {
  const ruleset: RulesetDefinition = {
    schemaVersion: 1,
    defaultOutcome: 'AMBER',
    rules: [
      { id: 'red', label: 'Blocker', priority: 100, outcome: 'RED', when: { field: 'answers.danger', op: 'eq', value: true }, message: 'Blocked' },
      { id: 'amber', label: 'Review', priority: 50, outcome: 'AMBER', when: { field: 'answers.review', op: 'eq', value: true }, message: 'Review' },
      { id: 'green', label: 'Clear', priority: 10, outcome: 'GREEN', when: { field: 'answers.clear', op: 'eq', value: true }, advice: 'Well done' },
    ],
  };

  it('falls back to the default outcome when nothing matches', () => {
    const result = evaluateRuleset(ruleset, ctx({ danger: false, review: false, clear: false }));
    expect(result.outcome).toBe('AMBER');
    expect(result.decidingRuleId).toBeNull();
  });

  it('defaults to AMBER, never GREEN — an unrecognised request goes to a pharmacist', () => {
    expect(ruleset.defaultOutcome).toBe('AMBER');
  });

  it('lets the most severe outcome win regardless of priority order', () => {
    const result = evaluateRuleset(ruleset, ctx({ danger: true, review: true, clear: true }));
    expect(result.outcome).toBe('RED');
    expect(result.decidingRuleId).toBe('red');
  });

  it('evaluates every rule, not just up to the first match', () => {
    const result = evaluateRuleset(ruleset, ctx({ danger: true, review: true, clear: true }));
    expect(result.trace).toHaveLength(3);
    expect(result.trace.every((t) => t.matched)).toBe(true);
  });

  it('collects advice from every matched rule', () => {
    const result = evaluateRuleset(ruleset, ctx({ danger: false, review: false, clear: true }));
    expect(result.advice).toContain('Well done');
  });

  it('records the trace in priority order for audit', () => {
    const result = evaluateRuleset(ruleset, ctx({ danger: false, review: false, clear: false }));
    expect(result.trace.map((t) => t.ruleId)).toEqual(['red', 'amber', 'green']);
  });

  it('skips rules with missing fields rather than treating them as satisfied', () => {
    // A safety rule must never pass silently because an answer is absent.
    const result = evaluateRuleset(ruleset, ctx({}));
    const redTrace = result.trace.find((t) => t.ruleId === 'red');
    expect(redTrace?.matched).toBe(false);
    expect(redTrace?.skippedReason).toContain('Missing field');
  });

  it('ignores disabled rules', () => {
    const disabled: RulesetDefinition = {
      ...ruleset,
      rules: ruleset.rules.map((r) => (r.id === 'red' ? { ...r, enabled: false } : r)),
    };
    const result = evaluateRuleset(disabled, ctx({ danger: true, review: true, clear: false }));
    expect(result.outcome).toBe('AMBER');
    expect(result.trace.find((t) => t.ruleId === 'red')).toBeUndefined();
  });

  it('is deterministic — the same input always produces the same trace', () => {
    const input = ctx({ danger: false, review: true, clear: true });
    expect(evaluateRuleset(ruleset, input)).toEqual(evaluateRuleset(ruleset, input));
  });
});
