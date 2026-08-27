import { describe, it, expect } from 'vitest';
import {
  visibleFields, validateForm, pruneHiddenAnswers, activeWarnings, numberQuestions,
} from '@/lib/forms/runtime';
import {
  buildWeightManagementFirstForm, buildWeightManagementRepeatForm,
  MEDICINE_STRENGTH_OPTIONS, CONTRAINDICATIONS, MOUNJARO_STRENGTHS, WEGOVY_STRENGTHS,
  GLP1_CLINICIAN_DECLARATIONS,
} from '@/lib/services/weight-management';

const BRANCHES = [
  { id: 'br-onchan', name: 'Onchan' },
  { id: 'br-kirk', name: 'Kirk Michael' },
];

const FIRST = buildWeightManagementFirstForm(BRANCHES);
const REPEAT = buildWeightManagementRepeatForm(BRANCHES);

const ids = (schema: Parameters<typeof visibleFields>[0], answers: Record<string, unknown>) =>
  visibleFields(schema, answers, { includeClinicianOnly: true }).map((f) => f.id);

describe('dose ladders feed the ±1 step rule', () => {
  it('carries Mounjaro strengths in clinical order', () => {
    expect(MOUNJARO_STRENGTHS).toEqual(['2.5mg', '5mg', '7.5mg', '10mg', '12.5mg', '15mg']);
  });

  it('carries Wegovy strengths in clinical order', () => {
    expect(WEGOVY_STRENGTHS).toEqual(['0.25mg', '0.5mg', '1mg', '1.7mg', '2.4mg']);
  });

  it('attaches medicine, strength and ladder position to every option', () => {
    const option = MEDICINE_STRENGTH_OPTIONS.find((o) => o.value === 'mounjaro_7.5mg');
    expect(option?.metadata).toEqual({ medicine: 'Mounjaro', strength: '7.5mg', ladderIndex: 2 });
  });

  it('offers all eleven strengths across both medicines', () => {
    expect(MEDICINE_STRENGTH_OPTIONS).toHaveLength(11);
  });
});

describe('contraindication screening', () => {
  it('corrects the legacy MED2 typo to MEN2', () => {
    const labels = CONTRAINDICATIONS.map((c) => c.label);
    expect(labels.some((l) => l.includes('MEN2'))).toBe(true);
    expect(labels.some((l) => l.includes('MED2'))).toBe(false);
  });

  it("restores the apostrophe in Crohn's disease", () => {
    expect(CONTRAINDICATIONS.some((c) => c.label.includes("Crohn's"))).toBe(true);
  });

  it('offers an explicit "none of the above" so a blank is never ambiguous', () => {
    expect(CONTRAINDICATIONS.some((c) => c.value === 'none')).toBe(true);
  });
});

describe('first consultation — gender-conditional safety questions', () => {
  const base = { gender: 'female' };

  it('asks a female patient about pregnancy and contraception', () => {
    const shown = ids(FIRST, base);
    expect(shown).toContain('pregnancy');
    expect(shown).toContain('oralContraception');
    expect(shown).not.toContain('bleedingDisorder');
  });

  it('asks a male patient about bleeding disorders instead', () => {
    const shown = ids(FIRST, { gender: 'male' });
    expect(shown).toContain('bleedingDisorder');
    expect(shown).not.toContain('pregnancy');
    expect(shown).not.toContain('oralContraception');
  });

  it('treats "other" as needing the female safety questions', () => {
    const shown = ids(FIRST, { gender: 'other' });
    expect(shown).toContain('pregnancy');
    expect(shown).not.toContain('bleedingDisorder');
  });
});

describe('first consultation — nested reveals', () => {
  it('hides the gallbladder detail until Yes', () => {
    expect(ids(FIRST, { gallbladder: 'no' })).not.toContain('gallbladderDetail');
    expect(ids(FIRST, { gallbladder: 'yes' })).toContain('gallbladderDetail');
  });

  it('hides the liver detail until Yes', () => {
    expect(ids(FIRST, { liver: 'yes' })).toContain('liverDetail');
  });

  it('asks which previous medicines only after Yes', () => {
    expect(ids(FIRST, { everUsedWeightLossMeds: 'no' })).not.toContain('previousMeds');
    expect(ids(FIRST, { everUsedWeightLossMeds: 'yes' })).toContain('previousMeds');
  });

  it('discards gallbladder detail when the answer is changed back to No', () => {
    const answered = { gallbladder: 'yes', gallbladderDetail: ['current'], gender: 'male' };
    const pruned = pruneHiddenAnswers(FIRST, { ...answered, gallbladder: 'no' });
    expect(pruned.gallbladderDetail).toBeUndefined();
  });
});

