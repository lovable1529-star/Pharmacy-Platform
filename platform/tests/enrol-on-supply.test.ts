/**
 * Enrolling a remote new patient once their first supply has actually gone out.
 *
 * This closes a dead end: repeat access needs an enrolment, the only thing
 * that created one was a button on a consultation record, and a remote new
 * patient never has a consultation. Without this they could complete the whole
 * new-patient journey and never be able to request a repeat.
 */

import { describe, expect, it } from 'vitest';
import {
  enrolmentSeedFromSupply, seedGaps, seedMedicineValue,
} from '@/lib/clinical/enrol-on-supply';
import type { Answers } from '@/types/form-schema';

const m = (si: number) => ({ si, unit: 'kg', raw: { value: si } });
const SUPPLIED_AT = new Date('2026-08-31T14:00:00Z');

const NEW_PATIENT = {
  medicineName: 'Mounjaro',
  strength: '2.5mg',
  suppliedAt: SUPPLIED_AT,
  answers: {
    height: m(170),
    weight: m(96),
    waist: m(104),
    requestedMedicine: 'mounjaro_5mg',
  } as unknown as Answers,
};

describe('a new patient starting treatment', () => {
  it('takes the baseline from their measurements', () => {
    const seed = enrolmentSeedFromSupply(NEW_PATIENT);
    expect(seed.heightCm).toBe('170');
    expect(seed.startingWeightKg).toBe('96');
    expect(seed.startingWaistCm).toBe('104');
  });

  /*
   * The one that matters most. A pharmacist who reduced the dose during the
   * verification call must not have the patient's original REQUEST recorded as
   * their starting strength — the dose-step rules would then read a change
   * that never happened.
   */
  it('records what was supplied, not what was requested', () => {
    const seed = enrolmentSeedFromSupply(NEW_PATIENT);
    expect(seed.strength).toBe('2.5mg');
    expect(seed.medicine).toBe('Mounjaro');
  });

  it('dates the strength from the supply', () => {
    expect(enrolmentSeedFromSupply(NEW_PATIENT).strengthSince).toBe('2026-08-31');
  });

  it('sets the last weight, which the next request measures loss against', () => {
    expect(enrolmentSeedFromSupply(NEW_PATIENT).lastWeightKg).toBe('96');
  });

  it('rebuilds the value the rules engine compares strengths with', () => {
    expect(seedMedicineValue(enrolmentSeedFromSupply(NEW_PATIENT))).toBe('mounjaro_2.5mg');
  });
});

describe('a patient transferring from another clinic', () => {
  const TRANSFER = {
    ...NEW_PATIENT,
    answers: {
      ...NEW_PATIENT.answers,
      otherClinic: 'yes',
      priorStartingWeight: m(112),
      priorStartedOn: '2026-02-01',
    } as unknown as Answers,
  };

  /*
   * Their progress must not restart from zero the moment they move to us.
   * They started treatment at 112kg and are now 96 — that loss belongs to
   * them, and taking today's weight as the baseline would erase it.
   */
  it('measures from where their treatment started, not from today', () => {
    const seed = enrolmentSeedFromSupply(TRANSFER);
    expect(seed.startingWeightKg).toBe('112');
    expect(seed.lastWeightKg).toBe('96');
  });

  /*
   * But the STRENGTH clock starts with us. `priorStartedOn` describes a dose
   * another clinic gave them; the three-week and six-week stability rules
   * count from the strength this pharmacy supplied.
   */
  it('dates the strength from our supply, not their old clinic', () => {
    expect(enrolmentSeedFromSupply(TRANSFER).strengthSince).toBe('2026-08-31');
  });
});

describe('what is missing', () => {
  it('says nothing when the baseline is complete', () => {
    expect(seedGaps(enrolmentSeedFromSupply(NEW_PATIENT))).toEqual([]);
  });

  it('names each gap by the rules it disables', () => {
    const bare = enrolmentSeedFromSupply({
      medicineName: null, strength: null, suppliedAt: SUPPLIED_AT, answers: {} as Answers,
    });
    const gaps = seedGaps(bare).join(' ');
    expect(gaps).toMatch(/dose-step rules cannot run/);
    expect(gaps).toMatch(/weight loss cannot be measured/);
    expect(gaps).toMatch(/BMI will not be calculated/);
  });

  it('gives null rather than zero for an absent measurement', () => {
    const seed = enrolmentSeedFromSupply({
      ...NEW_PATIENT,
      answers: { weight: m(0) } as unknown as Answers,
    });
    expect(seed.startingWeightKg).toBeNull();
    expect(seed.heightCm).toBeNull();
  });

  it('refuses to build a medicine value from half a pair', () => {
    const seed = enrolmentSeedFromSupply({ ...NEW_PATIENT, strength: null });
    expect(seedMedicineValue(seed)).toBeNull();
  });

  /* A strength that has drifted off the ladder must produce no value at all,
   * rather than one the dose-step rules would read wrongly. */
  it('refuses a strength that is not on the ladder', () => {
    const seed = enrolmentSeedFromSupply({ ...NEW_PATIENT, strength: '99mg' });
    expect(seedMedicineValue(seed)).toBeNull();
  });
});
