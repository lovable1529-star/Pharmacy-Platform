import { describe, expect, it } from 'vitest';
import {
  collectMetadata,
  expandField,
  isVisible,
  numberQuestions,
  pruneHiddenAnswers,
  validateForm,
  validateStep,
  visibleFields,
} from '@/lib/forms/runtime';
import type { FormSchema } from '@/types/form-schema';

/** Mirrors the real flu vaccine form, including its conditional branches. */
const fluSchema: FormSchema = {
  schemaVersion: 1,
  title: 'Flu Vaccine Consultation',
  numberQuestions: true,
  steps: [
    {
      id: 'about',
      title: 'About you',
      fields: [
        { id: 'fullName', type: 'text', label: 'Full name', required: true },
        {
          id: 'gender',
          type: 'select',
          label: 'What is your gender?',
          required: true,
          options: [
            { value: 'Male', label: 'Male' },
            { value: 'Female', label: 'Female' },
            { value: 'Other', label: 'Prefer to self-describe' },
          ],
          reveals: [
            {
              whenValue: 'Other',
              fields: [{ id: 'genderDetail', type: 'text', label: 'Please describe', required: true }],
            },
          ],
        },
        {
          id: 'gpSurgery',
          type: 'select',
          label: 'GP surgery',
          required: true,
          storeMetadataAs: 'gpContact',
          options: [
            { value: 'onchan', label: 'Onchan Surgery', metadata: { email: 'onchan@gov.im' } },
            { value: 'ramsey', label: 'Ramsey Group Practice', metadata: { email: 'ramsey@gov.im' } },
          ],
        },
      ],
    },
    {
      id: 'health',
      title: 'Health questions',
      fields: [
        {
          id: 'allergies',
          type: 'yesno',
          label: 'Do you have any allergies?',
          required: true,
          reveals: [
            {
              whenValue: 'Yes',
              fields: [
                { id: 'allergyDetail', type: 'textarea', label: 'Please give details', required: true },
              ],
            },
          ],
        },
        {
          id: 'fever',
          type: 'yesno',
          label: 'Fever in the last 24 hours?',
          required: true,
          clinicianOnly: true,
        },
      ],
    },
    {
      id: 'pregnancy',
      title: 'Pregnancy',
      visibleWhen: [{ field: 'gender', operator: 'eq', value: 'Female' }],
      fields: [
        { id: 'pregnant', type: 'yesno', label: 'Are you pregnant?', required: true },
      ],
    },
  ],
};

describe('field visibility', () => {
  it('shows a field with no conditions', () => {
    expect(isVisible({ }, {})).toBe(true);
  });

  it('hides a step when its condition is not met', () => {
    const step = fluSchema.steps[2]!;
    expect(isVisible(step, { gender: 'Male' })).toBe(false);
    expect(isVisible(step, { gender: 'Female' })).toBe(true);
  });

  it('reveals a child field when the trigger value is selected', () => {
    const allergies = fluSchema.steps[1]!.fields[0]!;
    expect(expandField(allergies, { allergies: 'No' })).toHaveLength(1);
    expect(expandField(allergies, { allergies: 'Yes' }).map((f) => f.id))
      .toEqual(['allergies', 'allergyDetail']);
  });

  it('includes conditionally revealed fields in the full visible set', () => {
    const ids = visibleFields(fluSchema, { gender: 'Other', allergies: 'Yes' }).map((f) => f.id);
    expect(ids).toContain('genderDetail');
    expect(ids).toContain('allergyDetail');
  });
});

describe('pruneHiddenAnswers', () => {
  it('drops answers whose field is no longer visible', () => {
    // Patient said Yes, filled the detail, then changed to No.
    const answers = { allergies: 'No', allergyDetail: 'Penicillin', fullName: 'Jane Kelly' };
    const pruned = pruneHiddenAnswers(fluSchema, answers);

    expect(pruned.allergyDetail).toBeUndefined();
    expect(pruned.allergies).toBe('No');
    expect(pruned.fullName).toBe('Jane Kelly');
  });

  it('drops answers from a step that is no longer shown', () => {
    const answers = { gender: 'Male', pregnant: 'No' };
    expect(pruneHiddenAnswers(fluSchema, answers).pregnant).toBeUndefined();
  });

  it('keeps answers that are still visible', () => {
    const answers = { allergies: 'Yes', allergyDetail: 'Eggs' };
    expect(pruneHiddenAnswers(fluSchema, answers).allergyDetail).toBe('Eggs');
  });
});

