import { describe, it, expect } from 'vitest';
import {
  visibleFields, visibleSteps, pruneHiddenAnswers, validateForm, validateStep,
  numberQuestions, collectMetadata, activeWarnings, isStepUnlocked, expandField,
  resolveConsentClauses,
} from '@/lib/forms/runtime';
import { buildFluVaccinationForm } from '@/lib/services/flu-vaccination';
import type { FormSchema } from '@/types/form-schema';

const SURGERIES = [
  { id: 'gp-1', name: 'Hailwood Medical centre', email: 'Hailwoodmeds@gov.im' },
  { id: 'gp-2', name: 'Peel Group Practice', email: 'peeldoctors@gov.im' },
];

const FLU = buildFluVaccinationForm(SURGERIES);

/**
 * Find a question by id rather than by position.
 *
 * Two tests here indexed the form as `steps[1].fields[3]`, so reordering the
 * questionnaire to match the specification broke them without anything
 * actually being wrong. The id is the stable handle — that is the whole point
 * of the schema's id rule — so tests should use it.
 */
function field(id: string) {
  for (const step of FLU.steps) {
    const found = step.fields.find((f) => f.id === id);
    if (found) return found;
  }
  throw new Error(`No field ${id} in the flu form`);
}

const HEALTH_STEP = FLU.steps.find((st) => st.id === 'health')!;

const BASE = {
  firstName: 'Bridget',
  lastName: 'Kelly',
  dateOfBirth: '1974-03-05',
  gender: 'female',
  phone: '01624 615150',
  email: 'b@example.im',
  address: '1 Main Road, Onchan',
  gpSurgery: 'gp-1',
};

describe('conditional reveals — the dominant pattern in his forms', () => {
  it('hides the detail box until the answer is Yes', () => {
    const hidden = visibleFields(FLU, { ...BASE, otherAllergies: 'no' }).map((f) => f.id);
    expect(hidden).not.toContain('otherAllergiesDetail');

    const shown = visibleFields(FLU, { ...BASE, otherAllergies: 'yes' }).map((f) => f.id);
    expect(shown).toContain('otherAllergiesDetail');
  });

  it('places the revealed field immediately after its parent', () => {
    const expanded = expandField(field('otherAllergies'), { otherAllergies: 'yes' });
    expect(expanded.map((f) => f.id)).toEqual(['otherAllergies', 'otherAllergiesDetail']);
  });
});

describe('gender drives the pregnancy question, exactly as specified', () => {
  it('closes it for male patients', () => {
    const ids = visibleFields(FLU, { ...BASE, gender: 'male' }).map((f) => f.id);
    expect(ids).not.toContain('pregnant');
  });

  it('opens it for female patients', () => {
    const ids = visibleFields(FLU, { ...BASE, gender: 'female' }).map((f) => f.id);
    expect(ids).toContain('pregnant');
  });

  it('opens it for anyone selecting Other', () => {
    const ids = visibleFields(FLU, { ...BASE, gender: 'other' }).map((f) => f.id);
    expect(ids).toContain('pregnant');
  });

  it('asks Other to self-describe', () => {
    const ids = visibleFields(FLU, { ...BASE, gender: 'other' }).map((f) => f.id);
    expect(ids).toContain('genderSelfDescribed');
  });
});

describe('clinician-only fields', () => {
  it('never appear on the patient form', () => {
    const ids = visibleFields(FLU, BASE).map((f) => f.id);
    expect(ids).not.toContain('feverLast24Hours');
  });

  it('appear for the clinician', () => {
    const ids = visibleFields(FLU, BASE, { includeClinicianOnly: true }).map((f) => f.id);
    expect(ids).toContain('feverLast24Hours');
  });
});

describe('pruneHiddenAnswers — a record must not contradict itself', () => {
  it('discards detail typed before the answer was changed back to No', () => {
    const answered = {
      ...BASE,
      otherAllergies: 'yes',
      otherAllergiesDetail: 'Penicillin — rash',
    };
    expect(pruneHiddenAnswers(FLU, answered).otherAllergiesDetail).toBe('Penicillin — rash');

    const changed = { ...answered, otherAllergies: 'no' };
    const pruned = pruneHiddenAnswers(FLU, changed);
    expect(pruned.otherAllergiesDetail).toBeUndefined();
    expect(pruned.otherAllergies).toBe('no');
  });

  it('discards a pregnancy answer if gender changes to male', () => {
    const pruned = pruneHiddenAnswers(FLU, { ...BASE, gender: 'male', pregnant: 'no' });
    expect(pruned.pregnant).toBeUndefined();
  });
});

