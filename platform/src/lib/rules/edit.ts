/**
 * Changing a clinical rule.
 *
 * The constraint that shapes everything here: a rule change must never alter
 * what a past decision meant. A request evaluated in March as RED because BMI
 * was under 23 has to keep saying that after somebody moves the threshold to
 * 25 in June. Rulesets are therefore immutable and versioned exactly as forms
 * are — editing publishes a NEW version and leaves the old one for the
 * evaluations that point at it.
 *
 * What can be edited, and what deliberately cannot:
 *
 *   CAN   turn a rule off; change its outcome, its priority, the message staff
 *         see and the message the patient sees; and change the VALUES in its
 *         conditions — a threshold, a list of options.
 *
 *   CANNOT  add or remove rules, or change the SHAPE of a condition. Those
 *         change what a rule is rather than how it is tuned, and they want a
 *         builder with its own safety rules rather than a text box. Moving a
 *         BMI threshold is a tuning decision a pharmacist can make; rewriting
 *         "BMI under 23 AND not tapering" into something else is not.
 *
 * This split is not a stopgap. It covers what the client actually asks for —
 * "make that amber instead of red", "change 23 to 25", "reword that" — while
 * keeping the structure of the rulebook under review.
 */

import type {
  Condition, LeafCondition, Outcome, Rule, RulesetDefinition,
} from '@/lib/rules/engine';

export const OUTCOMES: readonly Outcome[] = ['RED', 'AMBER', 'GREEN'] as const;

/** One editable value inside a rule, addressed by its position in the tree. */
export interface ConditionValueEdit {
  /** Path of indices from the rule's root condition to the leaf. */
  path: number[];
  /** The replacement. `range` is used for a `between`, `value` for the rest. */
  value?: unknown;
  range?: [number, number];
}

export interface RuleEdit {
  ruleId: string;
  enabled?: boolean;
  outcome?: Outcome;
  priority?: number;
  message?: string | null;
  patientMessage?: string | null;
  conditionValues?: ConditionValueEdit[];
}

/** A leaf and where it sits, so the screen can render and address it. */
export interface AddressedLeaf {
  path: number[];
  leaf: LeafCondition;
}

/**
 * Every leaf in a condition tree, with the path that identifies it.
 *
 * The path is positional rather than a generated id because conditions carry
 * no ids and adding one would rewrite every published ruleset. Positions are
 * stable for exactly as long as the shape is, which is the same window in
 * which an edit is allowed at all.
 */
export function addressLeaves(condition: Condition, path: number[] = []): AddressedLeaf[] {
  if ('all' in condition) {
    return condition.all.flatMap((c, i) => addressLeaves(c, [...path, i]));
  }
  if ('any' in condition) {
    return condition.any.flatMap((c, i) => addressLeaves(c, [...path, i]));
  }
  if ('not' in condition) return addressLeaves(condition.not, [...path, 0]);

  return [{ path, leaf: condition }];
}

/** The leaf at a path, or null where the path does not lead to one. */
export function leafAt(condition: Condition, path: readonly number[]): LeafCondition | null {
  if (path.length === 0) {
    return 'all' in condition || 'any' in condition || 'not' in condition ? null : condition;
  }

  const [index, ...rest] = path;
  const child = 'all' in condition
    ? condition.all[index!]
    : 'any' in condition
      ? condition.any[index!]
      : 'not' in condition && index === 0
        ? condition.not
        : undefined;

  return child ? leafAt(child, rest) : null;
}

/** A copy of the tree with one leaf's value replaced. Never mutates. */
export function replaceLeafValue(
  condition: Condition,
  path: readonly number[],
  edit: Pick<ConditionValueEdit, 'value' | 'range'>,
): Condition {
  if (path.length === 0) {
    if ('all' in condition || 'any' in condition || 'not' in condition) return condition;

    const next: LeafCondition = { ...condition };
    if (edit.range !== undefined) {
      next.range = edit.range;
      delete next.value;
    } else {
      next.value = edit.value;
      delete next.range;
    }
    return next;
  }

  const [index, ...rest] = path;

  if ('all' in condition) {
    return {
      all: condition.all.map((c, i) => (i === index ? replaceLeafValue(c, rest, edit) : c)),
    };
  }
  if ('any' in condition) {
    return {
      any: condition.any.map((c, i) => (i === index ? replaceLeafValue(c, rest, edit) : c)),
    };
  }
  if ('not' in condition && index === 0) {
    return { not: replaceLeafValue(condition.not, rest, edit) };
  }

  return condition;
}

/**
 * What is wrong with an edit, in words somebody can act on.
 *
 * Checked against the ruleset it will be applied to, so an edit naming a rule
 * or a condition that is not there is caught rather than silently dropped —
 * a change that appears to save and does nothing is the worst outcome here.
 */
