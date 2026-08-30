/**
 * Authorising a repeat request.
 *
 * The README used to say GREEN auto-approves. It does not any more: the
 * client's newest workflow says GREEN may be fast-tracked but still needs the
 * legally required prescriber authorisation. A rules engine can say a request
 * looks routine; it cannot prescribe.
 */

import { describe, expect, it } from 'vitest';
import {
  repeatAuthorisationBlockers, repeatNeedsCall, repeatHasContact,
} from '@/lib/clinical/repeat-gate';

const ENROLLED = { enrolmentStatus: 'ACTIVE', calls: [], note: '' };

describe('GREEN', () => {
  it('can be authorised without a note or a call', () => {
    expect(repeatAuthorisationBlockers({ ...ENROLLED, outcome: 'GREEN' })).toEqual([]);
  });

  /*
   * The distinction the whole stage turns on. Nothing here issues anything —
   * this only says a prescriber MAY authorise it. The act itself stays theirs.
   */
  it('never requires a telephone call', () => {
    expect(repeatNeedsCall()).toBe(false);
  });
});

describe('AMBER', () => {
  it('cannot be approved without the pharmacist writing down why', () => {
    const blockers = repeatAuthorisationBlockers({ ...ENROLLED, outcome: 'AMBER' });
    expect(blockers.join(' ')).toMatch(/Record why you are content/);
  });

  it('can be approved once they have', () => {
    expect(repeatAuthorisationBlockers({
      ...ENROLLED,
      outcome: 'AMBER',
      note: 'Nausea settled, weight stable, happy to continue at the same dose.',
    })).toEqual([]);
  });

  it('does not accept whitespace as reasoning', () => {
    expect(repeatAuthorisationBlockers({ ...ENROLLED, outcome: 'AMBER', note: '   ' }))
      .not.toEqual([]);
  });

  /*
   * A call is not required to resolve an amber — some are resolved by reading
   * rather than ringing — but where one happened it should be visible.
   */
  it('does not demand a contact, only the reasoning', () => {
    expect(repeatAuthorisationBlockers({
      ...ENROLLED, outcome: 'AMBER', note: 'Reviewed the answers.', calls: [],
    })).toEqual([]);
  });
});

describe('RED', () => {
  /* A safety stop, not a strongly worded amber. A note does not clear it. */
  it('cannot be authorised at all', () => {
    const blockers = repeatAuthorisationBlockers({
      ...ENROLLED, outcome: 'RED', note: 'I have spoken to them and I am happy.',
    });
    expect(blockers.join(' ')).toMatch(/stopped on safety grounds/);
  });

  it('points at the urgent list rather than leaving them stuck', () => {
    const blockers = repeatAuthorisationBlockers({ ...ENROLLED, outcome: 'RED' });
    expect(blockers.join(' ')).toMatch(/urgent list/);
  });
});

describe('no evaluation at all', () => {
  /*
   * Untriaged is not a quiet green. No ruleset ran, so the pharmacist's own
   * reading is the only check there was, and they should say what they checked.
   */
  it('needs the pharmacist to record what they checked', () => {
    const blockers = repeatAuthorisationBlockers({ ...ENROLLED, outcome: null });
    expect(blockers.join(' ')).toMatch(/no safety checks ran/);
  });

  it('is satisfied by a note', () => {
    expect(repeatAuthorisationBlockers({
      ...ENROLLED, outcome: null, note: 'Read the answers, nothing of concern.',
    })).toEqual([]);
  });
});

describe('enrolment', () => {
  it('blocks somebody who was never enrolled, and points them the right way', () => {
    const blockers = repeatAuthorisationBlockers({
      ...ENROLLED, outcome: 'GREEN', enrolmentStatus: null,
    });
    expect(blockers.join(' ')).toMatch(/not enrolled/);
    expect(blockers.join(' ')).toMatch(/new-patient pathway/);
  });

  /*
   * Pausing an enrolment means "must be seen before the next supply". If a
   * paused patient could still be authorised, pausing would mean nothing.
   */
  it('blocks a paused enrolment even on a GREEN', () => {
    const blockers = repeatAuthorisationBlockers({
      ...ENROLLED, outcome: 'GREEN', enrolmentStatus: 'PAUSED',
    });
    expect(blockers.join(' ')).toMatch(/paused/);
  });
});

describe('reporting everything at once', () => {
  it('lists all the problems rather than the first', () => {
    const blockers = repeatAuthorisationBlockers({
      outcome: 'RED', enrolmentStatus: null, note: '', calls: [],
    });
    expect(blockers).toHaveLength(2);
  });
});

describe('showing whether anybody rang', () => {
  it('sees a completed call', () => {
    expect(repeatHasContact([
      { outcome: 'COMPLETED', identityVerified: false, completedAt: new Date() },
    ])).toBe(true);
  });

  it('does not count an unanswered attempt', () => {
    expect(repeatHasContact([
      { outcome: 'NO_ANSWER', identityVerified: false, completedAt: null },
    ])).toBe(false);
  });

  it('is false when nobody has tried', () => {
    expect(repeatHasContact([])).toBe(false);
  });
});
