/**
 * Measurements that could not have come from a person.
 *
 * The rules engine decides green, amber and red from a BMI it computes out of
 * a height and a weight the patient typed. Nothing checked either of them, and
 * the failure is not the one you would guess.
 *
 * A height entered in metres — 1.7 rather than 170 — produces a BMI of about
 * 290,000. That does not fail any rule. It SATISFIES them: the rule that
 * authorises a routine repeat requires `bmi >= 25`, and 290,000 clears that
 * comfortably. So the worst typo on the form returns GREEN and the patient is
 * supplied without a pharmacist ever looking at it. Measured, not theorised —
 * see the test named for it.
 *
 * The fix is not to guess what the patient meant. 1.7 is probably metres, but
 * "probably" has no place here, and silently multiplying somebody's height by
 * a hundred is a worse failure than refusing it. So an implausible measurement
 * yields no value at all, the rules that read it are recorded as SKIPPED
 * rather than passed, and the request falls to the AMBER default — which is a
 * pharmacist reading it. That is the outcome you want when the data is wrong.
 *
 * Bounds are deliberately generous. They exist to catch a decimal point in the
 * wrong place, not to argue with an unusual patient.
 */

export interface Range {
  min: number;
  max: number;
}

/** 50cm is a newborn; 250cm is taller than the tallest adult ever recorded. */
export const HEIGHT_CM: Range = { min: 50, max: 250 };

/** 20kg is a small child; 500kg is beyond the heaviest recorded adult. */
export const WEIGHT_KG: Range = { min: 20, max: 500 };

/**
 * Waist, in centimetres.
 *
 * The floor is 50 rather than 30 because this is an adult service and the
 * error it exists to catch is inches typed into a centimetres box. A 34-inch
 * waist entered as 34 is caught; a 55-inch one entered as 55 is not, because
 * 55cm is a possible if very small adult and there is no way to tell the two
 * apart from the number alone. Catching the common mistake is worth doing even
 * though it cannot catch every one.
 */
export const WAIST_CM: Range = { min: 50, max: 200 };

/**
 * The result, checked as well as the inputs.
 *
 * Bounding height and weight separately still admits absurd combinations — a
 * 50cm, 500kg patient computes to 2000. Checking the answer closes that
 * without needing a rule about which of the two was wrong.
 */
export const BMI: Range = { min: 8, max: 100 };

export function within(value: number | null | undefined, range: Range): boolean {
  if (value === null || value === undefined) return false;
  if (!Number.isFinite(value)) return false;
  return value >= range.min && value <= range.max;
}

/**
 * Could a person be this tall, and weigh this much?
 *
 * Returns the reason rather than a boolean, so the form can say which figure
 * to look at instead of "check your measurements".
 */
export function measurementProblem(input: {
  heightCm?: number | null;
  weightKg?: number | null;
  waistCm?: number | null;
}): string | null {
  if (input.heightCm !== undefined && input.heightCm !== null
      && !within(input.heightCm, HEIGHT_CM)) {
    return `That height does not look right. Enter it in centimetres — ${HEIGHT_CM.min} to ${HEIGHT_CM.max}.`;
  }

  if (input.weightKg !== undefined && input.weightKg !== null
      && !within(input.weightKg, WEIGHT_KG)) {
    return `That weight does not look right. Enter it in kilograms — ${WEIGHT_KG.min} to ${WEIGHT_KG.max}.`;
  }

  if (input.waistCm !== undefined && input.waistCm !== null
      && !within(input.waistCm, WAIST_CM)) {
    return `That waist measurement does not look right. Enter it in centimetres — ${WAIST_CM.min} to ${WAIST_CM.max}.`;
  }

  return null;
}

/** Are these two figures a person a BMI can honestly be computed from? */
export function bmiInputsPlausible(weightKg: number, heightCm: number): boolean {
  return within(weightKg, WEIGHT_KG) && within(heightCm, HEIGHT_CM);
}

/**
 * Were the measurements this request was judged on actually usable?
 *
 * The signal is a BMI that could not be computed even though both figures were
 * given. `calculateBmi` returns null for anything that could not have come off
 * a person, so a null BMI beside a present height and weight means the numbers
 * were refused rather than missing.
 *
 * The distinction matters: a repeat form that never asked for a height has no
 * BMI and that is perfectly fine. One that asked, got an answer, and still
 * could not produce a BMI has been given something nobody could weigh.
 */
export function measurementsUsable(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined,
  bmi: number | null | undefined,
): boolean {
  const bothGiven = heightCm !== null && heightCm !== undefined
    && weightKg !== null && weightKg !== undefined;

  if (!bothGiven) return true;

  return bmi !== null && bmi !== undefined;
}
