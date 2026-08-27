/**
 * Clinical acceptance tests for the GLP-1 repeat care ruleset.
 *
 * These are written to be readable by a pharmacist, not just a developer.
 * Each describe block corresponds to a table in the client's decision matrix,
 * so they can be checked line by line against the specification.
 *
 * If the client changes a clinical rule, the corresponding test changes with
 * it — and the diff shows exactly what changed clinically.
 */

import { describe, expect, it } from 'vitest';
import { evaluateRuleset } from '@/lib/rules/engine';
import { GLP1_REPEAT_RULESET } from '@/lib/rules/glp1-ruleset';
import type { EvaluationContext } from '@/types/rule-schema';

/** A stable, healthy request that should come back GREEN with no flags. */
function baselineRequest(overrides: {
  answers?: Record<string, unknown>;
  derived?: Record<string, unknown>;
} = {}): EvaluationContext {
  return {
    answers: {
      medicine: 'Mounjaro',
      doseRequest: 'Same',
      supplyMonths: 1,
      pregnant: 'No',
      breastfeeding: 'No',
      adverseEffects: 'None',
      redFlagSymptoms: 'No',
      missedDoses: 0,
      healthChanges: 'No',
      appetiteSuppression: 'Full suppression all week',
      snacking: 'Less than 3 regular meals, no snacks',
      hydration: '≥ 2.0 L/day',
      ...overrides.answers,
    },
    derived: {
      age: 44,
      bmi: 31.2,
      weightLossPercent: 3.1,
      weeksOnCurrentDose: 8,
      doseStepChange: 0,
      ...overrides.derived,
    },
  };
}

function evaluate(context: EvaluationContext) {
  return evaluateRuleset(GLP1_REPEAT_RULESET, context);
}

describe('Baseline: a stable patient making a routine request', () => {
  it('returns GREEN', () => {
    expect(evaluate(baselineRequest()).outcome).toBe('GREEN');
  });

  it('GREEN still requires a pharmacist to confirm — it is not an auto-supply', () => {
    // Encoded as a message addressed to the clinician, never an instruction
    // to the patient. See CLAUDE.md §3.
    const result = evaluate(baselineRequest());
    expect(result.message).toContain('confirm');
    expect(result.patientMessage).toBeUndefined();
  });
});

describe('Eligibility (Decision Matrix, table 1)', () => {
  it('blocks a pregnant patient', () => {
    const result = evaluate(baselineRequest({ answers: { pregnant: 'Yes' } }));
    expect(result.outcome).toBe('RED');
    expect(result.decidingRuleId).toBe('elig-pregnancy');
  });

  it('blocks a breastfeeding patient', () => {
    expect(evaluate(baselineRequest({ answers: { breastfeeding: 'Yes' } })).outcome).toBe('RED');
  });

  it('blocks Wegovy above age 74', () => {
    const result = evaluate(baselineRequest({
      answers: { medicine: 'Wegovy' },
      derived: { age: 75 },
    }));
    expect(result.outcome).toBe('RED');
  });

  it('allows Mounjaro at age 80 — the Mounjaro range extends to 84', () => {
    const result = evaluate(baselineRequest({
      answers: { medicine: 'Mounjaro' },
      derived: { age: 80 },
    }));
    expect(result.outcome).not.toBe('RED');
  });

  it('blocks anyone under 18 on either medicine', () => {
    expect(evaluate(baselineRequest({ derived: { age: 17 } })).outcome).toBe('RED');
    expect(evaluate(baselineRequest({
      answers: { medicine: 'Wegovy' },
      derived: { age: 17 },
    })).outcome).toBe('RED');
  });

  it('never shows a patient a dose recommendation when blocked', () => {
    const result = evaluate(baselineRequest({ answers: { pregnant: 'Yes' } }));
    expect(result.patientMessage).toBeDefined();
    expect(result.patientMessage?.toLowerCase()).not.toMatch(/increase|decrease|\d+\s?mg/);
  });
});

describe('Dose change rules (Decision Matrix, table 2)', () => {
  it('blocks a jump of more than one strength step', () => {
    const result = evaluate(baselineRequest({
      answers: { doseRequest: 'Increase' },
      derived: { doseStepChange: 2 },
    }));
    expect(result.outcome).toBe('RED');
    expect(result.decidingRuleId).toBe('dose-step-skip');
  });

  it('allows a single-step increase after 3 weeks on the current dose', () => {
    const result = evaluate(baselineRequest({
      answers: { doseRequest: 'Increase' },
      derived: { doseStepChange: 1, weeksOnCurrentDose: 4 },
    }));
    expect(result.outcome).not.toBe('RED');
  });

  it('flags AMBER when a change is requested before 3 weeks', () => {
    const result = evaluate(baselineRequest({
      answers: { doseRequest: 'Increase' },
      derived: { doseStepChange: 1, weeksOnCurrentDose: 2 },
    }));
    expect(result.outcome).toBe('AMBER');
    expect(result.trace.find((t) => t.ruleId === 'dose-change-too-soon')?.matched).toBe(true);
  });
});

describe('Supply length rules (Decision Matrix, table 3)', () => {
  it('allows two months after 6 weeks stable with no adverse effects', () => {
    const result = evaluate(baselineRequest({
      answers: { supplyMonths: 2 },
      derived: { weeksOnCurrentDose: 7 },
    }));
    expect(result.outcome).not.toBe('RED');
    expect(result.trace.find((t) => t.ruleId === 'supply-2month-unstable')?.matched).toBe(false);
  });

  it('flags AMBER for two months without 6 weeks of stability', () => {
    const result = evaluate(baselineRequest({
      answers: { supplyMonths: 2 },
      derived: { weeksOnCurrentDose: 4 },
    }));
    expect(result.outcome).toBe('AMBER');
  });

  it('flags AMBER for more than two months, rather than blocking', () => {
    // The client is explicit that the tool should not block supply unnecessarily.
    const result = evaluate(baselineRequest({
      answers: { supplyMonths: 3 },
      derived: { weeksOnCurrentDose: 12 },
    }));
    expect(result.outcome).toBe('AMBER');
  });
});

