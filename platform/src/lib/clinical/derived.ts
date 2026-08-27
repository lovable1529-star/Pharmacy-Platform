/**
 * Derived values.
 *
 * The decision engine reads `derived.bmi`, `derived.doseStepChange` and friends
 * but computes nothing itself — it is a pure evaluator. This module is what
 * fills that context.
 *
 * Kept separate from the engine so that a clinical calculation can be tested on
 * its own, and so a rule can never accidentally depend on how a value was
 * computed.
 */

import { calculateBmi, percentageWeightLoss } from '@/lib/units';
import { MOUNJARO_STRENGTHS, WEGOVY_STRENGTHS } from '@/lib/services/weight-management';

export const DOSE_LADDERS: Record<string, string[]> = {
  Mounjaro: MOUNJARO_STRENGTHS,
  Wegovy: WEGOVY_STRENGTHS,
};

/** Splits `mounjaro_7.5mg` into its medicine and strength. */
export function parseMedicineValue(value: unknown): { medicine: string; strength: string } | null {
  if (typeof value !== 'string' || !value.includes('_')) return null;
  const [medicineKey, strength] = value.split('_');
  if (!medicineKey || !strength) return null;
  const medicine = medicineKey.charAt(0).toUpperCase() + medicineKey.slice(1);
  return DOSE_LADDERS[medicine] ? { medicine, strength } : null;
}

/** Position on the ladder, or null if the strength is not on it. */
export function ladderPosition(medicine: string, strength: string): number | null {
  const index = DOSE_LADDERS[medicine]?.indexOf(strength);
  return index === undefined || index === -1 ? null : index;
}

/**
 * Signed step change between two strengths. Positive is an increase.
 * Null when the two are not on the same ladder — which is itself a red flag,
 * and the ruleset treats a missing value as "do not proceed automatically".
 */
export function doseStepChange(from: unknown, to: unknown): number | null {
  const a = parseMedicineValue(from);
  const b = parseMedicineValue(to);
  if (!a || !b || a.medicine !== b.medicine) return null;

  const fromIndex = ladderPosition(a.medicine, a.strength);
  const toIndex = ladderPosition(b.medicine, b.strength);
  if (fromIndex === null || toIndex === null) return null;

  return toIndex - fromIndex;
}

export function ageInYears(dateOfBirth: string | Date, asOf = new Date()): number | null {
  const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
  if (Number.isNaN(dob.getTime())) return null;

  let age = asOf.getFullYear() - dob.getFullYear();
  const monthDelta = asOf.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < dob.getDate())) age -= 1;
  return age;
}

/** `weeksOnDose` arrives as a string because "50+" is a valid answer. */
export function parseWeeks(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value === '') return null;
  if (value.endsWith('+')) return Number(value.slice(0, -1));
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** `missedDoses` arrives as '0' | '1' | '2+'. */
export function parseMissedDoses(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (value === '2+') return 2;
  if (typeof value !== 'string' || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export interface DerivationInput {
  answers: Record<string, unknown>;
  /** Height and weight already converted to SI by the measurement control. */
  heightCm?: number | null;
  weightKg?: number | null;
  dateOfBirth?: string | null;
  /** The strength supplied last time, for computing the step change. */
  previousMedicineValue?: string | null;
  previousWeightKg?: number | null;
  now?: Date;
}

export interface DerivedValues {
  bmi: number | null;
  age: number | null;
  medicine: string | null;
  strength: string | null;
  weeksOnDose: number | null;
  missedDoses: number | null;
  doseStepChange: number | null;
  weightLossPercent: number | null;
  /** True when the answers themselves support moving up a step. */
  suggestsIncrease: boolean;
  [key: string]: unknown;
}

const POOR_SUPPRESSION = new Set(['wearing_off', 'poor']);
const HEAVY_SNACKING = new Set(['daily', 'frequent']);

export function deriveValues(input: DerivationInput): DerivedValues {
  const { answers, now = new Date() } = input;

  const current = parseMedicineValue(answers.currentMedicine ?? answers.requestedMedicine);

  const bmi =
    input.weightKg != null && input.heightCm != null
      ? calculateBmi(input.weightKg, input.heightCm)
      : null;

  const weightLossPercent =
    input.previousWeightKg != null && input.weightKg != null
      ? percentageWeightLoss(input.previousWeightKg, input.weightKg)
      : null;

  // The requested strength is only known once a dose direction is chosen; where
  // the form captures both, the step change is the ladder distance between them.
  const requested = answers.requestedMedicine ?? null;
  const doseStep =
    input.previousMedicineValue && requested
      ? doseStepChange(input.previousMedicineValue, requested)
      : null;

  const suppression = answers.appetiteSuppression;
  const snacking = answers.snacking;

  return {
    bmi,
    age: input.dateOfBirth ? ageInYears(input.dateOfBirth, now) : null,
    medicine: current?.medicine ?? null,
    strength: current?.strength ?? null,
    weeksOnDose: parseWeeks(answers.weeksOnDose),
    missedDoses: parseMissedDoses(answers.missedDoses),
    doseStepChange: doseStep,
    weightLossPercent,
    suggestsIncrease:
      POOR_SUPPRESSION.has(String(suppression)) || HEAVY_SNACKING.has(String(snacking)),
  };
}

/** Non-blocking notes shown to the pharmacist alongside the outcome. */
export function derivationWarnings(derived: DerivedValues): string[] {
  const warnings: string[] = [];

  if (derived.bmi === null) {
    warnings.push('BMI could not be calculated — height or weight is missing.');
  }
  if (derived.weeksOnDose === null) {
    warnings.push('Weeks on current dose not recorded, so dose-change timing could not be checked.');
  }
  if (derived.doseStepChange === null && derived.medicine !== null) {
    warnings.push('Previous strength unknown, so the size of the dose change could not be checked.');
  }

  return warnings;
}
