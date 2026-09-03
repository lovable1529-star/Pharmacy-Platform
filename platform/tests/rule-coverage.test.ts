/**
 * Rules checked against the form they run on.
 *
 * The failure this guards is silent: rename a field in the designer and every
 * rule reading it stops matching, with no error anywhere. The request comes
 * back AMBER by default and looks like an ordinary cautious result.
 */

import { describe, it, expect } from 'vitest';
import {
  answerableFieldIds,
  byOutcome,
  checkRulesetCoverage,
  conditionDependencies,
  ruleDependencies,
  describeCondition,
} from '../src/lib/rules/coverage';
import type { Rule, RulesetDefinition } from '../src/lib/rules/engine';
import type { FormSchema } from '../src/types/form-schema';

function schema(fieldIds: string[]): FormSchema {
  return {
    schemaVersion: 1,
    title: 'Test',
    steps: [{
      id: 'step',
      title: 'Step',
      fields: fieldIds.map((id) => ({ id, type: 'shortText' as const, label: id })),
    }],
  };
}

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'r1',
    label: 'A rule',
    priority: 100,
    outcome: 'AMBER',
    when: { field: 'answers.pregnancy', op: 'eq', value: 'yes' },
    ...over,
  };
}

function ruleset(rules: Rule[], defaultOutcome: RulesetDefinition['defaultOutcome'] = 'AMBER') {
  return { schemaVersion: 1 as const, defaultOutcome, rules };
}

describe('reading a rule dependencies', () => {
  it('finds a plain condition', () => {
    expect(conditionDependencies({ field: 'answers.pregnancy', op: 'eq', value: 'yes' }))
      .toEqual([{ path: 'answers.pregnancy', source: 'answers', key: 'pregnancy' }]);
  });

  it('separates answers from derived values', () => {
    const deps = conditionDependencies({
      all: [
        { field: 'answers.doseRequest', op: 'eq', value: 'increase' },
        { field: 'derived.bmi', op: 'lt', value: 23 },
      ],
    });

    expect(deps.map((d) => d.source)).toEqual(['answers', 'derived']);
    expect(deps.map((d) => d.key)).toEqual(['doseRequest', 'bmi']);
  });

  it('walks nested any/all/not trees', () => {
    const deps = conditionDependencies({
      all: [
        { field: 'answers.a', op: 'exists' },
        { any: [
          { field: 'answers.b', op: 'exists' },
          { not: { field: 'answers.c', op: 'exists' } },
        ] },
      ],
    });

    expect(deps.map((d) => d.key)).toEqual(['a', 'b', 'c']);
  });

  it('reports an unprefixed path rather than losing it', () => {
    const [dep] = conditionDependencies({ field: 'pregnancy', op: 'eq', value: 'yes' });
    expect(dep).toEqual({ path: 'pregnancy', source: 'unknown', key: 'pregnancy' });
  });

  it('reports a repeated field once per rule', () => {
    const deps = ruleDependencies(rule({
      when: { any: [
        { field: 'answers.bmi', op: 'lt', value: 23 },
        { field: 'answers.bmi', op: 'gt', value: 40 },
      ] },
    }));

    expect(deps).toHaveLength(1);
  });
});

describe('what the form can answer', () => {
  it('collects top-level fields', () => {
    expect([...answerableFieldIds(schema(['a', 'b']))].sort()).toEqual(['a', 'b']);
  });

  it('collects follow-ups revealed by an answer', () => {
    // These are answered under their own id. Missing them would report a
    // working rule as broken, which trains people to ignore this screen.
    const withReveal: FormSchema = {
      schemaVersion: 1,
      title: 'Test',
      steps: [{
        id: 'step',
        title: 'Step',
        fields: [{
          id: 'allergies',
          type: 'yesNo',
          label: 'Allergies?',
          reveals: [{
            whenValue: 'yes',
            fields: [{ id: 'allergiesDetail', type: 'longText', label: 'Which?' }],
          }],
        }],
      }],
    };

    expect([...answerableFieldIds(withReveal)].sort())
      .toEqual(['allergies', 'allergiesDetail']);
  });
});

