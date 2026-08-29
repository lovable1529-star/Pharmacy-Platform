/**
 * The repeat care baseline, read out of the consultation that justified it.
 *
 * Enrolment used to mean opening the patient's record and retyping height,
 * weight, waist, medicine and strength — every one of which the consultation
 * had just collected. Retyping a weight is how a baseline ends up disagreeing
 * with the consultation it came from, and the baseline is not a note: the
 * rules are relative to it. "At least 2% weight loss since last supply" is
 * measured from this number.
 *
 * So it is derived, shown to the pharmacist, and editable before it is saved.
 * Derived-and-confirmed rather than derived-and-assumed, because the person
 * enrolling is the one taking clinical responsibility for it.
 */

import { parseMedicineValue } from '@/lib/clinical/derived';
import { siValue } from '@/lib/forms/present';
import type { DoseLadders } from '@/lib/clinical/derived';
import type { Answers } from '@/types/form-schema';

export interface EnrolmentBaseline {
  heightCm: string;
  startingWeightKg: string;
  startingWaistCm: string;
  medicine: string;
  strength: string;
  strengthSince: string;
}

/** Empty string, not "0" — a blank box reads as "not recorded", 0 reads as a measurement. */
function measurement(answers: Answers, key: string): string {
  const si = siValue(answers, key);
  if (si === null || !Number.isFinite(si) || si <= 0) return '';
  // One decimal place: the scales give 78.4 kg, and 78.4000000001 in a text box
  // looks like the system inventing precision it does not have.
  return String(Math.round(si * 10) / 10);
}

/**
 * Build the prefill.
 *
 * `startedOn` is the date the strength is recorded as beginning. It defaults to
 * the consultation, not to today: enrolling somebody a week after their
 * appointment must not reset the clock on "three weeks at this dose".
 */
export function enrolmentBaseline(
  answers: Answers,
  options: { startedOn?: Date | null; ladders?: DoseLadders } = {},
): EnrolmentBaseline {
  /*
   * `currentMedicine` first, then `requestedMedicine` — the same precedence the
   * derivation uses. A repeat questionnaire records what they are on; a first
   * consultation records what they are being started on. Either is the strength
   * the baseline begins at.
   */
  const medicineValue = answers.currentMedicine ?? answers.requestedMedicine;
  const parsed = parseMedicineValue(medicineValue, options.ladders);

  const startedOn = options.startedOn ?? null;

  return {
    heightCm: measurement(answers, 'height'),
    startingWeightKg: measurement(answers, 'weight'),
    startingWaistCm: measurement(answers, 'waist'),
    medicine: parsed?.medicine ?? '',
    strength: parsed?.strength ?? '',
    strengthSince: startedOn ? startedOn.toISOString().slice(0, 10) : '',
  };
}

/**
 * What is missing before the rules can work properly.
 *
 * Not a validation error — a pharmacist is allowed to enrol somebody whose
 * waist was never measured. It is a warning, because each absent value silently
 * disables the rules that read it, and "the rules quietly stopped applying" is
 * the failure this system exists to prevent.
 */
export function baselineGaps(baseline: EnrolmentBaseline): string[] {
  const gaps: string[] = [];
  if (!baseline.startingWeightKg) {
    gaps.push('Starting weight — without it, weight loss cannot be measured at the next request.');
  }
  if (!baseline.heightCm) {
    gaps.push('Height — without it, BMI is not calculated and the BMI rules are skipped.');
  }
  if (!baseline.medicine || !baseline.strength) {
    gaps.push('Medicine and strength — without them, the dose-step rules are skipped.');
  }
  return gaps;
}
