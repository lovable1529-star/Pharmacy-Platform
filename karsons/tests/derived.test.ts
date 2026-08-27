import { describe, expect, it } from 'vitest';
import {
  deriveValues,
  derivationWarnings,
  doseDirection,
  doseStepChange,
  ladderPosition,
  requiresManualReview,
  weeksOnCurrentDose,
} from '@/lib/clinical/derived';
import { evaluateRuleset } from '@/lib/rules/engine';
import { GLP1_REPEAT_RULESET } from '@/lib/rules/glp1-ruleset';

const NOW = new Date('2026-08-27T10:00:00Z');

describe('dose ladders', () => {
  it('finds a position on the Mounjaro ladder', () => {
    expect(ladderPosition('Mounjaro', '5mg')).toBe(1);
    expect(ladderPosition('Mounjaro (tirzepatide)', '15mg')).toBe(5);
  });

  it('tolerates spacing and case', () => {
    expect(ladderPosition('Mounjaro', '7.5 MG')).toBe(2);
  });

  it('returns null for an unrecognised strength', () => {
    expect(ladderPosition('Mounjaro', '4mg')).toBeNull();
  });

  it('returns null for an unrecognised medicine', () => {
    expect(ladderPosition('Something Else', '5mg')).toBeNull();
  });
});

describe('doseStepChange', () => {
  it('counts a single step', () => {
    expect(doseStepChange('Mounjaro', '5mg', '7.5mg')).toBe(1);
  });

  it('counts a skipped step — this is what the RED rule needs', () => {
    expect(doseStepChange('Mounjaro', '2.5mg', '10mg')).toBe(3);
  });

  it('counts zero for no change', () => {
    expect(doseStepChange('Mounjaro', '5mg', '5mg')).toBe(0);
  });

  it('is direction-agnostic — a two-step drop is still two steps', () => {
    expect(doseStepChange('Mounjaro', '10mg', '5mg')).toBe(2);
  });

  it('handles the uneven Wegovy ladder', () => {
    // 1mg → 1.7mg is one step despite the odd numeric gap.
    expect(doseStepChange('Wegovy', '1mg', '1.7mg')).toBe(1);
    expect(doseStepChange('Wegovy', '0.25mg', '2.4mg')).toBe(4);
  });

  it('returns null rather than zero when it cannot verify', () => {
    // Zero would mean "no change" — the wrong assumption on unknown data.
    expect(doseStepChange('Mounjaro', '5mg', '6mg')).toBeNull();
  });
});

describe('doseDirection', () => {
  it('detects an increase, decrease and no change', () => {
    expect(doseDirection('Mounjaro', '5mg', '7.5mg')).toBe('Increase');
    expect(doseDirection('Mounjaro', '7.5mg', '5mg')).toBe('Decrease');
    expect(doseDirection('Mounjaro', '5mg', '5mg')).toBe('Same');
  });
});

describe('weeksOnCurrentDose', () => {
  it('counts back through consecutive supplies at the same strength', () => {
    // Three monthly supplies at 5mg — stable for ~12 weeks, not 4.
    const weeks = weeksOnCurrentDose('5mg', [
      { suppliedAt: new Date('2026-08-01'), strength: '5mg' },
      { suppliedAt: new Date('2026-07-01'), strength: '5mg' },
      { suppliedAt: new Date('2026-06-01'), strength: '5mg' },
    ], NOW);
    expect(weeks).toBe(12);
  });

  it('stops counting at a strength change', () => {
    const weeks = weeksOnCurrentDose('5mg', [
      { suppliedAt: new Date('2026-08-01'), strength: '5mg' },
      { suppliedAt: new Date('2026-07-01'), strength: '2.5mg' },
    ], NOW);
    expect(weeks).toBe(3);
  });

  it('returns null with no supply history', () => {
    expect(weeksOnCurrentDose('5mg', [], NOW)).toBeNull();
  });

  it('returns null when the last supply was a different strength', () => {
    expect(weeksOnCurrentDose('10mg', [
      { suppliedAt: new Date('2026-08-01'), strength: '5mg' },
    ], NOW)).toBeNull();
  });
});