export function editProblems(
  ruleset: RulesetDefinition,
  edits: readonly RuleEdit[],
): string[] {
  const problems: string[] = [];
  const byId = new Map(ruleset.rules.map((r) => [r.id, r]));
  const seen = new Set<string>();

  for (const edit of edits) {
    const rule = byId.get(edit.ruleId);

    if (!rule) {
      problems.push(`There is no rule "${edit.ruleId}" in this ruleset.`);
      continue;
    }

    if (seen.has(edit.ruleId)) {
      problems.push(`"${rule.label}" was edited twice in one save.`);
    }
    seen.add(edit.ruleId);

    if (edit.outcome !== undefined && !OUTCOMES.includes(edit.outcome)) {
      problems.push(`"${rule.label}" has an outcome that is not red, amber or green.`);
    }

    if (edit.priority !== undefined) {
      if (!Number.isInteger(edit.priority) || edit.priority < 0 || edit.priority > 9999) {
        problems.push(`"${rule.label}" needs a priority between 0 and 9999.`);
      }
    }

    for (const change of edit.conditionValues ?? []) {
      const leaf = leafAt(rule.when, change.path);

      if (!leaf) {
        problems.push(
          `"${rule.label}" has changed shape since this screen was opened. `
          + 'Reload before editing it.',
        );
        continue;
      }

      if (leaf.op === 'between') {
        const range = change.range;
        if (!range || range.length !== 2 || !range.every((n) => Number.isFinite(n))) {
          problems.push(`"${rule.label}" needs two numbers for its range.`);
        } else if (range[0] > range[1]) {
          problems.push(`"${rule.label}" has a range that starts above where it ends.`);
        }
        continue;
      }

      if (leaf.op === 'exists' || leaf.op === 'notExists') {
        // Nothing to compare against, so nothing to edit.
        problems.push(`"${rule.label}" has a condition that takes no value.`);
        continue;
      }

      const numeric = ['gt', 'gte', 'lt', 'lte'].includes(leaf.op);
      if (numeric && !Number.isFinite(Number(change.value))) {
        problems.push(`"${rule.label}" compares a number, so it needs one.`);
      }

      const listy = ['in', 'nin'].includes(leaf.op);
      if (listy && (!Array.isArray(change.value) || change.value.length === 0)) {
        problems.push(`"${rule.label}" needs at least one option to match against.`);
      }
    }
  }

  return problems;
}

/**
 * The ruleset as it would be after these edits.
 *
 * Returns a new definition; the one passed in is untouched, because the caller
 * is holding the PUBLISHED version and must not modify it even in memory.
 */
export function applyEdits(
  ruleset: RulesetDefinition,
  edits: readonly RuleEdit[],
): RulesetDefinition {
  const byId = new Map(edits.map((e) => [e.ruleId, e]));

  return {
    ...ruleset,
    rules: ruleset.rules.map((rule): Rule => {
      const edit = byId.get(rule.id);
      if (!edit) return rule;

      let when = rule.when;
      for (const change of edit.conditionValues ?? []) {
        when = replaceLeafValue(when, change.path, change);
      }

      const next: Rule = { ...rule, when };

      if (edit.enabled !== undefined) next.enabled = edit.enabled;
      if (edit.outcome !== undefined) next.outcome = edit.outcome;
      if (edit.priority !== undefined) next.priority = edit.priority;

      if (edit.message !== undefined) {
        if (edit.message === null || edit.message.trim() === '') delete next.message;
        else next.message = edit.message.trim();
      }

      if (edit.patientMessage !== undefined) {
        if (edit.patientMessage === null || edit.patientMessage.trim() === '') {
          delete next.patientMessage;
        } else next.patientMessage = edit.patientMessage.trim();
      }

      return next;
    }),
  };
}

/** Did anything actually change? Publishing an identical version is noise. */
export function hasChanges(before: RulesetDefinition, after: RulesetDefinition): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/**
 * A one-line summary of what changed, for the audit entry.
 *
 * The audit already carries the whole before and after; this is what somebody
 * reads in a list without opening either.
 */
export function describeChanges(
  before: RulesetDefinition,
  after: RulesetDefinition,
): string[] {
  const lines: string[] = [];
  const beforeById = new Map(before.rules.map((r) => [r.id, r]));

  for (const rule of after.rules) {
    const was = beforeById.get(rule.id);
    if (!was || JSON.stringify(was) === JSON.stringify(rule)) continue;

    const changes: string[] = [];
    if ((was.enabled !== false) !== (rule.enabled !== false)) {
      changes.push(rule.enabled === false ? 'turned off' : 'turned on');
    }
    if (was.outcome !== rule.outcome) changes.push(`${was.outcome} → ${rule.outcome}`);
    if (was.priority !== rule.priority) {
      changes.push(`priority ${was.priority} → ${rule.priority}`);
    }
    if (was.message !== rule.message) changes.push('staff message reworded');
    if (was.patientMessage !== rule.patientMessage) changes.push('patient message reworded');
    if (JSON.stringify(was.when) !== JSON.stringify(rule.when)) changes.push('thresholds changed');

    lines.push(`${rule.label}: ${changes.join(', ') || 'changed'}`);
  }

  return lines;
}
