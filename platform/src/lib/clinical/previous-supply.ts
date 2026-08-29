/**
 * What this patient was supplied last time.
 *
 * The decision engine needs two facts that are not in the questionnaire:
 * the weight recorded at the previous supply, and the strength they are
 * currently on. Without them `derived.weightLossPercent` and
 * `derived.doseStepChange` are null, and a rule that reads a missing field is
 * skipped rather than passed.
 *
 * Four rules depended on those two values and had therefore never fired —
 * including BOTH routes to GREEN, so nothing could ever be auto-approved and
 * every repeat request fell through to the AMBER default. The rule blocking a
 * jump of more than one strength step had never run either.
 *
 * The data was already there. `repeat_enrolment` records the baseline and is
 * updated on each supply; it simply was not being read at submission time.
 *
 * Taking these from the pharmacy's own record rather than from what the patient
 * types is also the safer reading: the previous scope of work is explicit that
 * patients must not be able to circumvent the clinical checks, and a
 * self-reported previous weight is exactly the number someone would adjust to
 * clear a 2% threshold.
 */

import { and, eq } from 'drizzle-orm';
import type { Reader } from '@/lib/actions';
import { repeatEnrolment } from '@/lib/db/schema';
import { DOSE_LADDERS, type DoseLadders } from '@/lib/clinical/derived';

export interface PreviousSupply {
  /** `mounjaro_7.5mg` — the shape `parseMedicineValue` expects. */
  previousMedicineValue: string | null;
  previousWeightKg: number | null;
}

const NOTHING: PreviousSupply = { previousMedicineValue: null, previousWeightKg: null };

/**
 * Rebuild the option value from the two columns the enrolment stores.
 *
 * Returns null unless the result is genuinely on a ladder. A medicine or
 * strength that has drifted — renamed, mistyped, discontinued — must produce no
 * step change rather than a wrong one, because the step change gates a RED.
 */
export function medicineValue(
  medicine: string | null,
  strength: string | null,
  ladders: DoseLadders = DOSE_LADDERS,
): string | null {
  if (!medicine || !strength) return null;

  const canonical = medicine.trim();
  const key = canonical.charAt(0).toUpperCase() + canonical.slice(1).toLowerCase();
  const ladder = ladders[key];
  if (!ladder || !ladder.includes(strength.trim())) return null;

  return `${key.toLowerCase()}_${strength.trim()}`;
}

/**
 * The previous supply for this patient on this service.
 *
 * Absent enrolment is normal, not an error: a first consultation, a walk-in, or
 * a service that has no repeat pathway at all. Everything returns null and the
 * dependent rules skip exactly as they do today.
 */
export async function loadPreviousSupply(
  tx: Reader,
  input: {
    organisationId: string;
    patientId: string | null;
    serviceId: string;
    ladders?: DoseLadders;
  },
): Promise<PreviousSupply> {
  if (!input.patientId) return NOTHING;

  const [row] = await tx
    .select({
      medicine: repeatEnrolment.medicine,
      strength: repeatEnrolment.strength,
      lastWeightKg: repeatEnrolment.lastWeightKg,
      startingWeightKg: repeatEnrolment.startingWeightKg,
      status: repeatEnrolment.status,
    })
    .from(repeatEnrolment)
    .where(
      and(
        eq(repeatEnrolment.organisationId, input.organisationId),
        eq(repeatEnrolment.patientId, input.patientId),
        eq(repeatEnrolment.serviceId, input.serviceId),
      ),
    )
    .limit(1);

  if (!row) return NOTHING;

  // Before a second supply exists there is no "last" weight, so the baseline is
  // the only honest comparison — it is what the first month's loss is measured
  // against anyway.
  const previous = row.lastWeightKg ?? row.startingWeightKg;
  const weight = previous == null ? null : Number(previous);

  return {
    previousMedicineValue: medicineValue(row.medicine, row.strength, input.ladders),
    previousWeightKg: Number.isFinite(weight) ? weight : null,
  };
}
