/**
 * Clinical tests for the GLP-1 repeat care ruleset.
 *
 * Written to be readable by a pharmacist, not just a developer. Each `describe`
 * maps to a table in the client's decision matrix, so the rules can be checked
 * line by line against his specification. When a clinical rule changes, the test
 * diff shows exactly what changed clinically.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRuleset, type EvaluationContext } from '@/lib/rules/engine';
import { GLP1_REPEAT_RULESET } from '@/lib/rules/glp1-ruleset';

/** A patient who is doing everything right. Each test bends one thing. */
function stablePatient(overrides: {
  answers?: Record<string, unknown>;
  derived?: Record<string, unknown>;
} = {}): EvaluationContext {
  return {
    answers: {
      doseRequest: 'same',
      supplyQuantity: '1',
      adverseEffects: 'none',
      missedDoses: '0',
      appetiteSuppression: 'full',
      snacking: 'controlled',
      hydration: 'high',
      historyChanged: 'no',
      pregnancy: 'no',
      consultType: 'online',
      ...overrides.answers,
    },
    derived: {
      bmi: 29.4,
      age: 45,
      medicine: 'Mounjaro',
      strength: '7.5mg',
      weeksOnDose: 6,
      missedDoses: 0,
      doseStepChange: 0,
      weightLossPercent: 2.6,
      ...overrides.derived,
    },
  };
}

const outcomeOf = (ctx: EvaluationContext) => evaluateRuleset(GLP1_REPEAT_RULESET, ctx).outcome;
const resultOf = (ctx: EvaluationContext) => evaluateRuleset(GLP1_REPEAT_RULESET, ctx);

describe('the baseline case', () => {
  it('approves a stable patient continuing the same dose', () => {
    expect(outcomeOf(stablePatient())).toBe('GREEN');
  });

  it('names the rule responsible, so the decision is explainable', () => {
    expect(resultOf(stablePatient()).decidingRuleId).toBe('stable-continue');
  });

  it('records every rule it considered, not just the one that fired', () => {
    const trace = resultOf(stablePatient()).trace;
    expect(trace.length).toBe(GLP1_REPEAT_RULESET.rules.length);
    expect(trace.some((t) => !t.matched)).toBe(true);
  });
});

describe('1. Eligibility and enrolment', () => {
  it('blocks a pregnant or breastfeeding patient', () => {
    expect(outcomeOf(stablePatient({ answers: { pregnancy: 'yes' } }))).toBe('RED');
  });

  it('blocks Wegovy over 74', () => {
    const ctx = stablePatient({ derived: { medicine: 'Wegovy', age: 75 } });
    expect(outcomeOf(ctx)).toBe('RED');
  });

  it('allows Wegovy at 74', () => {
    const ctx = stablePatient({ derived: { medicine: 'Wegovy', age: 74 } });
    expect(outcomeOf(ctx)).toBe('GREEN');
  });

  it('allows Mounjaro at 84 — a wider range than Wegovy', () => {
    expect(outcomeOf(stablePatient({ derived: { age: 84 } }))).toBe('GREEN');
  });

  it('blocks Mounjaro over 84', () => {
    expect(outcomeOf(stablePatient({ derived: { age: 85 } }))).toBe('RED');
  });

  it('blocks anyone under 18 on either medicine', () => {
    expect(outcomeOf(stablePatient({ derived: { age: 17 } }))).toBe('RED');
  });
});

describe('2. Dose request rules', () => {
  it('blocks a jump of more than one strength', () => {
    const ctx = stablePatient({
      answers: { doseRequest: 'increase' },
      derived: { doseStepChange: 3 },
    });
    expect(outcomeOf(ctx)).toBe('RED');
  });

  it('blocks a drop of more than one strength', () => {
    const ctx = stablePatient({
      answers: { doseRequest: 'decrease' },
      derived: { doseStepChange: -2 },
    });
    expect(outcomeOf(ctx)).toBe('RED');
  });

  it('approves a single-step increase after three weeks', () => {
    const ctx = stablePatient({
      answers: { doseRequest: 'increase' },
      derived: { doseStepChange: 1, weeksOnDose: 3 },
    });
    expect(outcomeOf(ctx)).toBe('GREEN');
  });

  it('sends an increase before three weeks to a pharmacist', () => {
    const ctx = stablePatient({
      answers: { doseRequest: 'increase' },
      derived: { doseStepChange: 1, weeksOnDose: 2 },
    });
    expect(outcomeOf(ctx)).toBe('AMBER');
  });

  it('phrases an approved increase as a question, never an instruction', () => {
    const ctx = stablePatient({
      answers: { doseRequest: 'increase' },
      derived: { doseStepChange: 1 },
    });
    expect(resultOf(ctx).message).toContain('confirm?');
  });
});

describe('3. Supply length rules', () => {
  it('approves one pen when stable for three weeks', () => {
    expect(outcomeOf(stablePatient({ answers: { supplyQuantity: '1' } }))).toBe('GREEN');
  });

  it('approves two pens after six weeks stable', () => {
    const ctx = stablePatient({ answers: { supplyQuantity: '2' }, derived: { weeksOnDose: 6 } });
    expect(outcomeOf(ctx)).toBe('GREEN');
  });

  it('reviews two pens before six weeks', () => {
    const ctx = stablePatient({ answers: { supplyQuantity: '2' }, derived: { weeksOnDose: 4 } });
    expect(outcomeOf(ctx)).toBe('AMBER');
  });

  it('always reviews three pens, whatever the history', () => {
    const ctx = stablePatient({ answers: { supplyQuantity: '3' }, derived: { weeksOnDose: 30 } });
    expect(outcomeOf(ctx)).toBe('AMBER');
  });
});

