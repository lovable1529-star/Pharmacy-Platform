/**
 * Routing a new Weight Management patient, and judging the client's criteria.
 *
 * The client gave two route rules and stopped. Everything here is about
 * honouring that boundary: report what is known, say plainly what is not, and
 * never let "we do not know" read as "this is fine".
 */

import { describe, expect, it } from 'vitest';
import {
  assessEligibility, readRoute, hasWeightRelatedCondition, choseFaceToFace,
} from '@/lib/clinical/wm-eligibility';

/** How the measurement control stores an answer. */
const m = (si: number) => ({ si, unit: 'cm', raw: { value: si } });

/** 1.70 m. Weight is then chosen to land BMI where each test needs it. */
const HEIGHT = m(170);
const at = (bmi: number) => m(Number((bmi * 1.7 * 1.7).toFixed(2)));

describe('which route they are on', () => {
  it('reads "no" as new to treatment', () => {
    expect(readRoute({ otherClinic: 'no' })).toBe('new-treatment');
  });

  it('reads "yes" as a transfer', () => {
    expect(readRoute({ otherClinic: 'yes' })).toBe('transfer');
  });

  it('accepts booleans, since a yesNo field may store either', () => {
    expect(readRoute({ otherClinic: true })).toBe('transfer');
    expect(readRoute({ otherClinic: false })).toBe('new-treatment');
  });

  it('is unknown when unanswered', () => {
    expect(readRoute({})).toBe('unknown');
    expect(readRoute({ otherClinic: '' })).toBe('unknown');
  });
});

describe('new to treatment', () => {
  const base = { otherClinic: 'no', height: HEIGHT };

  it('passes at BMI 31', () => {
    const a = assessEligibility({ ...base, weight: at(31) });
    expect(a.meetsRouteCriterion).toBe(true);
    expect(a.reasons.join(' ')).toMatch(/at or above 30/);
  });

  it('passes exactly at 30', () => {
    expect(assessEligibility({ ...base, weight: at(30) }).meetsRouteCriterion).toBe(true);
  });

  it('passes at BMI 28 with a weight-related condition', () => {
    const a = assessEligibility({
      ...base, weight: at(28), weightConditions: ['sleep_apnoea'],
    });
    expect(a.meetsRouteCriterion).toBe(true);
    expect(a.reasons.join(' ')).toMatch(/weight-related condition was reported/);
  });

  /*
   * The case the plan calls out by name: BMI 28 and nothing else. It must not
   * silently pass.
   */
  it('fails at BMI 28 with no condition', () => {
    const a = assessEligibility({ ...base, weight: at(28) });
    expect(a.meetsRouteCriterion).toBe(false);
    expect(a.reasons.join(' ')).toMatch(/no weight-related condition/);
  });

  /*
   * "None of the above" is a stated answer, not a blank. Treating it as one
   * would let the lower threshold through on a patient who told us there was
   * no comorbidity.
   */
  it('fails at BMI 28 when they ticked "none of the above"', () => {
    const a = assessEligibility({ ...base, weight: at(28), weightConditions: ['none'] });
    expect(a.meetsRouteCriterion).toBe(false);
  });

  it('fails below 27 regardless of conditions', () => {
    const a = assessEligibility({
      ...base, weight: at(24), weightConditions: ['asthma'],
    });
    expect(a.meetsRouteCriterion).toBe(false);
    expect(a.reasons.join(' ')).toMatch(/below 27/);
  });
});

describe('transfer or continuation', () => {
  const base = { otherClinic: 'yes', height: HEIGHT };

  /*
   * The client's words: "current BMI 20–<25 may proceed only as verified
   * continuation". That is a condition on HOW it proceeds, not a pass or a
   * fail, so the criterion stays unresolved and the flag is raised.
   */
  it('flags the 20–<25 band as needing verified continuation', () => {
    const a = assessEligibility({ ...base, weight: at(23) });
    expect(a.needsVerifiedContinuation).toBe(true);
    expect(a.meetsRouteCriterion).toBeNull();
    expect(a.reasons.join(' ')).toMatch(/verified continuation/);
  });

  it('includes the bottom of the band and excludes the top', () => {
    expect(assessEligibility({ ...base, weight: at(20) }).needsVerifiedContinuation).toBe(true);
    expect(assessEligibility({ ...base, weight: at(24.9) }).needsVerifiedContinuation).toBe(true);
    expect(assessEligibility({ ...base, weight: at(25) }).needsVerifiedContinuation).toBe(false);
  });

  it('passes at or above 25', () => {
    expect(assessEligibility({ ...base, weight: at(27) }).meetsRouteCriterion).toBe(true);
  });

  /*
   * Below 20 the client has given no rule at all. Refusing would be inventing
   * a restriction; passing would be inventing a permission. Neither.
   */
  it('refuses to judge below 20, and says so', () => {
    const a = assessEligibility({ ...base, weight: at(18) });
    expect(a.meetsRouteCriterion).toBeNull();
    expect(a.reasons.join(' ')).toMatch(/No rule has been supplied/);
  });
});

describe('what cannot be judged', () => {
  it('does not guess without a route', () => {
    const a = assessEligibility({ height: HEIGHT, weight: at(31) });
    expect(a.route).toBe('unknown');
    expect(a.meetsRouteCriterion).toBeNull();
  });

  it('does not guess without measurements', () => {
    const a = assessEligibility({ otherClinic: 'no' });
    expect(a.bmi).toBeNull();
    expect(a.meetsRouteCriterion).toBeNull();
    expect(a.reasons.join(' ')).toMatch(/BMI could not be calculated/);
  });

  /* Half a measurement is not a measurement. */
  it('does not guess from height alone', () => {
    const a = assessEligibility({ otherClinic: 'no', height: HEIGHT });
    expect(a.meetsRouteCriterion).toBeNull();
  });
});

describe('reading the conditions answer', () => {
  it('sees a real condition', () => {
    expect(hasWeightRelatedCondition({ weightConditions: ['pcos'] })).toBe(true);
  });

  it('does not count "none", an empty list, or a missing answer', () => {
    expect(hasWeightRelatedCondition({ weightConditions: ['none'] })).toBe(false);
    expect(hasWeightRelatedCondition({ weightConditions: [] })).toBe(false);
    expect(hasWeightRelatedCondition({})).toBe(false);
  });

  it('sees a real condition alongside "none"', () => {
    expect(hasWeightRelatedCondition({ weightConditions: ['none', 'asthma'] })).toBe(true);
  });
});

describe('choosing to be seen in person', () => {
  it('is recognised, so the online pathway can stop', () => {
    expect(choseFaceToFace({ pathwayChoice: 'in_person' })).toBe(true);
    expect(choseFaceToFace({ pathwayChoice: 'remote' })).toBe(false);
    expect(choseFaceToFace({})).toBe(false);
  });
});
