/**
 * Turning a completed first supply into a repeat care enrolment.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * Repeat access requires a `repeat_enrolment` row: the gate at
 * `/repeat/[slug]` rejects anybody without one, and it is deliberately a
 * clinical authorisation rather than an administrative flag.
 *
 * The only thing that created one was a button on the consultation record. A
 * remote new patient never has a consultation — they submit online, are
 * telephoned, approved, pay and are supplied — so as the system stood, a
 * patient could complete the entire new-patient journey and then never be able
 * to use the repeat service. The chain dead-ended at its most important join.
 *
 * ── Why supply, and not approval ─────────────────────────────────────────
 *
 * The client's own rule: history moves forward only after a real supply.
 * Enrolling at approval would set a baseline for medicine that might never
 * leave the pharmacy — and the next request's weight loss and dose step are
 * both measured from that baseline.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────
 *
 * It does not decide policy. Whether enrolment should be automatic at all is a
 * question for the pharmacy, because enrolment is an authorisation to supply
 * without being seen. This computes the baseline and names who authorised it;
 * the caller decides whether to write it.
 */

import { medicineValue } from '@/lib/clinical/previous-supply';
import { siValue } from '@/lib/forms/present';
import type { DoseLadders } from '@/lib/clinical/derived';
import type { Answers } from '@/types/form-schema';

export interface SuppliedRecord {
  /** What was actually dispensed, from the prescription snapshots. */
  medicineName: string | null;
  strength: string | null;
  /** The questionnaire behind it. */
  answers: Answers;
  suppliedAt: Date;
}

export interface EnrolmentSeed {
  heightCm: string | null;
  startingWeightKg: string | null;
  startingWaistCm: string | null;
  medicine: string | null;
  strength: string | null;
  /** ISO date the current strength began. */
  strengthSince: string | null;
  lastSuppliedAt: Date;
  lastWeightKg: string | null;
}

function measure(answers: Answers, key: string): string | null {
  const si = siValue(answers, key);
  if (si === null || !Number.isFinite(si) || si <= 0) return null;
  return String(Math.round(si * 10) / 10);
}

/**
 * The baseline this patient's future requests are measured against.
 *
 * Built from what was SUPPLIED rather than what was requested. A pharmacist
 * who reduced the dose during the verification call must not have the
 * patient's original request recorded as their starting strength — the
 * dose-step rules would then read a change that never happened.
 */
export function enrolmentSeedFromSupply(
  record: SuppliedRecord,
  ladders?: DoseLadders,
): EnrolmentSeed {
  const { answers } = record;

  /*
   * A transfer patient brought a history with them. Their baseline weight is
   * what they weighed when treatment STARTED, not what they weigh today —
   * otherwise their progress restarts from zero the moment they move to us,
   * and months of loss stop counting.
   */
  const startingWeight = measure(answers, 'priorStartingWeight') ?? measure(answers, 'weight');

  return {
    heightCm: measure(answers, 'height'),
    startingWeightKg: startingWeight,
    startingWaistCm: measure(answers, 'waist'),
    medicine: record.medicineName?.trim() || null,
    strength: record.strength?.trim() || null,
    /*
     * Dated from the supply. A transfer patient's `priorStartedOn` describes a
     * strength another clinic gave them; the strength WE supplied starts now,
     * and the three-week and six-week rules count from this.
     */
    strengthSince: record.suppliedAt.toISOString().slice(0, 10),
    lastSuppliedAt: record.suppliedAt,
    // Today's weight, which the next request's loss is measured against.
    lastWeightKg: measure(answers, 'weight'),
  };
}

/**
 * Whether this supply can seed a usable enrolment.
 *
 * An enrolment missing its medicine and strength disables every dose rule, and
 * one missing a weight disables the loss rules. Creating it anyway is still
 * better than leaving the patient locked out of repeat care — but the caller
 * should know, and say so.
 */
export function seedGaps(seed: EnrolmentSeed): string[] {
  const gaps: string[] = [];
  if (!seed.medicine || !seed.strength) {
    gaps.push('medicine and strength — the dose-step rules cannot run without them');
  }
  if (!seed.startingWeightKg) {
    gaps.push('a starting weight — weight loss cannot be measured at the next request');
  }
  if (!seed.heightCm) {
    gaps.push('a height — BMI will not be calculated');
  }
  return gaps;
}

/** Rebuilds the option value the rules engine compares strengths with. */
export function seedMedicineValue(
  seed: EnrolmentSeed,
  ladders?: DoseLadders,
): string | null {
  return medicineValue(seed.medicine, seed.strength, ladders);
}