describe('validation', () => {
  it('fails while required answers are missing', () => {
    expect(validateForm(FLU, {}).valid).toBe(false);
  });

  it('reports the field label so the message is usable', () => {
    const issues = validateForm(FLU, {}).issues;
    expect(issues.some((i) => i.fieldLabel === 'First name')).toBe(true);
  });

  it('does not require an answer to a hidden field', () => {
    const male = validateStep(HEALTH_STEP, {
      ...BASE, gender: 'male',
      hadFluVaccineBefore: 'yes', fluVaccineThisSeason: 'no',
      vaccineReaction: 'no', otherAllergies: 'no',
      bleedingDisorder: 'no', currentMedication: 'no',
      currentlyUnwell: 'no', covidThisSeason: 'yes',
      feverLast24Hours: 'no',
    });
    expect(male.valid).toBe(true);
  });

  it('requires the revealed detail once Yes is chosen', () => {
    const result = validateStep(HEALTH_STEP, {
      ...BASE, gender: 'male',
      hadFluVaccineBefore: 'yes', fluVaccineLast6Months: 'no',
      vaccineReaction: 'yes', otherAllergies: 'no',
      currentlyUnwell: 'no', covidThisSeason: 'yes',
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.fieldId === 'vaccineReactionDetail')).toBe(true);
  });
});

describe('warnings', () => {
  it('raises a hard stop when the clinician records a fever', () => {
    const warnings = activeWarnings(FLU, { ...BASE, feverLast24Hours: 'yes' });
    expect(warnings.some((w) => w.severity === 'stop')).toBe(true);
  });

  it('prompts to offer a COVID vaccine when they have not had one', () => {
    const warnings = activeWarnings(FLU, { ...BASE, covidThisSeason: 'no' });
    expect(warnings.some((w) => w.message.includes('COVID'))).toBe(true);
  });

  it('stays quiet when nothing is triggered', () => {
    expect(activeWarnings(FLU, { ...BASE, covidThisSeason: 'yes' })).toEqual([]);
  });
});

describe('hidden option metadata', () => {
  it('carries the GP mailbox into the submission without showing it', () => {
    const metadata = collectMetadata(FLU, { ...BASE, gpSurgery: 'gp-1' });
    expect(metadata.gpSurgeryContact).toEqual({
      email: 'Hailwoodmeds@gov.im',
      name: 'Hailwood Medical centre',
    });
  });

  it('collects nothing when no option is selected', () => {
    const metadata = collectMetadata(FLU, { ...BASE, gpSurgery: undefined });
    expect(metadata.gpSurgeryContact).toBeUndefined();
  });
});

