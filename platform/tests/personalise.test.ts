/**
 * Personalising a repeat questionnaire.
 *
 * The published schema must come back untouched — a patient's answers are bound
 * to it, and two patients on different strengths must not produce two published
 * versions.
 */

import { describe, it, expect } from 'vitest';
import { personaliseRepeatSchema } from '../src/lib/clinical/personalise';
import type { FormSchema } from '../src/types/form-schema';

const SCHEMA: FormSchema = {
  schemaVersion: 1,
  title: 'Repeat request',
  steps: [
    {
      id: 'request',
      title: 'Your request',
      fields: [
        { id: 'systemRecommendation', type: 'shortText', label: 'Recommendation' },
        {
          id: 'changeDose', type: 'yesNo', label: 'Change your dose?',
          reveals: [{
            whenValue: 'yes',
            fields: [{
              id: 'requestedMedicine', type: 'select', label: 'Which strength?',
              options: [
                { value: 'mounjaro_2.5mg', label: 'Mounjaro 2.5mg' },
                { value: 'mounjaro_15mg', label: 'Mounjaro 15mg' },
              ],
            }],
          }],
        },
      ],
    },
  ],
};

function findField(schema: FormSchema, id: string) {
  const walk = (fields: typeof SCHEMA.steps[0]['fields']): typeof fields[0] | null => {
    for (const f of fields) {
      if (f.id === id) return f;
      for (const r of f.reveals ?? []) {
        const found = walk(r.fields);
        if (found) return found;
      }
    }
    return null;
  };
  for (const step of schema.steps) {
    const found = walk(step.fields);
    if (found) return found;
  }
  return null;
}

describe('dose options are narrowed to the ladder', () => {
  it('replaces the published options with same and one step', () => {
    const personalised = personaliseRepeatSchema({
      schema: SCHEMA, currentMedicineValue: 'mounjaro_7.5mg',
    });
    const field = findField(personalised, 'requestedMedicine');
    expect(field?.options?.map((o) => o.value)).toEqual([
      'mounjaro_5mg', 'mounjaro_7.5mg', 'mounjaro_10mg',
    ]);
  });

  it('reaches a field nested inside a reveal', () => {
    // The dose question sits behind "do you want to change your dose?", so a
    // transform that only walked top-level fields would silently do nothing.
    const personalised = personaliseRepeatSchema({
      schema: SCHEMA, currentMedicineValue: 'mounjaro_7.5mg',
    });
    expect(findField(personalised, 'requestedMedicine')?.options).toHaveLength(3);
  });

  it('never offers the two-step jump the published form listed', () => {
    const personalised = personaliseRepeatSchema({
      schema: SCHEMA, currentMedicineValue: 'mounjaro_2.5mg',
    });
    const values = findField(personalised, 'requestedMedicine')?.options?.map((o) => o.value);
    expect(values).not.toContain('mounjaro_15mg');
  });

  it('leaves the published schema alone', () => {
    const before = JSON.stringify(SCHEMA);
    personaliseRepeatSchema({ schema: SCHEMA, currentMedicineValue: 'mounjaro_7.5mg' });
    expect(JSON.stringify(SCHEMA)).toBe(before);
  });

  it('changes nothing when there is no previous supply', () => {
    const personalised = personaliseRepeatSchema({
      schema: SCHEMA, currentMedicineValue: null,
    });
    expect(personalised).toBe(SCHEMA);
  });
});

describe('the recommendation', () => {
  it('becomes a read-only information block', () => {
    const personalised = personaliseRepeatSchema({
      schema: SCHEMA,
      currentMedicineValue: 'mounjaro_7.5mg',
      recommendation: {
        appetiteSuppression: 'poor', snacking: 'frequent',
        adverseEffects: 'none', weeksOnDose: 6, bmi: 30, missedDoses: 0,
      },
    });

    const field = findField(personalised, 'systemRecommendation');
    // Answerable would invite a patient to "agree" with advice, which is not
    // what is being asked of them.
    expect(field?.type).toBe('infoBlock');
    expect(field?.required).toBe(false);
    expect(field?.helpText).toBeTruthy();
  });

  it('is left alone when there is nothing to say', () => {
    const personalised = personaliseRepeatSchema({
      schema: SCHEMA, currentMedicineValue: 'mounjaro_7.5mg', recommendation: null,
    });
    expect(findField(personalised, 'systemRecommendation')?.type).toBe('shortText');
  });
});
