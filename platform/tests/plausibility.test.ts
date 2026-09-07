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
  bmiInputsPlausible, judgedOnUsableFigures, measurementProblem, measurementsUsable,
  weightChangePlausible, within,
} from '../src/lib/clinical/plausibility';
import { calculateBmi, percentageWeightLoss } from '../src/lib/units';

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

describe('weight change that nobody could have done', () => {
  it('accepts a real month of progress', () => {
    expect(percentageWeightLoss(88, 84)).toBe(4.55);
  });

  it('accepts no change at all', () => {
    expect(percentageWeightLoss(84, 84)).toBe(0);
  });

  it('accepts a gain, because gains are real and want looking at', () => {
    // Somebody who stopped for three months genuinely puts it back on. That
    // belongs in front of a pharmacist, not suppressed as implausible.
    expect(percentageWeightLoss(60, 84)).toBe(-40);
    expect(percentageWeightLoss(50, 95)).toBe(-90);
  });

  it('refuses a previous weight with an extra zero', () => {
    /*
     * The failure. 880 rather than 88 gives a 90.45% loss, and 90.45 does not
     * fail "at least 2% lost" on the rule authorising a routine repeat — it
     * clears it. The request came back GREEN.
     */
    expect(percentageWeightLoss(880, 84)).toBeNull();
  });

  it('refuses a previous weight given in stones', () => {
    expect(percentageWeightLoss(13, 84)).toBeNull();
  });

  it('refuses a loss that is individually plausible and jointly absurd', () => {
    // 500kg and 84kg are each inside the human range; 83% is not a month.
    expect(percentageWeightLoss(500, 84)).toBeNull();
  });

  it('still refuses what it always refused', () => {
    expect(percentageWeightLoss(0, 84)).toBeNull();
    expect(percentageWeightLoss(-88, 84)).toBeNull();
    expect(percentageWeightLoss(Number.NaN, 84)).toBeNull();
  });

  it('no longer produces a number that satisfies "at least 2% lost"', () => {
    const loss = percentageWeightLoss(880, 84);

    expect(loss).toBeNull();
    expect(loss !== null && loss >= 2).toBe(false);
  });

  it('leaves the boundary of a hard but real month alone', () => {
    // 40% is the edge; a genuine 10% month is nowhere near it.
    expect(percentageWeightLoss(100, 90)).toBe(10);
    expect(weightChangePlausible(100, 60, 40)).toBe(true);
    expect(weightChangePlausible(100, 59, 41)).toBe(false);
  });
});

describe('one question for the gate', () => {
  const good = {
    heightCm: 170, weightKg: 84, previousWeightKg: 88,
    bmi: 29.1, weightLossPercent: 4.55,
  };

  it('passes a request judged on real figures', () => {
    expect(judgedOnUsableFigures(good)).toBe(true);
  });

  it('fails one whose BMI was refused', () => {
    expect(judgedOnUsableFigures({ ...good, heightCm: 1.7, bmi: null })).toBe(false);
  });

  it('fails one whose weight change was refused', () => {
    expect(judgedOnUsableFigures({
      ...good, previousWeightKg: 880, weightLossPercent: null,
    })).toBe(false);
  });

  it('passes when a figure was never asked for', () => {
    // A repeat form with no previous weight has no percentage, and that is
    // correct rather than suspicious.
    expect(judgedOnUsableFigures({ heightCm: 170, weightKg: 84, bmi: 29.1 })).toBe(true);
    expect(judgedOnUsableFigures({})).toBe(true);
  });

  it('fails if either half fails', () => {
    expect(judgedOnUsableFigures({
      heightCm: 1.7, weightKg: 84, previousWeightKg: 880,
      bmi: null, weightLossPercent: null,
    })).toBe(false);
  });
});