describe('validation', () => {
  it('requires visible required fields', () => {
    const result = validateForm(fluSchema, {});
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.fieldId)).toContain('fullName');
  });

  it('does not require hidden fields', () => {
    const result = validateForm(fluSchema, {
      fullName: 'Jane Kelly', gender: 'Male', gpSurgery: 'onchan', allergies: 'No',
    });
    expect(result.issues.map((i) => i.fieldId)).not.toContain('allergyDetail');
    expect(result.issues.map((i) => i.fieldId)).not.toContain('pregnant');
  });

  it('requires a revealed field once it is shown', () => {
    const result = validateForm(fluSchema, {
      fullName: 'Jane Kelly', gender: 'Male', gpSurgery: 'onchan', allergies: 'Yes',
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.fieldId)).toContain('allergyDetail');
  });

  it('excludes clinician-only questions from patient validation', () => {
    // The patient cannot answer the fever question — it is asked on the day.
    const result = validateForm(fluSchema, {
      fullName: 'Jane Kelly', gender: 'Male', gpSurgery: 'onchan', allergies: 'No',
    });
    expect(result.valid).toBe(true);
  });

  it('includes clinician-only questions on the clinician form', () => {
    const result = validateForm(fluSchema, {
      fullName: 'Jane Kelly', gender: 'Male', gpSurgery: 'onchan', allergies: 'No',
    }, { includeClinicianOnly: true });

    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.fieldId)).toContain('fever');
  });

  it('validates a single step independently', () => {
    const result = validateStep(fluSchema.steps[0]!, { fullName: 'Jane Kelly' });
    expect(result.issues.map((i) => i.fieldId)).toEqual(['gender', 'gpSurgery']);
  });

  it('gives actionable error messages, not just "invalid"', () => {
    const result = validateForm(fluSchema, {});
    expect(result.issues[0]?.message).toMatch(/needs an answer/i);
  });

  it('enforces numeric bounds', () => {
    const schema: FormSchema = {
      schemaVersion: 1, title: 'T',
      steps: [{ id: 's', title: 'S', fields: [
        { id: 'weight', type: 'number', label: 'Weight (kg)', validation: { min: 30, max: 400 } },
      ] }],
    };
    expect(validateForm(schema, { weight: 20 }).valid).toBe(false);
    expect(validateForm(schema, { weight: 92 }).valid).toBe(true);
  });

  it('validates email format', () => {
    const schema: FormSchema = {
      schemaVersion: 1, title: 'T',
      steps: [{ id: 's', title: 'S', fields: [
        { id: 'email', type: 'email', label: 'Email' },
      ] }],
    };
    expect(validateForm(schema, { email: 'not-an-email' }).valid).toBe(false);
    expect(validateForm(schema, { email: 'jane@example.com' }).valid).toBe(true);
  });
});

describe('question numbering', () => {
  it('numbers questions sequentially across steps, including revealed fields', () => {
    const numbered = numberQuestions(fluSchema);
    expect(numbered.steps[0]!.fields[0]!.number).toBe(1);
    expect(numbered.steps[0]!.fields[1]!.number).toBe(2);
    // The revealed child is numbered inside its parent's sequence.
    expect(numbered.steps[0]!.fields[1]!.reveals?.[0]?.fields[0]?.number).toBe(3);
  });
});

describe('hidden metadata', () => {
  it('captures the GP email attached to the selected surgery', () => {
    const metadata = collectMetadata(fluSchema, { gpSurgery: 'onchan' });
    expect(metadata.gpContact).toEqual({ email: 'onchan@gov.im' });
  });

  it('returns nothing when no option is selected', () => {
    expect(collectMetadata(fluSchema, {})).toEqual({});
  });
});
