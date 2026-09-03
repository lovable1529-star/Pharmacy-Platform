/**
 * Editing a clinical rule.
 *
 * The property under everything here: an edit must never change what a past
 * decision meant. That is why rulesets version rather than mutate, and why
 * every function in this module returns a copy.
 */

import { describe, it, expect } from 'vitest';
import {
  addressLeaves,
  applyEdits,
  describeChanges,
  editProblems,
  hasChanges,
  leafAt,
  replaceLeafValue,
} from '../src/lib/rules/edit';
import type { Rule, RulesetDefinition } from '../src/lib/rules/engine';

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'bmi',
    label: 'BMI under 23',
    priority: 930,
    outcome: 'RED',
    when: { field: 'derived.bmi', op: 'lt', value: 23 },
    ...over,
  };
}

function ruleset(rules: Rule[]): RulesetDefinition {
  return { schemaVersion: 1, defaultOutcome: 'AMBER', rules };
}

const NESTED = ruleset([rule({
  id: 'age',
  label: 'Wegovy outside 18–74',
  when: {
    all: [
      { field: 'derived.medicine', op: 'eq', value: 'Wegovy' },
      { any: [
        { field: 'derived.age', op: 'lt', value: 18 },
        { field: 'derived.age', op: 'gt', value: 74 },
      ] },
    ],
  },
})]);

describe('addressing conditions', () => {
  it('finds a bare leaf at the root', () => {
    expect(addressLeaves(rule().when)).toEqual([
      { path: [], leaf: { field: 'derived.bmi', op: 'lt', value: 23 } },
    ]);
  });

  it('walks nested trees, giving each leaf its position', () => {
    const leaves = addressLeaves(NESTED.rules[0]!.when);
    expect(leaves.map((l) => l.path)).toEqual([[0], [1, 0], [1, 1]]);
    expect(leaves.map((l) => l.leaf.value)).toEqual(['Wegovy', 18, 74]);
  });

  it('reads a leaf back by its path', () => {
    expect(leafAt(NESTED.rules[0]!.when, [1, 1])).toEqual({
      field: 'derived.age', op: 'gt', value: 74,
    });
  });

  it('returns null for a path that leads nowhere', () => {
    expect(leafAt(NESTED.rules[0]!.when, [9])).toBeNull();
    // A path stopping on a branch is not a leaf.
    expect(leafAt(NESTED.rules[0]!.when, [1])).toBeNull();
  });
});

describe('replacing a value', () => {
  it('changes the leaf named and nothing else', () => {
    const next = replaceLeafValue(NESTED.rules[0]!.when, [1, 1], { value: 80 });
    expect(addressLeaves(next).map((l) => l.leaf.value)).toEqual(['Wegovy', 18, 80]);
  });

  it('does not mutate what it was given', () => {
    const original = rule().when;
    replaceLeafValue(original, [], { value: 25 });
    expect(original).toEqual({ field: 'derived.bmi', op: 'lt', value: 23 });
  });

  it('swaps a value for a range and drops the stale one', () => {
    const next = replaceLeafValue(
      { field: 'derived.bmi', op: 'between', value: 1 },
      [],
      { range: [23, 24.9] },
    );
    expect(next).toEqual({ field: 'derived.bmi', op: 'between', range: [23, 24.9] });
  });

  it('leaves the tree alone when the path leads nowhere', () => {
    const original = NESTED.rules[0]!.when;
    expect(replaceLeafValue(original, [7, 7], { value: 1 })).toEqual(original);
  });
});

