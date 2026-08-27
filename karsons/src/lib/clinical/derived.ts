/**
 * Derived values.
 *
 * The decision engine reads `derived.bmi`, `derived.doseStepChange` and friends,
 * but computes nothing itself — it is a pure evaluator. This module is what
 * fills that context.
 *
 * The separation is deliberate. Derivation involves lookups (dose ladders) and
 * history (previous supplies) that would make the engine impure and the
 * simulator impossible. Keeping it here means both stay testable.
 *
 * SAFETY NOTE: `doseStepChange` is what makes the "no skipping strengths" RED
 * rule fire. Without it that rule silently never triggers, and a patient
 * requesting 2.5mg → 10mg would come back GREEN. Do not remove or shortcut it.
 */

import { calculateBmi, percentageWeightLoss } from '@/lib/units';
import { ageInYears } from '@/lib/patients/search';

/**
 * Licensed dose ladders, in ascending order.
 *
 * These are the maintenance escalation steps for each product. A "step" is one
 * position on this ladder — which is why the ladder has to be explicit rather
 * than inferred from the numbers: the gaps are not uniform.
 *
 * The client edits these in Settings once the platform is live. Seeded here.
 */
export const DOSE_LADDERS: Record<string, string[]> = {
  Mounjaro: ['2.5mg', '5mg', '7.5mg', '10mg', '12.5mg', '15mg'],
  Wegovy: ['0.25mg', '0.5mg', '1mg', '1.7mg', '2.4mg'],
  Ozempic: ['0.25mg', '0.5mg', '1mg', '2mg'],
  Saxenda: ['0.6mg', '1.2mg', '1.8mg', '2.4mg', '3mg'],
};

/** Normalises "5 mg", "5MG", "5mg" to a single comparable form. */
function normaliseStrength(strength: string): string {
  return strength.toLowerCase().replace(/\s+/g, '');
}

export function ladderFor(medicine: string): string[] | null {
  const key = Object.keys(DOSE_LADDERS).find((name) =>
    medicine.toLowerCase().includes(name.toLowerCase()),
  );
  return key ? DOSE_LADDERS[key]! : null;
}

export function ladderPosition(medicine: string, strength: string): number | null {
  const ladder = ladderFor(medicine);
  if (!ladder) return null;

  const target = normaliseStrength(strength);
  const index = ladder.findIndex((step) => normaliseStrength(step) === target);
  return index === -1 ? null : index;
}

/**
 * How many rungs apart two strengths are.
 *
 * Returns `null` when either strength is unrecognised — the caller must treat
 * that as "cannot verify" and route to a pharmacist, never as zero. A zero would
 * mean "no change", which is exactly the wrong assumption on unknown data.
 */
export function doseStepChange(
  medicine: string,
  fromStrength: string,
  toStrength: string,
): number | null {
  const from = ladderPosition(medicine, fromStrength);
  const to = ladderPosition(medicine, toStrength);

  if (from === null || to === null) return null;
  return Math.abs(to - from);
}

export function doseDirection(
  medicine: string,
  fromStrength: string,
  toStrength: string,
): 'Increase' | 'Decrease' | 'Same' | null {
  const from = ladderPosition(medicine, fromStrength);
  const to = ladderPosition(medicine, toStrength);

  if (from === null || to === null) return null;
  if (to > from) return 'Increase';
  if (to < from) return 'Decrease';
  return 'Same';
}

// ─────────────────────────────────────────────────────────────

export interface PreviousSupply {
  suppliedAt: Date;
  strength: string;
  weightKg?: number | null;
}

export interface DerivationInput {
  medicine: string;
  requestedStrength: string;
  currentStrength: string;
  weightKg?: number | null;
  heightCm?: number | null;
  dateOfBirth: Date;
  /** Most recent first or last — order does not matter, we sort. */
  previousSupplies: PreviousSupply[];
  baselineWeightKg?: number | null;
  now?: Date;
}

