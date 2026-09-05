/**
 * Measurements that could not have come from a person.
 *
 * The test that matters is the last one. A height typed in metres produced a
 * BMI of 290,000, and that did not fail the clinical rules — it satisfied
 * them, because the rule authorising a routine repeat wants `bmi >= 25`. The
 * worst typo available on the form came back GREEN.
 */

import { describe, it, expect } from 'vitest';
import {
  BMI, HEIGHT_CM, WAIST_CM, WEIGHT_KG,
  bmiInputsPlausible, measurementProblem, measurementsUsable, within,
} from '../src/lib/clinical/plausibility';
import { calculateBmi } from '../src/lib/units';

describe('range checking', () => {
  it('accepts what is inside, including the edges', () => {
    expect(within(50, HEIGHT_CM)).toBe(true);
    expect(within(250, HEIGHT_CM)).toBe(true);
    expect(within(170, HEIGHT_CM)).toBe(true);
  });

  it('rejects what is outside', () => {
    expect(within(49.9, HEIGHT_CM)).toBe(false);
    expect(within(250.1, HEIGHT_CM)).toBe(false);
  });

  it('rejects nothing at all rather than treating it as zero', () => {
    expect(within(null, HEIGHT_CM)).toBe(false);
    expect(within(undefined, HEIGHT_CM)).toBe(false);
    expect(within(Number.NaN, HEIGHT_CM)).toBe(false);
    expect(within(Number.POSITIVE_INFINITY, HEIGHT_CM)).toBe(false);
  });
});

describe('what the patient is told', () => {
  it('says nothing about measurements that are fine', () => {
    expect(measurementProblem({ heightCm: 170, weightKg: 84, waistCm: 95 })).toBeNull();
  });

  it('names the height, not "your measurements"', () => {
    const problem = measurementProblem({ heightCm: 1.7, weightKg: 84 });
    expect(problem).toContain('height');
    expect(problem).toContain('centimetres');
  });

  it('names the weight', () => {
    expect(measurementProblem({ heightCm: 170, weightKg: 13 })).toContain('weight');
  });

  it('names the waist', () => {
    // The carried debt this closes: waist had no plausible range at all.
    // 37 is a waist in inches typed into a centimetres box.
    expect(measurementProblem({ waistCm: 37 })).toContain('waist');
    expect(measurementProblem({ waistCm: 95 })).toBeNull();
  });

  it('cannot catch every inches-for-centimetres slip, and does not pretend to', () => {
    // 55cm is a possible if very small adult, so 55 inches typed as 55 is
    // indistinguishable from the number alone. The common case is caught; this
    // one is not, and claiming otherwise would be worse than saying so.
    expect(measurementProblem({ waistCm: 55 })).toBeNull();
  });

  it('ignores a measurement that was not given', () => {
    expect(measurementProblem({ heightCm: 170 })).toBeNull();
    expect(measurementProblem({})).toBeNull();
  });

  it('is generous, because it is catching decimal points not unusual patients', () => {
    expect(measurementProblem({ heightCm: 145, weightKg: 210, waistCm: 160 })).toBeNull();
  });
});

describe('computing a BMI', () => {
  it('computes one from a real person', () => {
    expect(calculateBmi(84, 170)).toBe(29.1);
  });

  it('refuses a height typed in metres', () => {
    expect(calculateBmi(84, 1.7)).toBeNull();
  });

  it('refuses a height missing a zero', () => {
    expect(calculateBmi(84, 17)).toBeNull();
  });

  it('refuses a weight missing a zero', () => {
    expect(calculateBmi(8.4, 170)).toBeNull();
  });

  it('refuses a weight given in stones', () => {
    expect(calculateBmi(13, 170)).toBeNull();
  });

  it('still refuses the impossible cases it always refused', () => {
    expect(calculateBmi(0, 170)).toBeNull();
    expect(calculateBmi(84, 0)).toBeNull();
    expect(calculateBmi(-84, 170)).toBeNull();
    expect(calculateBmi(Number.NaN, 170)).toBeNull();
  });

  it('refuses a pair that is individually plausible and jointly absurd', () => {
    // 50cm and 500kg are each inside their own range and compute to 2000.
    expect(bmiInputsPlausible(500, 50)).toBe(true);
    expect(calculateBmi(500, 50)).toBeNull();
  });

  it('accepts the extremes of a real human range', () => {
    expect(calculateBmi(45, 175)).not.toBeNull();   // BMI 14.7
    expect(calculateBmi(250, 175)).not.toBeNull();  // BMI 81.6
  });

  it('keeps a BMI a rule can read', () => {
    const bmi = calculateBmi(84, 170)!;
    expect(within(bmi, BMI)).toBe(true);
  });
});

describe('the failure this exists to prevent', () => {
  /*
   * Before this, `calculateBmi(84, 1.7)` returned 290657.4. The rule that
   * authorises a routine repeat without a pharmacist reads `bmi >= 25`, so the
   * nonsense value did not trip a safety rule — it cleared the eligibility
   * check and the request came back GREEN.
   *
   * Null makes every rule reading BMI skip instead, and a request where
   * nothing matched falls to the AMBER default: a pharmacist reads it.
   */
  it('no longer produces a number that satisfies "bmi is at least 25"', () => {
    const bmi = calculateBmi(84, 1.7);

    expect(bmi).toBeNull();
    expect(bmi !== null && bmi >= 25).toBe(false);
  });

  it('refuses every one of the four typos, in both directions', () => {
    // Two read high and would have passed an eligibility floor; two read low
    // and would have tripped a safety rule for the wrong reason.
    expect(calculateBmi(84, 1.7)).toBeNull();
    expect(calculateBmi(84, 17)).toBeNull();
    expect(calculateBmi(8.4, 170)).toBeNull();
    expect(calculateBmi(13, 170)).toBeNull();
  });

  it('leaves the correct reading untouched', () => {
    expect(calculateBmi(84, 170)).toBe(29.1);
    expect(within(WEIGHT_KG.min, WEIGHT_KG)).toBe(true);
    expect(within(WAIST_CM.max, WAIST_CM)).toBe(true);
  });
});

describe('deciding whether a request was judged on real figures', () => {
  it('is fine when a BMI was computed', () => {
    expect(measurementsUsable(170, 84, 29.1)).toBe(true);
  });

  it('is fine when the form never asked', () => {
    // A repeat form with no height question has no BMI, and that is correct.
    expect(measurementsUsable(null, null, null)).toBe(true);
    expect(measurementsUsable(undefined, undefined, undefined)).toBe(true);
  });

  it('is fine when only one figure was given', () => {
    expect(measurementsUsable(170, null, null)).toBe(true);
    expect(measurementsUsable(null, 84, null)).toBe(true);
  });

  it('is NOT fine when both were given and no BMI came out', () => {
    // Asked, answered, and still refused — the numbers were unusable.
    expect(measurementsUsable(1.7, 84, null)).toBe(false);
    expect(measurementsUsable(17, 84, null)).toBe(false);
    expect(measurementsUsable(170, 8.4, null)).toBe(false);
  });
});
