/**
 * Rule schema — the structure emitted by the rule builder and evaluated by
 * `src/lib/rules/engine.ts`.
 *
 * Design notes:
 *
 * 1. This is plain data. It is stored as JSONB, versioned, and immutable once
 *    published. That is what makes the rule simulator possible — we can replay
 *    any historical submission against any version of the rules.
 *
 * 2. The engine that consumes this is a pure function with no I/O. Given the
 *    same inputs it always produces the same outputs, including the trace.
 *
 * 3. Outcomes are advisory. Under no circumstances does a GREEN outcome result
 *    in an automatic supply — a pharmacist confirms every prescription. See
 *    CLAUDE.md §3 for why this is a regulatory requirement and not a preference.
 */

/** Severity ordering. RED always wins, then AMBER, then GREEN. */
export type Outcome = 'GREEN' | 'AMBER' | 'RED';

export const OUTCOME_SEVERITY: Record<Outcome, number> = {
  GREEN: 0,
  AMBER: 1,
  RED: 2,
};

export type ComparisonOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'exists'
  | 'notExists'
  | 'between';

/** A single comparison against one field in the evaluation context. */
export interface LeafCondition {
  /**
   * Field path. May reference a submission answer (`answers.weightKg`) or a
   * derived value (`derived.bmi`). Dot notation is resolved by the engine.
   */
  field: string;
  op: ComparisonOperator;
  value?: unknown;
  /** Only used with `between` — inclusive lower and upper bounds. */
  range?: [number, number];
}

export interface AllCondition {
  all: Condition[];
}
export interface AnyCondition {
  any: Condition[];
}
export interface NotCondition {
  not: Condition;
}

export type Condition = LeafCondition | AllCondition | AnyCondition | NotCondition;

export interface Rule {
  id: string;
  /** Shown to the client in the rule builder, and in the decision trace. */
  label: string;
  /**
   * Higher priority is evaluated first. Where two rules produce the same
   * outcome severity, the higher-priority rule supplies the message.
   */
  priority: number;
  outcome: Outcome;
  when: Condition;
  /** Shown to the clinician. Never phrased as an instruction to the patient. */
  message?: string;
  /** Shown to the patient. Must not contain dose recommendations. */
  patientMessage?: string;
  /** Non-blocking guidance appended to the consultation summary. */
  advice?: string;
  enabled?: boolean;
}

export interface RulesetDefinition {
  schemaVersion: 1;
  /**
   * Applied when no rule matches. The client's stated philosophy is that the
   * tool should not block supply unnecessarily, but anything uncertain goes to
   * a pharmacist — so the safe default is AMBER, not GREEN.
   */
  defaultOutcome: Outcome;
  rules: Rule[];
}

// ─────────────────────────────────────────────────────────────
// Evaluation results
// ─────────────────────────────────────────────────────────────

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
  /** The rule responsible for the final outcome, if any matched. */
  decidingRuleId: string | null;
  message?: string;
  patientMessage?: string;
  /** Advice from every matched rule, in priority order. */
  advice: string[];
  /** Every rule considered, in evaluation order. Stored for audit. */
  trace: RuleTraceEntry[];
  /** Computed values used during evaluation — BMI, weeks on dose, etc. */
  derived: Record<string, unknown>;
}

export interface EvaluationContext {
  answers: Record<string, unknown>;
  derived: Record<string, unknown>;
  patient?: Record<string, unknown>;
  history?: Record<string, unknown>;
}
