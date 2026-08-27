/**
 * Decision engine.
 *
 * Evaluates a versioned ruleset against a submission and returns an outcome
 * plus a complete trace of how it was reached.
 *
 * This module is deliberately pure — no database access, no network, no clock
 * reads. Everything it needs arrives in the context. That is what makes the
 * rule simulator possible: we can replay any historical submission against a
 * draft ruleset and see exactly what would have changed.
 *
 * IMPORTANT: a GREEN outcome does not authorise a supply. It means "no rule
 * flagged a concern". A pharmacist confirms every prescription regardless.
 */

import type {
  Condition,
  EvaluationContext,
  EvaluationResult,
  LeafCondition,
  Rule,
  RulesetDefinition,
  RuleTraceEntry,
  Outcome,
} from '@/types/rule-schema';
import { OUTCOME_SEVERITY } from '@/types/rule-schema';

class MissingFieldError extends Error {
  constructor(public readonly field: string) {
    super(`Field not present in evaluation context: ${field}`);
    this.name = 'MissingFieldError';
  }
}

/** Resolves a dot-notation path such as `derived.bmi` or `answers.weightKg`. */
export function resolvePath(context: EvaluationContext, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = context;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) {
    throw new TypeError(`Expected a numeric value, received: ${String(value)}`);
  }
  return n;
}

function evaluateLeaf(condition: LeafCondition, context: EvaluationContext): boolean {
  const actual = resolvePath(context, condition.field);

  // Existence checks are the only operators valid against a missing field.
  if (condition.op === 'exists') return isPresent(actual);
  if (condition.op === 'notExists') return !isPresent(actual);

  if (!isPresent(actual)) {
    throw new MissingFieldError(condition.field);
  }

  switch (condition.op) {
    case 'eq':
      return actual === condition.value;
    case 'neq':
      return actual !== condition.value;
    case 'gt':
      return toNumber(actual) > toNumber(condition.value);
    case 'gte':
      return toNumber(actual) >= toNumber(condition.value);
    case 'lt':
      return toNumber(actual) < toNumber(condition.value);
    case 'lte':
      return toNumber(actual) <= toNumber(condition.value);
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'nin':
      return Array.isArray(condition.value) && !condition.value.includes(actual);
    case 'contains': {
      if (Array.isArray(actual)) return actual.includes(condition.value);
      return String(actual).toLowerCase().includes(String(condition.value).toLowerCase());
    }
    case 'between': {
      if (!condition.range) return false;
      const n = toNumber(actual);
      const [lower, upper] = condition.range;
      return n >= lower && n <= upper;
    }
    default: {
      const exhaustive: never = condition.op;
      throw new Error(`Unsupported operator: ${String(exhaustive)}`);
    }
  }
}

export function evaluateCondition(condition: Condition, context: EvaluationContext): boolean {
  if ('all' in condition) {
    return condition.all.every((c) => evaluateCondition(c, context));
  }
  if ('any' in condition) {
    return condition.any.some((c) => evaluateCondition(c, context));
  }
  if ('not' in condition) {
    return !evaluateCondition(condition.not, context);
  }
  return evaluateLeaf(condition, context);
}

function byPriorityDescending(a: Rule, b: Rule): number {
  return b.priority - a.priority;
}

/**
 * Evaluate a ruleset.
 *
 * Every rule is evaluated — we do not stop at the first match — because the
 * trace must show the client what the engine considered, not just what fired.
 * Advice from all matched rules is collected, since guidance is additive.
 *
 * A rule referencing a field that is not present is skipped and recorded as
 * such. Skipping is deliberate: a missing answer should never silently satisfy
 * a safety rule.
 */
export function evaluateRuleset(
  ruleset: RulesetDefinition,
  context: EvaluationContext,
): EvaluationResult {
  const trace: RuleTraceEntry[] = [];
  const advice: string[] = [];

  const rules = [...ruleset.rules]
    .filter((r) => r.enabled !== false)
    .sort(byPriorityDescending);

  let winner: Rule | null = null;

  for (const rule of rules) {
    let matched = false;
    let skippedReason: string | undefined;

    try {
      matched = evaluateCondition(rule.when, context);
    } catch (error) {
      matched = false;
      skippedReason =
        error instanceof MissingFieldError
          ? `Missing field: ${error.field}`
          : error instanceof Error
            ? error.message
            : 'Evaluation error';
    }

    trace.push({
      ruleId: rule.id,
      label: rule.label,
      priority: rule.priority,
      outcome: rule.outcome,
      matched,
      ...(skippedReason ? { skippedReason } : {}),
    });

    if (!matched) continue;

    if (rule.advice) advice.push(rule.advice);

    // Most severe outcome wins. Ties are resolved by priority, and because
    // rules are pre-sorted descending, the first match at a given severity
    // is already the highest-priority one.
    if (
      winner === null ||
      OUTCOME_SEVERITY[rule.outcome] > OUTCOME_SEVERITY[winner.outcome]
    ) {
      winner = rule;
    }
  }

  const outcome: Outcome = winner?.outcome ?? ruleset.defaultOutcome;

  return {
    outcome,
    decidingRuleId: winner?.id ?? null,
    ...(winner?.message ? { message: winner.message } : {}),
    ...(winner?.patientMessage ? { patientMessage: winner.patientMessage } : {}),
    advice,
    trace,
    derived: context.derived,
  };
}
