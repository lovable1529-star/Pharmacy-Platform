/**
 * Repeat request logic, tested against the specification's own tables.
 */

import { describe, it, expect } from 'vitest';
import {
  allowedDoseOptions, systemRecommendation, assessHolidaySupply,
} from '../src/lib/clinical/repeat-request';

describe('allowed dose options — §4.3', () => {
  it('offers same and one step either way', () => {
    const options = allowedDoseOptions('mounjaro_7.5mg');
    expect(options.map((o) => o.value)).toEqual([
      'mounjaro_5mg', 'mounjaro_7.5mg', 'mounjaro_10mg',
    ]);
  });

  it('has no step down from the bottom rung', () => {
    const options = allowedDoseOptions('mounjaro_2.5mg');
    expect(options.map((o) => o.direction)).toEqual(['same', 'increase']);
  });

  it('has no step up from the top rung', () => {
    const options = allowedDoseOptions('mounjaro_15mg');
    expect(options.map((o) => o.direction)).toEqual(['decrease', 'same']);
  });

  it('never offers a two-step jump', () => {
    // The thing the dose-skip RED exists to catch must not be offerable.
    const options = allowedDoseOptions('mounjaro_2.5mg');
    expect(options.map((o) => o.value)).not.toContain('mounjaro_7.5mg');
  });

  it('stays on the same medicine', () => {
    const options = allowedDoseOptions('wegovy_1mg');
    expect(options.every((o) => o.value.startsWith('wegovy_'))).toBe(true);
  });

  it('offers nothing when the strength is unknown', () => {
    expect(allowedDoseOptions('mounjaro_3mg')).toEqual([]);
    expect(allowedDoseOptions(null)).toEqual([]);
  });
});

describe('system recommendation — §4.3', () => {
  const WELL = {
    appetiteSuppression: 'full', snacking: 'controlled',
    adverseEffects: 'none', weightLossPercent: 3.2,
    bmi: 30, missedDoses: 0, pregnancy: 'no', weeksOnDose: 6,
  };

  it('encourages the same dose when things are going well', () => {
    expect(systemRecommendation(WELL).recommendation).toBe('same');
  });

  it('suggests an increase when suppression is wearing off', () => {
    expect(systemRecommendation({
      ...WELL, appetiteSuppression: 'wearing_off', weightLossPercent: 0.5,
    }).recommendation).toBe('increase');
  });

  it('suggests an increase when snacking has crept back', () => {
    expect(systemRecommendation({ ...WELL, snacking: 'frequent' }).recommendation).toBe('increase');
  });

  it('will not suggest an increase before three weeks on the dose', () => {
    // §5.3 — the step-up eligibility rule applies to the advice too, or the
    // patient is encouraged to ask for something that will be refused.
    expect(systemRecommendation({
      ...WELL, appetiteSuppression: 'poor', weeksOnDose: 1,
    }).recommendation).toBe('same');
  });

  it('suggests a decrease at a healthy BMI', () => {
    expect(systemRecommendation({ ...WELL, bmi: 22 }).recommendation).toBe('decrease');
  });

  it('suggests a decrease for moderate side effects', () => {
    expect(systemRecommendation({ ...WELL, adverseEffects: 'moderate' }).recommendation).toBe('decrease');
  });

  it('sends them to a pharmacist for severe side effects', () => {
    expect(systemRecommendation({ ...WELL, adverseEffects: 'severe' }).recommendation).toBe('book');
  });

  it('sends them to a pharmacist after two missed doses', () => {
    expect(systemRecommendation({ ...WELL, missedDoses: 2 }).recommendation).toBe('book');
  });

  it('sends them to a pharmacist in pregnancy, whatever else is true', () => {
    // The absolute must outrank a good picture everywhere else.
    expect(systemRecommendation({ ...WELL, pregnancy: 'yes' }).recommendation).toBe('book');
  });

  it('never phrases advice as a dose instruction', () => {
    for (const input of [WELL, { ...WELL, bmi: 22 }, { ...WELL, adverseEffects: 'severe' }]) {
      const { reason } = systemRecommendation(input);
      expect(reason).not.toMatch(/\d+\s*mg/i);
    }
  });
});

describe('holiday supply — §5.5', () => {
  const BASE = {
    isHoliday: true, months: 1, changingStrength: false,
    twoStrengths: false, weeksOnCurrentStrength: 8,
  };

  it('does not apply when it is not a holiday request', () => {
    expect(assessHolidaySupply({ ...BASE, isHoliday: false }).outcome).toBeNull();
  });

  it('allows extra supply of the same strength on a stable dose', () => {
    expect(assessHolidaySupply(BASE).outcome).toBe('GREEN');
  });

  it('reviews an increase combined with two months', () => {
    expect(assessHolidaySupply({
      ...BASE, months: 2, changingStrength: true,
    }).outcome).toBe('AMBER');
  });

  it('blocks two months across two different strengths', () => {
    expect(assessHolidaySupply({
      ...BASE, months: 2, twoStrengths: true,
    }).outcome).toBe('RED');
  });

  it('puts the block ahead of the review when both apply', () => {
    // Two strengths across a long supply is a stockpile whatever else is true.
    expect(assessHolidaySupply({
      ...BASE, months: 2, changingStrength: true, twoStrengths: true,
    }).outcome).toBe('RED');
  });

  it('reviews anything short of a month on the current strength', () => {
    expect(assessHolidaySupply({ ...BASE, weeksOnCurrentStrength: 2 }).outcome).toBe('AMBER');
  });
});

describe('holiday rules inside the engine', () => {
  it('are evaluated as part of triage, not beside it', async () => {
    const { GLP1_REPEAT_RULESET } = await import('../src/lib/rules/glp1-ruleset');
    const { evaluateRuleset } = await import('../src/lib/rules/engine');

    const answers = {
      holidaySupply: 'yes',
      holidayTwoStrengths: 'yes',
      supplyQuantity: '2',
      doseRequest: 'same',
      adverseEffects: 'none',
      pregnancy: 'no',
      historyChanged: 'no',
    };

    const result = evaluateRuleset(GLP1_REPEAT_RULESET, {
      answers,
      derived: { weeksOnDose: 8, missedDoses: 0, bmi: 30 },
    });

    // It must show in the trace — the Why? screen is where a pharmacist finds
    // out that a holiday rule is what stopped this.
    const fired = result.trace.find((t) => t.ruleId === 'holiday-two-strengths');
    expect(fired?.matched).toBe(true);
    expect(result.outcome).toBe('RED');
  });

  it('waves through extra supply of the same strength on a stable dose', async () => {
    const { GLP1_REPEAT_RULESET } = await import('../src/lib/rules/glp1-ruleset');
    const { evaluateRuleset } = await import('../src/lib/rules/engine');

    const result = evaluateRuleset(GLP1_REPEAT_RULESET, {
      answers: {
        holidaySupply: 'yes', holidayTwoStrengths: 'no', supplyQuantity: '1',
        doseRequest: 'same', adverseEffects: 'none', pregnancy: 'no',
        historyChanged: 'no', appetiteSuppression: 'full', snacking: 'controlled',
      },
      derived: { weeksOnDose: 8, missedDoses: 0, bmi: 30, weightLossPercent: 3 },
    });

    expect(result.trace.find((t) => t.ruleId === 'holiday-same-strength-stable')?.matched).toBe(true);
    expect(result.outcome).not.toBe('RED');
  });
});
