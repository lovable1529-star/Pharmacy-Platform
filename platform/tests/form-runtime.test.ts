import { describe, it, expect } from 'vitest';
import {
  visibleFields, visibleSteps, pruneHiddenAnswers, validateForm, validateStep,
  numberQuestions, collectMetadata, activeWarnings, isStepUnlocked, expandField,
} from '@/lib/forms/runtime';
import { buildFluVaccinationForm } from '@/lib/services/flu-vaccination';
import type { FormSchema } from '@/types/form-schema';

const SURGERIES = [
  { id: 'gp-1', name: 'Hailwood Medical centre', email: 'Hailwoodmeds@gov.im' },
  { id: 'gp-2', name: 'Peel Group Practice', email: 'peeldoctors@gov.im' },
];

const FLU = buildFluVaccinationForm(SURGERIES);

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
    const expanded = expandField(FLU.steps[1]!.fields[3]!, { otherAllergies: 'yes' });
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
    const male = validateStep(FLU.steps[1]!, {
      ...BASE, gender: 'male',
      hadFluVaccineBefore: 'yes', fluVaccineLast6Months: 'no',
      vaccineReaction: 'no', otherAllergies: 'no',
      currentlyUnwell: 'no', covidThisSeason: 'yes',
    });
    expect(male.valid).toBe(true);
  });

  it('requires the revealed detail once Yes is chosen', () => {
    const result = validateStep(FLU.steps[1]!, {
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
