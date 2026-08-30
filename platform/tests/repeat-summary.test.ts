/**
 * The queue row's one-line summary.
 *
 * A pharmacist had to open every request to find out whether it was routine,
 * because all four facts that make it routine were computed, stored, and then
 * left off the row.
 */

import { describe, expect, it } from 'vitest';
import {
  requestFacts, waitingFor, strengthOf, hasQuestionFor, freeTextFieldIds,
} from '@/lib/repeat-care/summary';

const ON_5MG = { medicine: 'Mounjaro', strength: '5mg' };

describe('the dose line', () => {
  it('shows the move when they are asking to go up', () => {
    const { dose } = requestFacts({
      derived: { medicine: 'Mounjaro', strength: '5mg' },
      answers: { requestedMedicine: 'mounjaro_7.5mg' },
      previous: ON_5MG,
    });
    expect(dose).toBe('Mounjaro 5mg → 7.5mg');
  });

  it('shows one strength when nothing is changing', () => {
    const { dose } = requestFacts({
      derived: { medicine: 'Mounjaro', strength: '5mg' },
      answers: { requestedMedicine: 'mounjaro_5mg' },
      previous: ON_5MG,
    });
    expect(dose).toBe('Mounjaro 5mg');
  });

  it('shows a step down as readily as a step up', () => {
    const { dose } = requestFacts({
      derived: {},
      answers: { requestedMedicine: 'mounjaro_2.5mg' },
      previous: ON_5MG,
    });
    expect(dose).toBe('Mounjaro 5mg → 2.5mg');
  });

  /*
   * A first request from somebody with no enrolment behind it: there is no
   * "from", and inventing one would be a lie about their history.
   */
  it('falls back to the requested strength alone with no previous supply', () => {
    const { dose } = requestFacts({
      derived: { medicine: 'Mounjaro' },
      answers: { requestedMedicine: 'mounjaro_2.5mg' },
      previous: { medicine: null, strength: null },
    });
    expect(dose).toBe('Mounjaro 2.5mg');
  });

  it('is null when there is no medicine at all', () => {
    const { dose } = requestFacts({
      derived: {}, answers: {}, previous: { medicine: null, strength: null },
    });
    expect(dose).toBeNull();
  });

  it('titles a medicine taken from the enrolment', () => {
    const { dose } = requestFacts({
      derived: {},
      answers: {},
      previous: { medicine: 'mounjaro', strength: '5mg' },
    });
    expect(dose).toBe('Mounjaro 5mg');
  });
});

describe('reading a strength off an option value', () => {
  it('takes everything after the first underscore', () => {
    expect(strengthOf('mounjaro_7.5mg')).toBe('7.5mg');
  });

  /*
   * Not ladder-validated on purpose. The rules already skip a strength that has
   * drifted off the ladder; hiding it here would leave the row looking normal
   * while the dose-step check silently did not run.
   */
  it('shows a strength that is not on any ladder rather than hiding it', () => {
    expect(strengthOf('notreal_99mg')).toBe('99mg');
  });

  it('gives null for anything that is not an option value', () => {
    for (const bad of ['', 'mounjaro', null, undefined, 42, 'mounjaro_']) {
      expect(strengthOf(bad)).toBeNull();
    }
  });
});

describe('the weight line', () => {
  /*
   * `weightLossPercent` is positive when weight has been LOST. Written the way
   * a chart would write it, a 4.2% loss is −4.2%.
   */
  it('writes a loss as a negative change', () => {
    const { weightChange } = requestFacts({
      derived: { weightLossPercent: 4.2 }, answers: {}, previous: ON_5MG,
    });
    expect(weightChange).toBe('−4.2% since last supply');
  });

  it('writes a gain as a positive change', () => {
    const { weightChange } = requestFacts({
      derived: { weightLossPercent: -1.5 }, answers: {}, previous: ON_5MG,
    });
    expect(weightChange).toBe('+1.5% since last supply');
  });

  it('says nothing when it could not be computed', () => {
    const { weightChange } = requestFacts({
      derived: { weightLossPercent: null }, answers: {}, previous: ON_5MG,
    });
    expect(weightChange).toBeNull();
  });

  it('rounds to one decimal', () => {
    const { weightChange } = requestFacts({
      derived: { weightLossPercent: 4.2666 }, answers: {}, previous: ON_5MG,
    });
    expect(weightChange).toBe('−4.3% since last supply');
  });
});

describe('the time on dose', () => {
  it('counts weeks, singular at one', () => {
    expect(requestFacts({ derived: { weeksOnDose: 1 }, answers: {}, previous: ON_5MG }).timeOnDose)
      .toBe('1 week on dose');
    expect(requestFacts({ derived: { weeksOnDose: 5 }, answers: {}, previous: ON_5MG }).timeOnDose)
      .toBe('5 weeks on dose');
  });

  it('says nothing when it is missing', () => {
    expect(requestFacts({ derived: {}, answers: {}, previous: ON_5MG }).timeOnDose).toBeNull();
  });
});