describe('question numbering — he asked for this and never got it', () => {
  it('numbers every question sequentially and skips info blocks', () => {
    const numbered = numberQuestions(FLU);
    const first = numbered.steps[0]!.fields[0]!;
    expect(first.number).toBe(1);

    const all = numbered.steps.flatMap((s) => s.fields).filter((f) => f.type !== 'infoBlock');
    const numbers = all.map((f) => f.number);
    expect(numbers).toEqual(numbers.slice().sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it('does not mutate the original schema', () => {
    numberQuestions(FLU);
    expect(FLU.steps[0]!.fields[0]!.number).toBeUndefined();
  });
});

describe('step gating', () => {
  const gated: FormSchema = {
    schemaVersion: 1,
    title: 'Gated',
    steps: [
      { id: 'one', title: 'One', fields: [{ id: 'photoId', type: 'fileUpload', label: 'Photo ID' }] },
      { id: 'two', title: 'Two', unlockedBy: ['photoId'], fields: [{ id: 'card', type: 'shortText', label: 'Card' }] },
    ],
  };

  it('locks the step until its dependency is answered', () => {
    expect(isStepUnlocked(gated.steps[1]!, {})).toBe(false);
    expect(isStepUnlocked(gated.steps[1]!, { photoId: 'file.jpg' })).toBe(true);
  });

  it('treats a step with no dependencies as unlocked', () => {
    expect(isStepUnlocked(gated.steps[0]!, {})).toBe(true);
  });
});

describe('steps', () => {
  it('keeps all three flu steps visible', () => {
    expect(visibleSteps(FLU, BASE).map((s) => s.id)).toEqual(['about-you', 'health', 'consent']);
  });
});

// ─────────────────────────────────────────────────────────────
// Reveals hung off a DROPDOWN, not just Yes/No.
//
// The designer could only create Yes/No follow-ups, so "Gender → Other → how
// would you describe it" existed in the seeded forms and could not be rebuilt
// through the UI. These pin the behaviour the designer now writes.
// ─────────────────────────────────────────────────────────────

describe('follow-ups on a dropdown answer', () => {
  const gender: FormField = {
    id: 'gender',
    type: 'select',
    label: 'Gender',
    options: [
      { value: 'female', label: 'Female' },
      { value: 'male', label: 'Male' },
      { value: 'other', label: 'Other' },
    ],
    reveals: [
      {
        whenValue: 'other',
        fields: [
          {
            id: 'genderSelfDescribed',
            type: 'shortText',
            label: 'How would you describe your gender?',
            required: true,
          },
        ],
      },
    ],
  };

  it('stays hidden for an answer with no follow-up', () => {
    const ids = expandField(gender, { gender: 'female' }).map((f) => f.id);
    expect(ids).toEqual(['gender']);
  });

  it('appears for the answer it is attached to', () => {
    const ids = expandField(gender, { gender: 'other' }).map((f) => f.id);
    expect(ids).toEqual(['gender', 'genderSelfDescribed']);
  });

  it('is hidden again when the answer changes away', () => {
    expect(expandField(gender, { gender: 'other' })).toHaveLength(2);
    expect(expandField(gender, { gender: 'male' })).toHaveLength(1);
  });

  it('is hidden while the question is unanswered', () => {
    expect(expandField(gender, {}).map((f) => f.id)).toEqual(['gender']);
  });
});

describe('follow-ups on Yes/No use the string the control writes', () => {
  // The designer previously hardcoded whenValue: 'yes'. That happens to be
  // right — the pill control writes 'yes'/'no', not booleans — and this test
  // exists so a future change to either side breaks loudly rather than
  // producing a follow-up that is configured and never appears.
  const allergy: FormField = {
    id: 'hasAllergy',
    type: 'yesNo',
    label: 'Do you have any allergies?',
    reveals: [
      {
        whenValue: 'yes',
        fields: [
          { id: 'allergyDetail', type: 'longText', label: 'Which ones?', required: true },
        ],
      },
    ],
  };

  it('reveals on the string "yes"', () => {
    expect(expandField(allergy, { hasAllergy: 'yes' }).map((f) => f.id)).toEqual([
      'hasAllergy',
      'allergyDetail',
    ]);
  });

  it('does not reveal on a boolean true', () => {
    expect(expandField(allergy, { hasAllergy: true }).map((f) => f.id)).toEqual([
      'hasAllergy',
    ]);
  });

  it('does not reveal on "no"', () => {
    expect(expandField(allergy, { hasAllergy: 'no' }).map((f) => f.id)).toEqual([
      'hasAllergy',
    ]);
  });
});

describe('consent clauses', () => {
  const CLAUSE_A = { id: 'a', text: 'Form-wide statement.' };
  const CLAUSE_B = { id: 'b', text: 'This question only.' };

  const schema: FormSchema = {
    schemaVersion: 1,
    title: 'Consent',
    consentClauses: [CLAUSE_A],
    steps: [],
  };

  it('falls back to the form-wide list', () => {
    const field = { id: 'consent', type: 'consentList' as const, label: 'Consent' };
    expect(resolveConsentClauses(field, schema)).toEqual([CLAUSE_A]);
  });

  it('prefers the question’s own list', () => {
    const field = {
      id: 'consent',
      type: 'consentList' as const,
      label: 'Consent',
      consentClauses: [CLAUSE_B],
    };
    expect(resolveConsentClauses(field, schema)).toEqual([CLAUSE_B]);
  });

  /*
   * The one that would break silently. An empty list on the field is a
   * deliberate "show nothing", and must not fall through to the form-wide list
   * — a `||` here instead of `??` would inherit ten statements the pharmacy
   * had explicitly cleared.
   */
  it('treats an empty list on the question as deliberate, not missing', () => {
    const field = {
      id: 'consent',
      type: 'consentList' as const,
      label: 'Consent',
      consentClauses: [],
    };
    expect(resolveConsentClauses(field, schema)).toEqual([]);
  });

  it('returns nothing when neither is set', () => {
    const bare: FormSchema = { schemaVersion: 1, title: 'Bare', steps: [] };
    const field = { id: 'consent', type: 'consentList' as const, label: 'Consent' };
    expect(resolveConsentClauses(field, bare)).toEqual([]);
  });
});

describe('validation patterns', () => {
  function withPattern(pattern: string): FormSchema {
    return {
      schemaVersion: 1,
      title: 'Pattern',
      steps: [
        {
          id: 's1',
          title: 'One',
          fields: [
            { id: 'code', type: 'shortText', label: 'Code', validation: { pattern } },
          ],
        },
      ],
    };
  }

  it('applies a valid pattern', () => {
    const schema = withPattern('^[A-Z]{3}$');
    expect(validateForm(schema, { code: 'ABC' }).valid).toBe(true);
    expect(validateForm(schema, { code: 'abc' }).valid).toBe(false);
  });

  /*
   * An unparseable pattern used to reach `new RegExp` unguarded and THROW,
   * which took down validation for the whole step rather than failing one
   * field — a patient would have met a crash, not a validation message.
   * It is now ignored: the wrong answer to let through, and far better than
   * that.
   */
  it('ignores an unparseable pattern instead of throwing', () => {
    const schema = withPattern('([unclosed');
    expect(() => validateForm(schema, { code: 'anything' })).not.toThrow();
    expect(validateForm(schema, { code: 'anything' }).valid).toBe(true);
  });
});
