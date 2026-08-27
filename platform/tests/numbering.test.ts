import { describe, it, expect } from 'vitest';
import { numberQuestions, visibleFields } from '@/lib/forms/runtime';
import { buildFluVaccinationForm } from '@/lib/services/flu-vaccination';
import { buildWeightManagementFirstForm } from '@/lib/services/weight-management';

const FLU = buildFluVaccinationForm([
  { id: 'gp-1', name: 'Hailwood Medical centre', email: 'Hailwoodmeds@gov.im' },
]);

const FIRST = buildWeightManagementFirstForm([{ id: 'br-1', name: 'Onchan' }]);

/**
 * He asked for numbering so he could say "question 7" when giving feedback.
 * A sequence that skips a number because a follow-up is currently hidden makes
 * that impossible, so these guard the property rather than the implementation.
 */
describe('question numbering is unbroken as the patient sees it', () => {
  it('numbers top-level questions 1, 2, 3 with no gaps', () => {
    const numbered = numberQuestions(FLU);
    const numbers = numbered.steps
      .flatMap((s) => s.fields)
      .filter((f) => f.type !== 'infoBlock')
      .map((f) => f.number);

    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('does not give a revealed follow-up a number of its own', () => {
    const numbered = numberQuestions(FLU);
    const gender = numbered.steps
      .flatMap((s) => s.fields)
      .find((f) => f.id === 'gender');

    const followUp = gender?.reveals?.[0]?.fields[0];
    expect(followUp?.id).toBe('genderSelfDescribed');
    expect(followUp?.number).toBeUndefined();
  });

  /**
   * A number is an IDENTIFIER, not a position. "Question 6" has to mean the same
   * question for every patient, otherwise it is useless for the thing he wants
   * it for — telling us which question to change.
   *
   * So a conditionally hidden question legitimately leaves a gap in what one
   * patient sees. What must never happen is the numbers shifting because of how
   * somebody answered.
   */
  it('keeps a question’s number identical however the form is answered', () => {
    const numbered = numberQuestions(FLU);
    const numberFor = (id: string) =>
      numbered.steps.flatMap((s) => s.fields).find((f) => f.id === id)?.number;

    const covid = numberFor('covidThisSeason');

    for (const answers of [
      { gender: 'male' },
      { gender: 'female' },
      { gender: 'other' },
      { gender: 'female', otherAllergies: 'yes' },
      {},
    ]) {
      const seen = visibleFields(numbered, answers, { includeClinicianOnly: true })
        .find((f) => f.id === 'covidThisSeason')?.number;
      expect(seen).toBe(covid);
    }
  });

  it('never shows the same number twice', () => {
    const numbered = numberQuestions(FLU);
    const numbers = numbered.steps
      .flatMap((s) => s.fields)
      .map((f) => f.number)
      .filter((n): n is number => n !== undefined);

    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('numbers the same whether a follow-up is open or closed', () => {
    const numbered = numberQuestions(FLU);
    const numberFor = (id: string) =>
      numbered.steps.flatMap((s) => s.fields).find((f) => f.id === id)?.number;

    expect(numberFor('phone')).toBe(5);
    expect(numberFor('email')).toBe(6);
  });

  it('holds for the long weight management form too', () => {
    const numbered = numberQuestions(FIRST);
    const numbers = numbered.steps
      .flatMap((s) => s.fields)
      .filter((f) => f.type !== 'infoBlock')
      .map((f) => f.number);

    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('still leaves the original schema untouched', () => {
    numberQuestions(FLU);
    expect(FLU.steps[0]!.fields[0]!.number).toBeUndefined();
  });
});