describe('checking a ruleset against a form', () => {
  it('passes a rule whose question the form still asks', () => {
    const result = checkRulesetCoverage(
      ruleset([rule()]),
      schema(['pregnancy']),
    );

    expect(result.brokenRules).toEqual([]);
    expect(result.rules[0]!.dependencies[0]!.status).toBe('asked');
  });

  it('catches a rule reading a question the form no longer asks', () => {
    // The whole point: renaming pregnancy to isPregnant in the designer breaks
    // this rule and nothing else anywhere would say so.
    const result = checkRulesetCoverage(
      ruleset([rule()]),
      schema(['isPregnant']),
    );

    expect(result.brokenRules.map((r) => r.ruleId)).toEqual(['r1']);
    expect(result.missingKeys).toEqual(['pregnancy']);
  });

  it('treats derived values as computed, not missing', () => {
    // derived.bmi is produced from weight and height, never read from a field
    // of that name — checking it against field ids would fail every time.
    const result = checkRulesetCoverage(
      ruleset([rule({ when: { field: 'derived.bmi', op: 'lt', value: 23 } })]),
      schema(['weight', 'height']),
    );

    expect(result.brokenRules).toEqual([]);
    expect(result.rules[0]!.dependencies[0]!.status).toBe('computed');
  });

  it('breaks a rule when only one of its several fields is missing', () => {
    const result = checkRulesetCoverage(
      ruleset([rule({
        when: { all: [
          { field: 'answers.doseRequest', op: 'eq', value: 'increase' },
          { field: 'answers.weeksOnDose', op: 'lt', value: 3 },
        ] },
      })]),
      schema(['doseRequest']),
    );

    expect(result.brokenRules).toHaveLength(1);
    expect(result.missingKeys).toEqual(['weeksOnDose']);
  });

  it('claims nothing when no form is published yet', () => {
    // A service being set up has no form. Reporting every rule as broken there
    // is a false alarm at exactly the wrong moment.
    const result = checkRulesetCoverage(ruleset([rule()]), null);

    expect(result.brokenRules).toEqual([]);
    expect(result.rules[0]!.dependencies[0]!.status).toBe('computed');
  });

  it('lists each missing key once, sorted, across every rule', () => {
    const result = checkRulesetCoverage(
      ruleset([
        rule({ id: 'a', when: { field: 'answers.zebra', op: 'exists' } }),
        rule({ id: 'b', when: { field: 'answers.apple', op: 'exists' } }),
        rule({ id: 'c', when: { field: 'answers.zebra', op: 'exists' } }),
      ]),
      schema([]),
    );

    expect(result.missingKeys).toEqual(['apple', 'zebra']);
    expect(result.brokenRules).toHaveLength(3);
  });

  it('carries the default outcome through', () => {
    expect(checkRulesetCoverage(ruleset([], 'AMBER'), schema([])).defaultOutcome).toBe('AMBER');
  });

  it('reports a disabled rule as disabled rather than hiding it', () => {
    const result = checkRulesetCoverage(
      ruleset([rule({ enabled: false })]),
      schema(['pregnancy']),
    );

    expect(result.rules[0]!.enabled).toBe(false);
  });
});

describe('grouping for the screen', () => {
  it('orders RED, then AMBER, then GREEN', () => {
    const result = checkRulesetCoverage(
      ruleset([
        rule({ id: 'g', outcome: 'GREEN' }),
        rule({ id: 'r', outcome: 'RED' }),
        rule({ id: 'a', outcome: 'AMBER' }),
      ]),
      schema(['pregnancy']),
    );

    expect(byOutcome(result.rules).map((g) => g.outcome)).toEqual(['RED', 'AMBER', 'GREEN']);
  });

  it('orders within a group by priority, as the engine considers them', () => {
    const result = checkRulesetCoverage(
      ruleset([
        rule({ id: 'low', outcome: 'RED', priority: 100 }),
        rule({ id: 'high', outcome: 'RED', priority: 900 }),
      ]),
      schema(['pregnancy']),
    );

    expect(byOutcome(result.rules)[0]!.rules.map((r) => r.ruleId)).toEqual(['high', 'low']);
  });

  it('leaves out an outcome nothing decides', () => {
    const result = checkRulesetCoverage(
      ruleset([rule({ outcome: 'RED' })]),
      schema(['pregnancy']),
    );

    expect(byOutcome(result.rules).map((g) => g.outcome)).toEqual(['RED']);
  });
});

describe('reading a rule out loud', () => {
  it('turns a comparison into a sentence', () => {
    expect(describeCondition({ field: 'answers.pregnancy', op: 'eq', value: 'yes' }))
      .toBe('pregnancy is yes');
  });

  it('unpacks a camelCase field name', () => {
    expect(describeCondition({ field: 'answers.doseRequest', op: 'eq', value: 'increase' }))
      .toBe('dose request is increase');
  });

  it('reads underscores in a value as words', () => {
    expect(describeCondition({ field: 'answers.adverseEffects', op: 'eq', value: 'red_flag' }))
      .toBe('adverse effects is red flag');
  });

  it('joins an all-of with "and"', () => {
    expect(describeCondition({
      all: [
        { field: 'derived.bmi', op: 'lt', value: 23 },
        { field: 'answers.doseRequest', op: 'neq', value: 'decrease' },
      ],
    })).toBe('bmi is under 23 and dose request is not decrease');
  });

  it('brackets an any-of so nesting stays readable', () => {
    expect(describeCondition({
      all: [
        { field: 'derived.medicine', op: 'eq', value: 'Wegovy' },
        { any: [
          { field: 'derived.age', op: 'lt', value: 18 },
          { field: 'derived.age', op: 'gt', value: 74 },
        ] },
      ],
    })).toBe('medicine is Wegovy and (age is under 18 or age is over 74)');
  });

  it('lists the options behind an "is one of"', () => {
    expect(describeCondition({
      field: 'answers.adverseEffects', op: 'in', value: ['severe', 'red_flag'],
    })).toBe('adverse effects is one of severe or red flag');
  });

  it('says a range in full', () => {
    expect(describeCondition({ field: 'derived.bmi', op: 'between', range: [23, 24.9] }))
      .toBe('bmi is between 23 and 24.9');
  });

  it('needs no value for a presence check', () => {
    expect(describeCondition({ field: 'answers.questionsForPharmacist', op: 'exists' }))
      .toBe('questions for pharmacist was answered');
  });

  it('negates readably', () => {
    expect(describeCondition({ not: { field: 'answers.pregnancy', op: 'eq', value: 'yes' } }))
      .toBe('not (pregnancy is yes)');
  });
});