export interface DerivedValues {
  age: number;
  bmi: number | null;
  /** Positive means weight lost, matching how the clinical rules are phrased. */
  weightLossPercent: number | null;
  /** Weight change since the very first recorded weight. */
  totalWeightLossPercent: number | null;
  weeksOnCurrentDose: number | null;
  doseStepChange: number | null;
  doseDirection: 'Increase' | 'Decrease' | 'Same' | null;
  weeksSinceLastSupply: number | null;
  suppliesToDate: number;
}

/**
 * How long the patient has been on their current strength.
 *
 * Counts back through the supply history to the first supply at the current
 * strength — not simply the time since the last supply. A patient on 5mg for
 * three consecutive monthly supplies has been stable for ~12 weeks, not 4, and
 * the 3-week and 6-week stability rules depend on that distinction.
 */
export function weeksOnCurrentDose(
  currentStrength: string,
  previousSupplies: PreviousSupply[],
  now = new Date(),
): number | null {
  if (previousSupplies.length === 0) return null;

  const sorted = [...previousSupplies].sort(
    (a, b) => b.suppliedAt.getTime() - a.suppliedAt.getTime(),
  );

  const target = normaliseStrength(currentStrength);
  let earliestAtStrength: Date | null = null;

  for (const supply of sorted) {
    if (normaliseStrength(supply.strength) !== target) break;
    earliestAtStrength = supply.suppliedAt;
  }

  if (!earliestAtStrength) return null;
  return Math.floor((now.getTime() - earliestAtStrength.getTime()) / (7 * 86_400_000));
}

export function deriveValues(input: DerivationInput): DerivedValues {
  const now = input.now ?? new Date();

  const sorted = [...input.previousSupplies].sort(
    (a, b) => b.suppliedAt.getTime() - a.suppliedAt.getTime(),
  );
  const lastSupply = sorted[0];

  const lastWeighed = sorted.find((s) => typeof s.weightKg === 'number')?.weightKg ?? null;
  const firstWeighed =
    [...sorted].reverse().find((s) => typeof s.weightKg === 'number')?.weightKg ??
    input.baselineWeightKg ??
    null;

  const currentWeight = input.weightKg ?? null;

  return {
    age: ageInYears(input.dateOfBirth, now),

    bmi:
      currentWeight && input.heightCm ? calculateBmi(currentWeight, input.heightCm) : null,

    weightLossPercent:
      currentWeight && lastWeighed ? percentageWeightLoss(lastWeighed, currentWeight) : null,

    totalWeightLossPercent:
      currentWeight && firstWeighed ? percentageWeightLoss(firstWeighed, currentWeight) : null,

    weeksOnCurrentDose: weeksOnCurrentDose(input.currentStrength, input.previousSupplies, now),

    doseStepChange: doseStepChange(
      input.medicine,
      input.currentStrength,
      input.requestedStrength,
    ),

    doseDirection: doseDirection(
      input.medicine,
      input.currentStrength,
      input.requestedStrength,
    ),

    weeksSinceLastSupply: lastSupply
      ? Math.floor((now.getTime() - lastSupply.suppliedAt.getTime()) / (7 * 86_400_000))
      : null,

    suppliesToDate: input.previousSupplies.length,
  };
}

/**
 * Flags derived values that could not be computed.
 *
 * A null is not a neutral value here. If `doseStepChange` is null the safety
 * rule that blocks strength-skipping cannot evaluate, so the request must go to
 * a pharmacist rather than proceed. The caller uses this to force AMBER.
 */
export function derivationWarnings(derived: DerivedValues): string[] {
  const warnings: string[] = [];

  if (derived.bmi === null) {
    warnings.push('BMI could not be calculated — weight or height is missing.');
  }
  if (derived.doseStepChange === null) {
    warnings.push(
      'Dose change could not be verified — the strength is not on a recognised ladder.',
    );
  }
  if (derived.weeksOnCurrentDose === null && derived.suppliesToDate > 0) {
    warnings.push('Time on current strength could not be determined from supply history.');
  }
  return warnings;
}

/** True when any safety-relevant derivation failed, forcing pharmacist review. */
export function requiresManualReview(derived: DerivedValues): boolean {
  return derived.doseStepChange === null || derived.bmi === null;
}
