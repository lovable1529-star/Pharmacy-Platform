/**
 * Decision engine.
 *
 * Evaluates a versioned ruleset against a submission and returns an outcome
 * plus a complete trace of how it was reached.
 *
 * Deliberately pure — no database, no network, no clock reads. Everything it
 * needs arrives in the context. That is what makes the simulator possible: any
 * historical submission can be replayed against a draft ruleset to see exactly
 * what would have changed.
 *
 * Every rule is evaluated; we do not stop at the first match, because the trace
 * must show what the engine considered, not just what fired. A rule referencing
 * a missing field is SKIPPED and recorded as such — a missing answer must never
 * silently satisfy a safety rule.
 */

export type Outcome = 'GREEN' | 'AMBER' | 'RED';

export const OUTCOME_SEVERITY: Record<Outcome, number> = { GREEN: 0, AMBER: 1, RED: 2 };

export type ComparisonOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'nin' | 'contains' | 'exists' | 'notExists' | 'between';

export interface LeafCondition {
  /** Dot path — `answers.missedDoses` or `derived.bmi`. */
  field: string;
  op: ComparisonOperator;
  value?: unknown;
  /** Inclusive bounds, used with `between`. */
  range?: [number, number];
}

export interface AllCondition { all: Condition[] }
export interface AnyCondition { any: Condition[] }
export interface NotCondition { not: Condition }

export type Condition = LeafCondition | AllCondition | AnyCondition | NotCondition;

export interface Rule {
  id: string;
  /** Shown in the rule builder and in the decision trace. */
  label: string;
  /** Higher is evaluated first. Ties at equal severity go to the higher priority. */
  priority: number;
  outcome: Outcome;
  when: Condition;
  /** Shown to the clinician. Never phrased as an instruction to the patient. */
  message?: string;
  /** Shown to the patient. Must never contain a dose recommendation. */
  patientMessage?: string;
  /** Non-blocking guidance appended to the consultation summary. */
  advice?: string;
  enabled?: boolean;
}

export interface RulesetDefinition {
  schemaVersion: 1;
  /**
   * Applied when no rule matches. His stated philosophy is that the tool should
   * not block supply unnecessarily, but anything uncertain goes to a pharmacist
   * — so the safe default is AMBER, not GREEN.
   */
  defaultOutcome: Outcome;
  rules: Rule[];
}

export interface EvaluationContext {
  answers: Record<string, unknown>;
  derived: Record<string, unknown>;
  patient?: Record<string, unknown>;
  history?: Record<string, unknown>;
}

export interface RuleTraceEntry {
  ruleId: string;
  label: string;
  priority: number;
  outcome: Outcome;
  matched: boolean;
  /** Present when the rule could not be evaluated — e.g. a missing field. */
  skippedReason?: string;
}

export interface EvaluationResult {
  outcome: Outcome;
  decidingRuleId: string | null;
  message?: string;
  patientMessage?: string;
  advice: string[];
  trace: RuleTraceEntry[];
  derived: Record<string, unknown>;
}

class MissingFieldError extends Error {
  constructor(public readonly field: string) {
    super(`Field not present in evaluation context: ${field}`);
    this.name = 'MissingFieldError';
  }
}

export function resolvePath(context: EvaluationContext, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split('.')) {
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
  if (Number.isNaN(n)) throw new TypeError(`Expected a number, received: ${String(value)}`);
  return n;
}

function evaluateLeaf(condition: LeafCondition, context: EvaluationContext): boolean {
  const actual = resolvePath(context, condition.field);

  // Existence checks are the only operators valid against a missing field.
  if (condition.op === 'exists') return isPresent(actual);
  if (condition.op === 'notExists') return !isPresent(actual);

  if (!isPresent(actual)) throw new MissingFieldError(condition.field);

  switch (condition.op) {
    case 'eq': return actual === condition.value;
    case 'neq': return actual !== condition.value;
    case 'gt': return toNumber(actual) > toNumber(condition.value);
    case 'gte': return toNumber(actual) >= toNumber(condition.value);
    case 'lt': return toNumber(actual) < toNumber(condition.value);
    case 'lte': return toNumber(actual) <= toNumber(condition.value);
    case 'in': return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'nin': return Array.isArray(condition.value) && !condition.value.includes(actual);
    case 'contains': {
      if (Array.isArray(actual)) return actual.includes(condition.value);
      return String(actual).toLowerCase().includes(String(condition.value).toLowerCase());
    }
    case 'between': {
      if (!condition.range) return false;
      const n = toNumber(actual);
      return n >= condition.range[0] && n <= condition.range[1];
    }
    default: {
      const exhaustive: never = condition.op;
      throw new Error(`Unsupported operator: ${String(exhaustive)}`);
    }
  }
}

export function evaluateCondition(condition: Condition, context: EvaluationContext): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, context));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, context));
  if ('not' in condition) return !evaluateCondition(condition.not, context);
  return evaluateLeaf(condition, context);
}

export function evaluateRuleset(
  ruleset: RulesetDefinition,
  context: EvaluationContext,
): EvaluationResult {
  const trace: RuleTraceEntry[] = [];
  const advice: string[] = [];

  const rules = [...ruleset.rules]
    .filter((r) => r.enabled !== false)
    .sort((a, b) => b.priority - a.priority);

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
          ? `Missing answer: ${error.field}`
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

    // Most severe wins. Rules are pre-sorted by priority descending, so the
    // first match at a given severity is already the highest-priority one.
    if (winner === null || OUTCOME_SEVERITY[rule.outcome] > OUTCOME_SEVERITY[winner.outcome]) {
      winner = rule;
    }
  }

  return {
    outcome: winner?.outcome ?? ruleset.defaultOutcome,
    decidingRuleId: winner?.id ?? null,
    ...(winner?.message ? { message: winner.message } : {}),
    ...(winner?.patientMessage ? { patientMessage: winner.patientMessage } : {}),
    advice,
    trace,
    derived: context.derived,
  };
}
