/**
 * Trying a ruleset out before trusting it with a patient.
 *
 * Twice during this build a ruleset returned GREEN for a figure no human body
 * has ever produced. A height typed in metres rather than centimetres gave a
 * BMI around 290,000, which satisfied `bmi >= 25` and cleared the eligibility
 * floor. A previous weight of 880kg instead of 88 gave a 90% loss, which
 * cleared `>= 2%`. Both were found by reading the rules by eye.
 *
 * That is the wrong way to find them. This lets somebody put values in and see
 * what the live ruleset does with them — including values that should never
 * occur, which is where the interesting failures are.
 *
 * It calls the same `evaluateRuleset` production calls. A simulator that
 * reimplements the engine tells you about the simulator.
 *
 * Pure, and free of any database, so it can be tested exhaustively.
 */

import {
  evaluateRuleset,
  type RulesetDefinition,
  type EvaluationResult,
  type EvaluationContext,
} from './engine';
import { ruleDependencies, type RuleDependency } from './coverage';
import { RANGE_BY_KIND } from '@/lib/clinical/plausibility';

/**
 * One thing the ruleset reads, and therefore one thing worth being able to set.
 *
 * `RuleDependency` already carries `key` — the part after the bucket — which is
 * what a box gets labelled with, so nothing is added here.
 */
export type SimulatorInput = RuleDependency;

/**
 * Every field this ruleset consults, deduplicated and ordered.
 *
 * Taken from the rules themselves rather than from the form, because the
 * question worth answering is "what does this ruleset look at", and a rule that
 * reads a field the form never asks is exactly the sort of mistake worth
 * seeing. Disabled rules are included — somebody about to enable one wants to
 * try it first.
 */
export function simulatorInputs(ruleset: RulesetDefinition): SimulatorInput[] {
  const seen = new Map<string, SimulatorInput>();

  for (const rule of ruleset.rules) {
    for (const dep of ruleDependencies(rule)) {
      if (seen.has(dep.path)) continue;
      seen.set(dep.path, dep);
    }
  }

  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Turn one typed-in string into the value the engine will compare against.
 *
 * An empty box means "not answered", and must stay absent from the context
 * rather than arriving as an empty string or a zero. The engine treats a
 * missing field as a rule that cannot be evaluated and skips it — the
 * skipped-not-passed rule the whole triage depends on — and a simulator that
 * quietly supplied 0 would show that rule passing or failing when in reality it
 * would not run at all.
 */
export function coerce(raw: string): unknown | undefined {
  const text = raw.trim();
  if (text === '') return undefined;

  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;

  // Number.isFinite rather than a regex: rejects "", "abc" and "Infinity",
  // accepts "-3", "0.5", "1e3".
  const asNumber = Number(text);
  if (text !== '' && Number.isFinite(asNumber)) return asNumber;

  return text;
}

export interface SimulationWarning {
  path: string;
  message: string;
}

export interface SimulationResult {
  evaluation: EvaluationResult;
  /** What was actually handed to the engine, after coercion. */
  context: EvaluationContext;
  /** Paths left blank, and therefore absent. */
  omitted: string[];
  /**
   * Values the engine accepted but a body could not produce.
   *
   * Not errors. The point is to be able to enter them: seeing a ruleset return
   * GREEN for a BMI of 290,000 is the entire reason this exists. They are
   * flagged so the person reading the result knows which input was absurd.
   */
  warnings: SimulationWarning[];
}

/** Ranges for the derived figures, which have no measurement kind of their own. */
const DERIVED_RANGE: Record<string, { min: number; max: number; unit: string }> = {
  bmi: { min: 8, max: 100, unit: '' },
  age: { min: 0, max: 130, unit: 'years' },
  weightLossPercent: { min: -100, max: 40, unit: '%' },
  weeksOnDose: { min: 0, max: 260, unit: 'weeks' },
  missedDoses: { min: 0, max: 52, unit: '' },
};

function plausibilityWarning(path: string, value: unknown): string | null {
  if (typeof value !== 'number') return null;

  const name = path.slice(path.indexOf('.') + 1);

  const derived = DERIVED_RANGE[name];
  if (derived && (value < derived.min || value > derived.max)) {
    return `${value} is outside ${derived.min}–${derived.max}${derived.unit ? ' ' + derived.unit : ''}`
      + ' — no patient would produce this.';
  }

  // Anything whose name looks like a measurement we already police elsewhere.
  for (const [kind, range] of Object.entries(RANGE_BY_KIND)) {
    if (!name.toLowerCase().includes(kind)) continue;
    if (value < range.min || value > range.max) {
      return `${value} is outside the plausible ${kind} range of ${range.min}–${range.max}.`;
    }
  }

  return null;
}

/**
 * Run the ruleset against typed-in values.
 *
 * `raw` is keyed by full path (`derived.bmi`, `answers.q_pregnant`) because
 * that is what the rules address and what the person is reading on screen.
 */
export function simulate(
  ruleset: RulesetDefinition,
  raw: Record<string, string>,
): SimulationResult {
  const context: EvaluationContext = { answers: {}, derived: {} };
  const omitted: string[] = [];
  const warnings: SimulationWarning[] = [];

  for (const [path, text] of Object.entries(raw)) {
    const value = coerce(text);

    if (value === undefined) {
      omitted.push(path);
      continue;
    }

    const dot = path.indexOf('.');
    const bucket = dot === -1 ? 'answers' : path.slice(0, dot);
    const key = dot === -1 ? path : path.slice(dot + 1);

    // Only the buckets the engine resolves. Anything else would be silently
    // ignored, which looks like a rule misbehaving rather than a typo.
    if (bucket !== 'answers' && bucket !== 'derived' && bucket !== 'patient' && bucket !== 'history') {
      continue;
    }

    const target = (context[bucket] ??= {}) as Record<string, unknown>;
    target[key] = value;

    const problem = plausibilityWarning(path, value);
    if (problem) warnings.push({ path, message: problem });
  }

  return {
    evaluation: evaluateRuleset(ruleset, context),
    context,
    omitted: omitted.sort(),
    warnings,
  };
}