describe('4. BMI rules', () => {
  it('applies normal rules at 25 and above', () => {
    expect(outcomeOf(stablePatient({ derived: { bmi: 25 } }))).toBe('GREEN');
  });

  it('reviews the 23 to 24.9 band', () => {
    expect(outcomeOf(stablePatient({ derived: { bmi: 24 } }))).toBe('AMBER');
  });

  it('blocks a BMI under 23 when not tapering', () => {
    expect(outcomeOf(stablePatient({ derived: { bmi: 22 } }))).toBe('RED');
  });

  it('allows a BMI under 23 when the patient is tapering down', () => {
    const ctx = stablePatient({
      answers: { doseRequest: 'decrease' },
      derived: { bmi: 22, doseStepChange: -1 },
    });
    expect(outcomeOf(ctx)).toBe('GREEN');
  });

  it('congratulates a patient who is tapering at a healthy weight', () => {
    const ctx = stablePatient({
      answers: { doseRequest: 'decrease' },
      derived: { bmi: 22, doseStepChange: -1 },
    });
    expect(resultOf(ctx).advice.join(' ')).toContain('Congratulations');
  });
});

describe('5. Missed doses', () => {
  it('reviews one missed dose', () => {
    const ctx = stablePatient({ answers: { missedDoses: '1' }, derived: { missedDoses: 1 } });
    expect(outcomeOf(ctx)).toBe('AMBER');
  });

  it('blocks two or more missed doses', () => {
    const ctx = stablePatient({ answers: { missedDoses: '2+' }, derived: { missedDoses: 2 } });
    expect(outcomeOf(ctx)).toBe('RED');
  });
});

describe('6. Adverse effects', () => {
  it('approves when there are none', () => {
    expect(outcomeOf(stablePatient({ answers: { adverseEffects: 'none' } }))).toBe('GREEN');
  });

  it('approves mild effects, and offers advice on managing them', () => {
    const ctx = stablePatient({ answers: { adverseEffects: 'mild' } });
    expect(outcomeOf(ctx)).toBe('GREEN');
    expect(resultOf(ctx).advice.join(' ')).toContain('nausea');
  });

  it('reviews moderate effects and suggests considering a reduction', () => {
    const ctx = stablePatient({ answers: { adverseEffects: 'moderate' } });
    expect(outcomeOf(ctx)).toBe('AMBER');
    expect(resultOf(ctx).message).toContain('reduction');
  });

  it('blocks severe effects', () => {
    expect(outcomeOf(stablePatient({ answers: { adverseEffects: 'severe' } }))).toBe('RED');
  });

  it('blocks red-flag symptoms', () => {
    expect(outcomeOf(stablePatient({ answers: { adverseEffects: 'red_flag' } }))).toBe('RED');
  });
});

describe('7. Supportive checks', () => {
  it('reviews when appetite suppression is wearing off', () => {
    const ctx = stablePatient({ answers: { appetiteSuppression: 'wearing_off' } });
    expect(outcomeOf(ctx)).toBe('AMBER');
  });

  it('reviews when snacking has become daily', () => {
    expect(outcomeOf(stablePatient({ answers: { snacking: 'daily' } }))).toBe('AMBER');
  });

  it('reviews weight loss below the 2% monthly target', () => {
    expect(outcomeOf(stablePatient({ derived: { weightLossPercent: 0.8 } }))).toBe('AMBER');
  });

  it('adds hydration advice without blocking supply', () => {
    const ctx = stablePatient({ answers: { hydration: 'very_low' } });
    expect(outcomeOf(ctx)).toBe('GREEN');
    expect(resultOf(ctx).advice.join(' ')).toContain('1.5 to 2 litres');
  });
});

describe('safety net behaviour', () => {
  it('defaults to AMBER rather than GREEN when nothing matches cleanly', () => {
    const ctx: EvaluationContext = { answers: {}, derived: {} };
    expect(outcomeOf(ctx)).toBe('AMBER');
  });

  it('skips a rule whose answer is missing rather than treating it as satisfied', () => {
    const ctx: EvaluationContext = { answers: {}, derived: {} };
    const trace = resultOf(ctx).trace;
    expect(trace.some((t) => t.skippedReason?.includes('Missing answer'))).toBe(true);
  });

  it('never lets a missing answer produce GREEN', () => {
    const ctx: EvaluationContext = { answers: { doseRequest: 'same' }, derived: {} };
    expect(outcomeOf(ctx)).not.toBe('GREEN');
  });

  it('lets the most severe outcome win when several rules fire', () => {
    const ctx = stablePatient({
      answers: { adverseEffects: 'moderate', pregnancy: 'yes' },
    });
    expect(outcomeOf(ctx)).toBe('RED');
  });

  it('flags a patient who asked a question so they are spoken to at collection', () => {
    const ctx = stablePatient({ answers: { questionsForPharmacist: 'Is the rash normal?' } });
    expect(outcomeOf(ctx)).toBe('AMBER');
    expect(resultOf(ctx).message).toContain('collection');
  });

  it('routes a patient who asked to be seen to an appointment', () => {
    expect(outcomeOf(stablePatient({ answers: { consultType: 'clinic' } }))).toBe('AMBER');
  });

  it('never shows a dose recommendation to the patient', () => {
    const ctx = stablePatient({
      answers: { doseRequest: 'increase' },
      derived: { doseStepChange: 1 },
    });
    const patientMessage = resultOf(ctx).patientMessage ?? '';
    expect(patientMessage).not.toMatch(/\d+(\.\d+)?\s*mg/i);
  });
});