describe('BMI rules (Decision Matrix, table 4)', () => {
  it('applies normal rules at BMI 25 or above', () => {
    expect(evaluate(baselineRequest({ derived: { bmi: 28 } })).outcome).toBe('GREEN');
  });

  it('flags AMBER between 23 and 24.9', () => {
    const result = evaluate(baselineRequest({ derived: { bmi: 24 } }));
    expect(result.outcome).toBe('AMBER');
  });

  it('blocks below BMI 23 when not requesting a decrease', () => {
    const result = evaluate(baselineRequest({
      answers: { doseRequest: 'Same' },
      derived: { bmi: 22 },
    }));
    expect(result.outcome).toBe('RED');
  });

  it('allows tapering below BMI 23 when a decrease is requested', () => {
    const result = evaluate(baselineRequest({
      answers: { doseRequest: 'Decrease' },
      derived: { bmi: 22, weeksOnCurrentDose: 8, doseStepChange: 1 },
    }));
    expect(result.outcome).toBe('GREEN');
    expect(result.decidingRuleId).toBe('bmi-under-23-decrease');
  });

  it('congratulates the patient when BMI falls below 25', () => {
    const result = evaluate(baselineRequest({ derived: { bmi: 24 } }));
    expect(result.advice.join(' ')).toMatch(/healthy BMI/i);
  });
});

describe('Missed doses (Decision Matrix, table 5)', () => {
  it('is GREEN with no missed doses', () => {
    expect(evaluate(baselineRequest({ answers: { missedDoses: 0 } })).outcome).toBe('GREEN');
  });

  it('flags AMBER for one missed dose', () => {
    expect(evaluate(baselineRequest({ answers: { missedDoses: 1 } })).outcome).toBe('AMBER');
  });

  it('blocks at two or more missed doses', () => {
    expect(evaluate(baselineRequest({ answers: { missedDoses: 2 } })).outcome).toBe('RED');
    expect(evaluate(baselineRequest({ answers: { missedDoses: 5 } })).outcome).toBe('RED');
  });
});

describe('Adverse effects (Decision Matrix, table 6)', () => {
  it('is GREEN for none', () => {
    expect(evaluate(baselineRequest({ answers: { adverseEffects: 'None' } })).outcome).toBe('GREEN');
  });

  it('is GREEN for mild when the patient is happy to continue', () => {
    expect(evaluate(baselineRequest({ answers: { adverseEffects: 'Mild' } })).outcome).toBe('GREEN');
  });

  it('flags AMBER for moderate and suggests considering a reduction', () => {
    const result = evaluate(baselineRequest({ answers: { adverseEffects: 'Moderate' } }));
    expect(result.outcome).toBe('AMBER');
    expect(result.message).toMatch(/reduction/i);
  });

  it('blocks for severe', () => {
    expect(evaluate(baselineRequest({ answers: { adverseEffects: 'Severe' } })).outcome).toBe('RED');
  });

  it('blocks on a red flag symptom even when severity is reported as mild', () => {
    const result = evaluate(baselineRequest({
      answers: { adverseEffects: 'Mild', redFlagSymptoms: 'Yes' },
    }));
    expect(result.outcome).toBe('RED');
  });
});

describe('Supportive checks (Decision Matrix, table 7)', () => {
  it('flags AMBER when suppression is wearing off', () => {
    const result = evaluate(baselineRequest({
      answers: { appetiteSuppression: 'Wearing off before next dose' },
    }));
    expect(result.outcome).toBe('AMBER');
  });

  it('flags AMBER when snacking has become frequent', () => {
    const result = evaluate(baselineRequest({
      answers: { snacking: 'Frequent snacking / grazing' },
    }));
    expect(result.outcome).toBe('AMBER');
  });

  it('appends hydration advice without blocking', () => {
    const result = evaluate(baselineRequest({
      answers: { hydration: '< 1.0 L/day', adverseEffects: 'Mild' },
    }));
    expect(result.outcome).toBe('GREEN');
    expect(result.advice.join(' ')).toMatch(/1.5–2 litres/);
  });

  it('reinforces good hydration positively', () => {
    const result = evaluate(baselineRequest());
    expect(result.advice.join(' ')).toMatch(/hydration is excellent/i);
  });
});

describe('Safety net behaviours', () => {
  it('flags AMBER when the patient reports new medicines or conditions', () => {
    expect(evaluate(baselineRequest({ answers: { healthChanges: 'Yes' } })).outcome).toBe('AMBER');
  });

  it('flags AMBER when the patient has asked a question', () => {
    const result = evaluate(baselineRequest({
      answers: { patientQuestion: 'Should I still inject if I have a cold?' },
    }));
    expect(result.outcome).toBe('AMBER');
    expect(result.message).toMatch(/dispensing pharmacist/i);
  });

  it('defaults to AMBER when answers are incomplete', () => {
    // Never GREEN on missing data — that is the whole point of the default.
    const result = evaluateRuleset(GLP1_REPEAT_RULESET, { answers: {}, derived: {} });
    expect(result.outcome).toBe('AMBER');
  });

  it('produces a full trace for every decision, for audit', () => {
    const result = evaluate(baselineRequest());
    expect(result.trace.length).toBe(GLP1_REPEAT_RULESET.rules.length);
    expect(result.trace.every((t) => typeof t.matched === 'boolean')).toBe(true);
  });
});
