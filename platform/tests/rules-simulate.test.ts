import { describe, it, expect } from 'vitest';
import { simulate, coerce, simulatorInputs } from '../src/lib/rules/simulate';
import type { RulesetDefinition } from '../src/lib/rules/engine';

/**
 * A small stand-in for the shape of the live GLP-1 ruleset: an eligibility
 * floor on BMI, a hard stop, and an AMBER catch-all default.
 */
const RULESET: RulesetDefinition = {
  schemaVersion: 1,
  defaultOutcome: 'AMBER',
  rules: [
    {
      id: 'pregnant',
      label: 'Pregnant or breastfeeding',
      priority: 100,
      outcome: 'RED',
      when: { field: 'answers.q_pregnant', op: 'eq', value: true },
    },
    {
      id: 'bmi-floor',
      label: 'BMI at or above 25',
      priority: 50,
      outcome: 'GREEN',
      when: { field: 'derived.bmi', op: 'gte', value: 25 },
    },
  ],
};

describe('coerce', () => {
  it('reads an empty box as unanswered, not as zero', () => {
    expect(coerce('')).toBeUndefined();
    expect(coerce('   ')).toBeUndefined();
  });

  it('reads numbers, booleans and null', () => {
    expect(coerce('27.4')).toBe(27.4);
    expect(coerce('-3')).toBe(-3);
    expect(coerce('true')).toBe(true);
    expect(coerce('false')).toBe(false);
    expect(coerce('null')).toBeNull();
  });

  it('leaves anything else as text', () => {
    expect(coerce('mounjaro')).toBe('mounjaro');
    expect(coerce('Infinity')).toBe('Infinity');
  });
});

describe('simulatorInputs', () => {
  it('lists every field the rules read, once each', () => {
    const paths = simulatorInputs(RULESET).map((i) => i.path);
    expect(paths).toEqual(['answers.q_pregnant', 'derived.bmi']);
  });

  it('carries the bare field name, for a label', () => {
    const bmi = simulatorInputs(RULESET).find((i) => i.path === 'derived.bmi');
    expect(bmi?.key).toBe('bmi');
  });
});

describe('simulate', () => {
  it('returns the outcome the engine would return', () => {
    const { evaluation } = simulate(RULESET, { 'derived.bmi': '31' });
    expect(evaluation.outcome).toBe('GREEN');
    expect(evaluation.decidingRuleId).toBe('bmi-floor');
  });

  it('lets severity win regardless of order', () => {
    const { evaluation } = simulate(RULESET, {
      'derived.bmi': '31',
      'answers.q_pregnant': 'true',
    });
    expect(evaluation.outcome).toBe('RED');
  });

  /*
   * The reason this module exists. A height typed in metres gave a BMI around
   * 290,000, which satisfied `bmi >= 25` and returned GREEN. The simulator must
   * reproduce that faithfully — and say the figure is absurd, rather than
   * quietly correcting it and hiding the very bug it is meant to expose.
   */
  it('reproduces a green verdict on an impossible BMI, and flags the figure', () => {
    const { evaluation, warnings } = simulate(RULESET, { 'derived.bmi': '290000' });

    expect(evaluation.outcome).toBe('GREEN');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.path).toBe('derived.bmi');
    expect(warnings[0]!.message).toContain('8');
  });

  it('does not warn about a figure a real patient could produce', () => {
    expect(simulate(RULESET, { 'derived.bmi': '31' }).warnings).toEqual([]);
  });

  it('leaves a blank field out of the context so its rule is skipped, not passed', () => {
    const { evaluation, omitted, context } = simulate(RULESET, {
      'derived.bmi': '',
      'answers.q_pregnant': '',
    });

    expect(omitted).toEqual(['answers.q_pregnant', 'derived.bmi']);
    expect(context.derived).toEqual({});

    // Neither rule could run, so the ruleset's own default stands.
    expect(evaluation.outcome).toBe('AMBER');
    expect(evaluation.decidingRuleId).toBeNull();
    expect(evaluation.trace.every((t) => !t.matched)).toBe(true);
  });

  it('files each value under the bucket its path names', () => {
    const { context } = simulate(RULESET, {
      'derived.bmi': '31',
      'answers.q_pregnant': 'false',
    });
    expect(context.derived).toEqual({ bmi: 31 });
    expect(context.answers).toEqual({ q_pregnant: false });
  });

  it('ignores a bucket the engine cannot resolve rather than pretending', () => {
    const { context } = simulate(RULESET, { 'nonsense.field': '1' });
    expect(context.answers).toEqual({});
    expect(context.derived).toEqual({});
  });

  it('reports the full trace, so a skipped rule is visible as skipped', () => {
    const { evaluation } = simulate(RULESET, { 'derived.bmi': '31' });
    const pregnant = evaluation.trace.find((t) => t.ruleId === 'pregnant');
    expect(pregnant).toBeDefined();
    expect(pregnant!.matched).toBe(false);
  });
});