describe('first consultation — hard stops', () => {
  it('stops on pregnancy', () => {
    const warnings = activeWarnings(FIRST, { gender: 'female', pregnancy: 'yes' });
    expect(warnings.some((w) => w.severity === 'stop')).toBe(true);
  });

  it('warns, but does not stop, on oral contraception', () => {
    const warnings = activeWarnings(FIRST, { gender: 'female', oralContraception: 'yes' });
    expect(warnings.some((w) => w.severity === 'warn')).toBe(true);
    expect(warnings.some((w) => w.severity === 'stop')).toBe(false);
  });
});

describe('repeat request — the fields the decision engine reads', () => {
  it('collects everything his decision matrix needs', () => {
    const shown = ids(REPEAT, { gender: 'female' });
    for (const required of [
      'weight', 'bmi', 'weightLostThisMonth', 'currentMedicine', 'weeksOnDose',
      'missedDoses', 'adverseEffects', 'pregnancy', 'appetiteSuppression',
      'snacking', 'hydration', 'doseRequest', 'supplyQuantity',
    ]) {
      expect(shown).toContain(required);
    }
  });

  it('offers missed doses in the bands the rules use', () => {
    const field = REPEAT.steps
      .flatMap((s) => s.fields)
      .find((f) => f.id === 'missedDoses');
    expect(field?.options?.map((o) => o.value)).toEqual(['0', '1', '2+']);
  });

  it('grades adverse effects from none through to red flag', () => {
    const field = REPEAT.steps.flatMap((s) => s.fields).find((f) => f.id === 'adverseEffects');
    expect(field?.options?.map((o) => o.value)).toEqual([
      'none', 'mild', 'moderate', 'severe', 'red_flag',
    ]);
  });

  it('offers up to three pens, unlike the first consultation which caps at two', () => {
    const repeatSupply = REPEAT.steps.flatMap((s) => s.fields).find((f) => f.id === 'supplyQuantity');
    const firstSupply = FIRST.steps.flatMap((s) => s.fields).find((f) => f.id === 'supplyDuration');
    expect(repeatSupply?.options).toHaveLength(3);
    expect(firstSupply?.options).toHaveLength(2);
  });

  it('has no leading whitespace in any option value — the legacy " mild" bug', () => {
    const allValues = [...FIRST.steps, ...REPEAT.steps]
      .flatMap((s) => s.fields)
      .flatMap((f) => f.options ?? [])
      .map((o) => o.value);
    expect(allValues.every((v) => v === v.trim())).toBe(true);
  });
});

describe('repeat request — safety', () => {
  it('stops on a red-flag symptom', () => {
    const warnings = activeWarnings(REPEAT, { adverseEffects: 'red_flag' });
    expect(warnings.some((w) => w.severity === 'stop')).toBe(true);
  });

  it('stops on severe side effects', () => {
    const warnings = activeWarnings(REPEAT, { adverseEffects: 'severe' });
    expect(warnings.some((w) => w.severity === 'stop')).toBe(true);
  });

  it('stays quiet on mild side effects, which are allowed to continue', () => {
    expect(activeWarnings(REPEAT, { adverseEffects: 'mild' })).toEqual([]);
  });

  it('stops on pregnancy', () => {
    const warnings = activeWarnings(REPEAT, { gender: 'female', pregnancy: 'yes' });
    expect(warnings.some((w) => w.severity === 'stop')).toBe(true);
  });
});

describe('both forms are valid configurations', () => {
  it('start invalid because required answers are missing', () => {
    expect(validateForm(FIRST, {}).valid).toBe(false);
    expect(validateForm(REPEAT, {}).valid).toBe(false);
  });

  it('number their questions sequentially', () => {
    const numbered = numberQuestions(REPEAT);
    const numbers = numbered.steps
      .flatMap((s) => s.fields)
      .filter((f) => f.type !== 'infoBlock')
      .map((f) => f.number ?? 0);
    expect(numbers).toEqual(numbers.slice().sort((a, b) => a - b));
    expect(numbers[0]).toBe(1);
  });

  it('carry the seven pharmacist declarations from his scope of work', () => {
    expect(GLP1_CLINICIAN_DECLARATIONS).toHaveLength(7);
    expect(FIRST.clinicianDeclarations).toHaveLength(7);
    expect(REPEAT.clinicianDeclarations).toHaveLength(7);
  });

  it('compute BMI rather than asking the patient for it', () => {
    const bmi = REPEAT.steps.flatMap((s) => s.fields).find((f) => f.id === 'bmi');
    expect(bmi?.type).toBe('derived');
    expect(bmi?.calculation).toBe('bmi');
    expect(bmi?.calculationInputs).toEqual(['weight', 'height']);
  });

  it('every field carries a stable id', () => {
    const all = [...FIRST.steps, ...REPEAT.steps].flatMap((s) => s.fields);
    expect(all.every((f) => typeof f.id === 'string' && f.id.length > 0)).toBe(true);
  });
});