describe('validating an edit', () => {
  const set = ruleset([rule()]);

  it('accepts a sound one', () => {
    expect(editProblems(set, [{ ruleId: 'bmi', outcome: 'AMBER' }])).toEqual([]);
  });

  it('refuses an edit naming a rule that is not there', () => {
    // A change that appears to save and does nothing is the worst outcome.
    expect(editProblems(set, [{ ruleId: 'nope' }])).toHaveLength(1);
  });

  it('refuses the same rule edited twice in one save', () => {
    expect(editProblems(set, [{ ruleId: 'bmi' }, { ruleId: 'bmi' }])).toHaveLength(1);
  });

  it('refuses a priority outside the usable range', () => {
    expect(editProblems(set, [{ ruleId: 'bmi', priority: -1 }])).toHaveLength(1);
    expect(editProblems(set, [{ ruleId: 'bmi', priority: 10_000 }])).toHaveLength(1);
    expect(editProblems(set, [{ ruleId: 'bmi', priority: 1.5 }])).toHaveLength(1);
  });

  it('insists a numeric comparison gets a number', () => {
    expect(editProblems(set, [{
      ruleId: 'bmi', conditionValues: [{ path: [], value: 'twenty-five' }],
    }])).toHaveLength(1);
  });

  it('accepts a number for a numeric comparison', () => {
    expect(editProblems(set, [{
      ruleId: 'bmi', conditionValues: [{ path: [], value: 25 }],
    }])).toEqual([]);
  });

  it('insists a list comparison gets at least one option', () => {
    const listSet = ruleset([rule({
      when: { field: 'answers.adverseEffects', op: 'in', value: ['severe'] },
    })]);

    expect(editProblems(listSet, [{
      ruleId: 'bmi', conditionValues: [{ path: [], value: [] }],
    }])).toHaveLength(1);
  });

  it('refuses a range that starts above where it ends', () => {
    const between = ruleset([rule({
      when: { field: 'derived.bmi', op: 'between', range: [23, 24.9] },
    })]);

    expect(editProblems(between, [{
      ruleId: 'bmi', conditionValues: [{ path: [], range: [30, 20] }],
    }])).toHaveLength(1);
  });

  it('catches a rule whose shape moved under the screen', () => {
    const problems = editProblems(set, [{
      ruleId: 'bmi', conditionValues: [{ path: [4, 2], value: 1 }],
    }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Reload');
  });
});

describe('applying edits', () => {
  const set = ruleset([rule(), rule({ id: 'other', label: 'Another', priority: 100 })]);

  it('changes only the rule named', () => {
    const next = applyEdits(set, [{ ruleId: 'bmi', outcome: 'AMBER' }]);
    expect(next.rules[0]!.outcome).toBe('AMBER');
    expect(next.rules[1]!.outcome).toBe('RED');
  });

  it('does not touch the published definition it was given', () => {
    applyEdits(set, [{ ruleId: 'bmi', outcome: 'GREEN', priority: 1 }]);
    expect(set.rules[0]!.outcome).toBe('RED');
    expect(set.rules[0]!.priority).toBe(930);
  });

  it('turns a rule off without removing it', () => {
    const next = applyEdits(set, [{ ruleId: 'bmi', enabled: false }]);
    expect(next.rules[0]!.enabled).toBe(false);
    expect(next.rules).toHaveLength(2);
  });

  it('moves a threshold', () => {
    const next = applyEdits(set, [{
      ruleId: 'bmi', conditionValues: [{ path: [], value: 25 }],
    }]);
    expect(next.rules[0]!.when).toEqual({ field: 'derived.bmi', op: 'lt', value: 25 });
  });

  it('drops a message cleared to empty rather than storing a blank', () => {
    const withMessage = ruleset([rule({ message: 'Speak to a pharmacist.' })]);
    const next = applyEdits(withMessage, [{ ruleId: 'bmi', message: '   ' }]);
    expect(next.rules[0]!.message).toBeUndefined();
  });

  it('trims a reworded message', () => {
    const next = applyEdits(set, [{ ruleId: 'bmi', message: '  Call them.  ' }]);
    expect(next.rules[0]!.message).toBe('Call them.');
  });

  it('leaves the ruleset default alone', () => {
    expect(applyEdits(set, [{ ruleId: 'bmi', outcome: 'GREEN' }]).defaultOutcome).toBe('AMBER');
  });

  it('never adds or removes rules', () => {
    expect(applyEdits(set, [{ ruleId: 'bmi' }]).rules).toHaveLength(set.rules.length);
  });
});

describe('noticing a change', () => {
  const set = ruleset([rule()]);

  it('sees nothing when nothing moved', () => {
    expect(hasChanges(set, applyEdits(set, [{ ruleId: 'bmi' }]))).toBe(false);
  });

  it('sees a real edit', () => {
    expect(hasChanges(set, applyEdits(set, [{ ruleId: 'bmi', priority: 500 }]))).toBe(true);
  });
});

describe('describing what changed', () => {
  const set = ruleset([rule()]);

  it('names the rule and what moved', () => {
    const after = applyEdits(set, [{ ruleId: 'bmi', outcome: 'AMBER', priority: 500 }]);
    expect(describeChanges(set, after)).toEqual(['BMI under 23: RED → AMBER, priority 930 → 500']);
  });

  it('says when a rule was turned off', () => {
    const after = applyEdits(set, [{ ruleId: 'bmi', enabled: false }]);
    expect(describeChanges(set, after)[0]).toContain('turned off');
  });

  it('says when a threshold moved', () => {
    const after = applyEdits(set, [{
      ruleId: 'bmi', conditionValues: [{ path: [], value: 25 }],
    }]);
    expect(describeChanges(set, after)[0]).toContain('thresholds changed');
  });

  it('says nothing about rules that did not move', () => {
    expect(describeChanges(set, applyEdits(set, [{ ruleId: 'bmi' }]))).toEqual([]);
  });
});
