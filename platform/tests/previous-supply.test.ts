/**
 * The previous supply, and the four rules that depended on it.
 *
 * These rules existed, were correct, and had never once fired in production:
 * the values they read were computed from a previous weight and a previous
 * strength that submission never supplied. A rule on a missing field is
 * skipped — correctly — so nothing failed, nothing logged, and both routes to
 * GREEN were simply dead. Every repeat request fell through to AMBER.
 *
 * The engine tests already prove the rules. These prove the wiring that feeds
 * them, which is the half that was broken.
 */

import { describe, it, expect } from 'vitest';
import { medicineValue } from '../src/lib/clinical/previous-supply';
import { deriveValues } from '../src/lib/clinical/derived';
import { evaluateRuleset } from '../src/lib/rules/engine';
import { GLP1_REPEAT_RULESET } from '../src/lib/rules/glp1-ruleset';

describe('medicineValue', () => {
  it('rebuilds the option value from the two stored columns', () => {
    expect(medicineValue('Mounjaro', '7.5mg')).toBe('mounjaro_7.5mg');
    expect(medicineValue('Wegovy', '1mg')).toBe('wegovy_1mg');
  });

  it('accepts whatever casing the record happens to hold', () => {
    expect(medicineValue('mounjaro', '5mg')).toBe('mounjaro_5mg');
    expect(medicineValue('MOUNJARO', '5mg')).toBe('mounjaro_5mg');
  });

  it('refuses a strength that is not on the ladder', () => {
    // A drifted or mistyped strength must produce no step change rather than a
    // wrong one — the step change gates a RED.
    expect(medicineValue('Mounjaro', '3mg')).toBeNull();
    expect(medicineValue('Ozempic', '1mg')).toBeNull();
  });

  it('returns null when either column is empty', () => {
    expect(medicineValue(null, '5mg')).toBeNull();
    expect(medicineValue('Mounjaro', null)).toBeNull();
  });
});

/** A patient who is stable, on target, and should be waved through. */
const STABLE = {
  doseRequest: 'same',
  adverseEffects: 'none',
  missedDoses: '0',
  weeksOnDose: '6',
  appetiteSuppression: 'full',
  snacking: 'controlled',
  historyChanged: 'no',
  hydration: '2plus',
  pregnancy: 'no',
  currentMedicine: 'mounjaro_7.5mg',
};

/** 92kg at 1.70m is BMI ~31.8; 88kg from 92kg is 4.3% lost. */
const HEIGHT_CM = 170;

function evaluate(answers: Record<string, unknown>, opts: {
  weightKg: number;
  previousWeightKg?: number | null;
  previousMedicineValue?: string | null;
}) {
  const derived = deriveValues({
    answers,
    heightCm: HEIGHT_CM,
    weightKg: opts.weightKg,
    dateOfBirth: '1980-01-01',
    previousWeightKg: opts.previousWeightKg ?? null,
    previousMedicineValue: opts.previousMedicineValue ?? null,
  });
  return {
    derived,
    result: evaluateRuleset(GLP1_REPEAT_RULESET, {
      answers,
      derived: derived as unknown as Record<string, unknown>,
    }),
  };
}

describe('the rules that could not fire', () => {
  it('leaves both values null when no previous supply is known', () => {
    // This is what production did on every single submission.
    const { derived } = evaluate(STABLE, { weightKg: 88 });
    expect(derived.weightLossPercent).toBeNull();
    expect(derived.doseStepChange).toBeNull();
  });

  it('cannot reach GREEN without a previous weight', () => {
    const { result } = evaluate(STABLE, { weightKg: 88 });
    const stable = result.trace.find((t) => t.ruleId === 'stable-continue');
    expect(stable?.matched).toBe(false);
    expect(result.outcome).not.toBe('GREEN');
  });

  it('reaches GREEN once the previous weight is supplied', () => {
    const { derived, result } = evaluate(STABLE, {
      weightKg: 88,
      previousWeightKg: 92,
      previousMedicineValue: 'mounjaro_7.5mg',
    });

    expect(derived.weightLossPercent).toBeGreaterThanOrEqual(2);
    expect(result.trace.find((t) => t.ruleId === 'stable-continue')?.matched).toBe(true);
    expect(result.outcome).toBe('GREEN');
  });

  it('blocks a jump of more than one strength step', () => {
    // 2.5mg to 10mg is three rungs. His matrix marks this BLOCK; it had never
    // run, because doseStepChange was always null.
    const { derived, result } = evaluate(
      { ...STABLE, doseRequest: 'increase', requestedMedicine: 'mounjaro_10mg' },
      { weightKg: 88, previousWeightKg: 92, previousMedicineValue: 'mounjaro_2.5mg' },
    );

    expect(derived.doseStepChange).toBeGreaterThan(1);
    expect(result.trace.find((t) => t.ruleId === 'dose-skip')?.matched).toBe(true);
    expect(result.outcome).toBe('RED');
  });

  it('permits a single step up', () => {
    const { derived, result } = evaluate(
      { ...STABLE, doseRequest: 'increase', requestedMedicine: 'mounjaro_10mg' },
      { weightKg: 88, previousWeightKg: 92, previousMedicineValue: 'mounjaro_7.5mg' },
    );

    expect(derived.doseStepChange).toBe(1);
    expect(result.trace.find((t) => t.ruleId === 'dose-skip')?.matched).toBe(false);
    expect(result.outcome).not.toBe('RED');
  });

  it('flags weight loss below target once it can be measured', () => {
    // 91kg from 92kg is ~1.1% — under the 2% target, so AMBER rather than GREEN.
    const { result } = evaluate(STABLE, {
      weightKg: 91,
      previousWeightKg: 92,
      previousMedicineValue: 'mounjaro_7.5mg',
    });

    expect(result.trace.find((t) => t.ruleId === 'weight-loss-below-target')?.matched).toBe(true);
    expect(result.outcome).toBe('AMBER');
  });
});
