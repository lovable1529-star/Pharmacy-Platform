/**
 * Reading a repeat care baseline out of a consultation.
 *
 * The baseline is what every relative rule is measured against, so a value read
 * wrongly here is not a display bug — it changes whether a patient is approved
 * for their next supply.
 */

import { describe, expect, it } from 'vitest';
import { enrolmentBaseline, baselineGaps } from '@/lib/clinical/enrolment-baseline';
import type { Answers } from '@/types/form-schema';

/** How the measurement control actually stores an answer. */
const measure = (si: number, unit: string, raw: Record<string, number | ''>) =>
  ({ si, unit, raw });

const CONSULTATION: Answers = {
  height: measure(170, 'ftin', { ft: 5, in: 7 }),
  weight: measure(96.2, 'stlb', { st: 15, lb: 2 }),
  waist: measure(104, 'cm', { cm: 104 }),
  requestedMedicine: 'mounjaro_5mg',
} as unknown as Answers;

describe('reading the baseline', () => {
  it('takes the SI value, not the units the patient typed', () => {
    const b = enrolmentBaseline(CONSULTATION);
    expect(b.startingWeightKg).toBe('96.2');
    expect(b.heightCm).toBe('170');
    expect(b.startingWaistCm).toBe('104');
  });

  it('splits the medicine value into medicine and strength', () => {
    const b = enrolmentBaseline(CONSULTATION);
    expect(b.medicine).toBe('Mounjaro');
    expect(b.strength).toBe('5mg');
  });

  /*
   * A repeat questionnaire records what they are ON; a first consultation
   * records what they are being STARTED on. The derivation prefers the former,
   * and the baseline has to agree with it or the two disagree about the same
   * patient.
   */
  it('prefers currentMedicine over requestedMedicine', () => {
    const b = enrolmentBaseline({
      ...CONSULTATION,
      currentMedicine: 'mounjaro_7.5mg',
    } as unknown as Answers);
    expect(b.strength).toBe('7.5mg');
  });

  it('dates the strength from the consultation, not from today', () => {
    const b = enrolmentBaseline(CONSULTATION, {
      startedOn: new Date(Date.UTC(2026, 6, 12)),
    });
    expect(b.strengthSince).toBe('2026-07-12');
  });

  it('rounds to one decimal rather than inventing precision', () => {
    const b = enrolmentBaseline({
      weight: measure(78.400000001, 'kg', { kg: 78.4 }),
    } as unknown as Answers);
    expect(b.startingWeightKg).toBe('78.4');
  });
});

describe('values that are not there', () => {
  /*
   * The distinction that matters: a blank box means "not recorded". A zero
   * would be read by the rules engine as a real measurement of zero.
   */
  it('gives an empty string, never a zero', () => {
    const b = enrolmentBaseline({ weight: measure(0, 'kg', { kg: 0 }) } as unknown as Answers);
    expect(b.startingWeightKg).toBe('');
  });

  it('survives a form that asked none of it', () => {
    const b = enrolmentBaseline({} as Answers);
    expect(b).toEqual({
      heightCm: '', startingWeightKg: '', startingWaistCm: '',
      medicine: '', strength: '', strengthSince: '',
    });
  });

  it('ignores a medicine that is not on any ladder', () => {
    const b = enrolmentBaseline({ requestedMedicine: 'notreal_5mg' } as unknown as Answers);
    expect(b.medicine).toBe('');
    expect(b.strength).toBe('');
  });

  it('reads a plain number as well as a measurement object', () => {
    const b = enrolmentBaseline({ weight: 88 } as unknown as Answers);
    expect(b.startingWeightKg).toBe('88');
  });
});

describe('warning about the gaps', () => {
  it('says nothing when the baseline is complete', () => {
    expect(baselineGaps(enrolmentBaseline(CONSULTATION))).toEqual([]);
  });

  /*
   * Each gap names the rules it disables. "Weight is missing" is a shrug;
   * "weight loss cannot be measured at the next request" is a decision.
   */
  it('names what each missing value costs', () => {
    const gaps = baselineGaps(enrolmentBaseline({} as Answers));
    expect(gaps).toHaveLength(3);
    expect(gaps.join(' ')).toMatch(/weight loss cannot be measured/);
    expect(gaps.join(' ')).toMatch(/BMI is not calculated/);
    expect(gaps.join(' ')).toMatch(/dose-step rules are skipped/);
  });

  it('does not warn about the waist, which is optional', () => {
    const gaps = baselineGaps(enrolmentBaseline({ ...CONSULTATION, waist: undefined } as Answers));
    expect(gaps).toEqual([]);
  });
});