describe('deriveValues', () => {
  const base = {
    medicine: 'Mounjaro',
    currentStrength: '5mg',
    requestedStrength: '5mg',
    weightKg: 92,
    heightCm: 172,
    dateOfBirth: new Date('1980-05-10'),
    previousSupplies: [
      { suppliedAt: new Date('2026-08-01'), strength: '5mg', weightKg: 95 },
      { suppliedAt: new Date('2026-07-01'), strength: '5mg', weightKg: 98 },
    ],
    now: NOW,
  };

  it('computes age and BMI', () => {
    const derived = deriveValues(base);
    expect(derived.age).toBe(46);
    expect(derived.bmi).toBeCloseTo(31.1, 1);
  });

  it('computes weight loss since the last supply as a positive number', () => {
    expect(deriveValues(base).weightLossPercent).toBeCloseTo(3.16, 1);
  });

  it('computes total weight loss from the earliest recorded weight', () => {
    expect(deriveValues(base).totalWeightLossPercent).toBeCloseTo(6.12, 1);
  });

  it('counts supplies to date', () => {
    expect(deriveValues(base).suppliesToDate).toBe(2);
  });

  it('reports a null BMI rather than a wrong one when height is missing', () => {
    expect(deriveValues({ ...base, heightCm: null }).bmi).toBeNull();
  });
});

describe('derivation warnings', () => {
  it('warns when a dose change cannot be verified', () => {
    const derived = deriveValues({
      medicine: 'Mounjaro', currentStrength: '5mg', requestedStrength: '6mg',
      weightKg: 92, heightCm: 172, dateOfBirth: new Date('1980-05-10'),
      previousSupplies: [], now: NOW,
    });
    expect(derivationWarnings(derived).join(' ')).toMatch(/not on a recognised ladder/i);
    expect(requiresManualReview(derived)).toBe(true);
  });

  it('does not require review when everything computed cleanly', () => {
    const derived = deriveValues({
      medicine: 'Mounjaro', currentStrength: '5mg', requestedStrength: '7.5mg',
      weightKg: 92, heightCm: 172, dateOfBirth: new Date('1980-05-10'),
      previousSupplies: [{ suppliedAt: new Date('2026-07-01'), strength: '5mg' }],
      now: NOW,
    });
    expect(requiresManualReview(derived)).toBe(false);
  });
});

describe('end to end: derived values feed the safety rules', () => {
  const answers = {
    medicine: 'Mounjaro', doseRequest: 'Increase', supplyMonths: 1,
    pregnant: 'No', breastfeeding: 'No', adverseEffects: 'None',
    redFlagSymptoms: 'No', missedDoses: 0, healthChanges: 'No',
    appetiteSuppression: 'Full suppression all week',
    snacking: 'Less than 3 regular meals, no snacks', hydration: '≥ 2.0 L/day',
  };

  it('BLOCKS a request that skips a strength', () => {
    // This is the regression that matters. Without doseStepChange this
    // returned GREEN and a patient could jump 2.5mg to 10mg.
    const derived = deriveValues({
      medicine: 'Mounjaro', currentStrength: '2.5mg', requestedStrength: '10mg',
      weightKg: 92, heightCm: 172, dateOfBirth: new Date('1980-05-10'),
      previousSupplies: [{ suppliedAt: new Date('2026-06-01'), strength: '2.5mg' }],
      now: NOW,
    });

    const result = evaluateRuleset(GLP1_REPEAT_RULESET, { answers, derived: { ...derived } });

    expect(derived.doseStepChange).toBe(3);
    expect(result.outcome).toBe('RED');
    expect(result.decidingRuleId).toBe('dose-step-skip');
  });

  it('allows a single-step increase after enough time on the current dose', () => {
    const derived = deriveValues({
      medicine: 'Mounjaro', currentStrength: '5mg', requestedStrength: '7.5mg',
      weightKg: 92, heightCm: 172, dateOfBirth: new Date('1980-05-10'),
      previousSupplies: [
        { suppliedAt: new Date('2026-07-01'), strength: '5mg', weightKg: 95 },
        { suppliedAt: new Date('2026-06-01'), strength: '5mg', weightKg: 98 },
      ],
      now: NOW,
    });

    const result = evaluateRuleset(GLP1_REPEAT_RULESET, { answers, derived: { ...derived } });
    expect(derived.weeksOnCurrentDose).toBeGreaterThanOrEqual(3);
    expect(result.outcome).not.toBe('RED');
  });

  it('flags AMBER when a change is requested too soon after the last one', () => {
    const derived = deriveValues({
      medicine: 'Mounjaro', currentStrength: '5mg', requestedStrength: '7.5mg',
      weightKg: 92, heightCm: 172, dateOfBirth: new Date('1980-05-10'),
      previousSupplies: [{ suppliedAt: new Date('2026-08-20'), strength: '5mg', weightKg: 95 }],
      now: NOW,
    });

    const result = evaluateRuleset(GLP1_REPEAT_RULESET, { answers, derived: { ...derived } });
    expect(derived.weeksOnCurrentDose).toBeLessThan(3);
    expect(result.outcome).toBe('AMBER');
  });
});