describe('how long it has been waiting', () => {
  const NOW = new Date(Date.UTC(2026, 7, 30, 12, 0));
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  it('reads as an age, not a date', () => {
    expect(waitingFor(daysAgo(0), NOW)).toBe('waiting today');
    expect(waitingFor(daysAgo(1), NOW)).toBe('waiting 1 day');
    expect(waitingFor(daysAgo(3), NOW)).toBe('waiting 3 days');
  });

  it('switches to weeks once days stop being useful', () => {
    expect(waitingFor(daysAgo(13), NOW)).toBe('waiting 13 days');
    expect(waitingFor(daysAgo(14), NOW)).toBe('waiting 2 weeks');
    expect(waitingFor(daysAgo(30), NOW)).toBe('waiting 4 weeks');
  });

  /* Clock skew between the database and the server must not print "-1 days". */
  it('never reports a negative age', () => {
    expect(waitingFor(new Date(NOW.getTime() + 60_000), NOW)).toBe('waiting today');
  });

  it('is null for a submission with no timestamp', () => {
    expect(waitingFor(null, NOW)).toBeNull();
  });
});

describe('whether they actually asked something', () => {
  const FREE_TEXT = new Set(['anythingElse', 'questionsForPharmacist']);

  /*
   * The reported false positive. `anythingElse` is a yes/no field on the
   * current GLP-1 form, so counting any non-empty string made the queue read
   * "2 asked" on three requests, none of which carried a question.
   */
  it('does not count "no" as a question', () => {
    for (const answer of ['no', 'No', 'NO', ' none ', 'nothing', 'n/a', 'nil', '-']) {
      expect(hasQuestionFor({ anythingElse: answer })).toBe(false);
    }
  });

  it('counts something they actually wrote', () => {
    expect(hasQuestionFor({ anythingElse: 'I have been feeling sick in the mornings' }))
      .toBe(true);
  });

  it('ignores a field that is not free text when the schema says so', () => {
    // A yes/no `anythingElse` that somehow holds prose is still not a question
    // box, so it is not treated as one.
    expect(hasQuestionFor({ anythingElse: 'maybe' }, new Set(['questionsForPharmacist'])))
      .toBe(false);
    expect(hasQuestionFor({ anythingElse: 'maybe' }, FREE_TEXT)).toBe(true);
  });

  it('ignores non-string answers', () => {
    expect(hasQuestionFor({ anythingElse: true })).toBe(false);
    expect(hasQuestionFor({ anythingElse: 42 })).toBe(false);
    expect(hasQuestionFor({})).toBe(false);
  });

  it('checks every field that could carry a message', () => {
    expect(hasQuestionFor({ notesForPharmacist: 'please ring me' })).toBe(true);
    expect(hasQuestionFor({ patientQuestion: 'can I take this with ibuprofen?' })).toBe(true);
  });
});

describe('finding the free-text fields on a questionnaire', () => {
  it('picks up short and long text, and nothing else', () => {
    const ids = freeTextFieldIds({
      steps: [{
        fields: [
          { id: 'firstName', type: 'shortText' },
          { id: 'story', type: 'longText' },
          { id: 'weight', type: 'measurement' },
          { id: 'anythingElse', type: 'yesNo' },
        ],
      }],
    });
    expect([...ids].sort()).toEqual(['firstName', 'story']);
  });

  /* Fields revealed by a previous answer are nested, and count just the same. */
  it('descends into revealed fields', () => {
    const ids = freeTextFieldIds({
      steps: [{
        fields: [{
          id: 'allergies',
          type: 'yesNo',
          reveals: [{ whenValue: 'yes', fields: [{ id: 'allergyDetail', type: 'longText' }] }],
        }],
      }] as never,
    });
    expect(ids.has('allergyDetail')).toBe(true);
  });
});

describe('the box the prose is actually typed into', () => {
  /*
   * `anythingElse` is a yes/no on both weight management forms; what the
   * patient writes goes into the field it reveals. Checking only the yes/no
   * counted every "no" as a question and missed everyone who had written
   * something — wrong in both directions at once.
   */
  it('counts what they wrote in the revealed box', () => {
    expect(hasQuestionFor({
      anythingElse: 'yes',
      anythingElseDetail: 'I have been getting headaches in the afternoons',
    })).toBe(true);
  });

  it('still ignores a plain no with nothing written', () => {
    expect(hasQuestionFor({ anythingElse: 'no' })).toBe(false);
  });

  it('picks up side effects reported by a transferring patient', () => {
    expect(hasQuestionFor({
      priorSideEffects: 'yes',
      priorSideEffectsDetail: 'Nausea for the first fortnight',
    })).toBe(true);
  });
});
