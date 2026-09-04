/**
 * Who is due a repeat, and who has quietly stopped.
 *
 * The lapse case is the one that matters. A patient who ran out a month ago and
 * has not been heard from is invisible everywhere else in the system.
 */

import { describe, it, expect } from 'vitest';
import {
  countDue,
  daysUntilDue,
  describeDue,
  dueList,
  dueState,
  runsOutOn,
  supplyWeeks,
  type DueEnrolment,
} from '../src/lib/repeat-care/due';

const NOW = new Date('2026-09-01T10:00:00Z');

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

function enrolment(over: Partial<DueEnrolment> = {}): DueEnrolment {
  return {
    patientId: 'p1',
    patientName: 'Eleanor Quirk',
    externalRef: 'RC-XKT6-KCGY',
    medicine: 'Mounjaro',
    strength: '5mg',
    lastSuppliedAt: daysAgo(10),
    lastAnswers: { supplyQuantity: '1' },
    hasOpenRequest: false,
    ...over,
  };
}

describe('how long a supply lasts', () => {
  it('reads the repeat form answer, one pen being four weeks', () => {
    expect(supplyWeeks({ supplyQuantity: '1' })).toBe(4);
    expect(supplyWeeks({ supplyQuantity: '2' })).toBe(8);
  });

  it('reads the new-patient form answer, which uses another id', () => {
    expect(supplyWeeks({ supplyDuration: '2' })).toBe(8);
  });

  it('falls back to four weeks rather than dropping somebody off the list', () => {
    // An approximately-due patient is far more useful than an invisible one.
    expect(supplyWeeks(null)).toBe(4);
    expect(supplyWeeks({})).toBe(4);
    expect(supplyWeeks({ supplyQuantity: 'lots' })).toBe(4);
    expect(supplyWeeks({ supplyQuantity: '0' })).toBe(4);
  });

  it('caps a mistyped quantity', () => {
    // 52 pens would push somebody a year out and past every list that would
    // have caught the mistake.
    expect(supplyWeeks({ supplyQuantity: '52' })).toBe(24);
  });
});

describe('when a supply runs out', () => {
  it('is the supply length after the last one', () => {
    const runsOut = runsOutOn(new Date('2026-08-01T00:00:00Z'), 4);
    expect(runsOut?.toISOString().slice(0, 10)).toBe('2026-08-29');
  });

  it('is unknown when there has never been a supply', () => {
    expect(runsOutOn(null, 4)).toBeNull();
    expect(daysUntilDue(null, NOW)).toBeNull();
  });
});

describe('what state that puts them in', () => {
  const on = (days: number) => dueState(new Date(NOW.getTime() + days * 86_400_000), NOW);

  it('is covered while there is more than a week left', () => {
    expect(on(20)).toBe('COVERED');
    expect(on(8)).toBe('COVERED');
  });

  it('is due soon inside the last week', () => {
    expect(on(7)).toBe('DUE_SOON');
    expect(on(1)).toBe('DUE_SOON');
    expect(on(0)).toBe('DUE_SOON');
  });

  it('is due once it has run out', () => {
    expect(on(-1)).toBe('DUE');
    expect(on(-14)).toBe('DUE');
  });

  it('is lapsed after a fortnight overdue', () => {
    expect(on(-15)).toBe('LAPSED');
    expect(on(-90)).toBe('LAPSED');
  });

  it('is its own state when nothing was ever supplied', () => {
    expect(dueState(null, NOW)).toBe('NEVER_SUPPLIED');
  });
});

describe('the list', () => {
  it('leaves out anyone still covered', () => {
    const rows = dueList([enrolment({ lastSuppliedAt: daysAgo(1) })], NOW);
    expect(rows).toEqual([]);
  });

  it('leaves out anyone who has already come back', () => {
    // Chasing a patient whose request is sitting in the queue awaiting a
    // decision is worse than not chasing at all.
    const rows = dueList([
      enrolment({ lastSuppliedAt: daysAgo(40), hasOpenRequest: true }),
    ], NOW);

    expect(rows).toEqual([]);
  });

  it('puts the longest overdue first', () => {
    const rows = dueList([
      enrolment({ patientId: 'a', lastSuppliedAt: daysAgo(30) }),
      enrolment({ patientId: 'b', lastSuppliedAt: daysAgo(60) }),
      enrolment({ patientId: 'c', lastSuppliedAt: daysAgo(26) }),
    ], NOW);

    expect(rows.map((r) => r.patientId)).toEqual(['b', 'a', 'c']);
  });

  it('puts never-supplied last, because it is a different job', () => {
    const rows = dueList([
      enrolment({ patientId: 'never', lastSuppliedAt: null }),
      enrolment({ patientId: 'lapsed', lastSuppliedAt: daysAgo(60) }),
    ], NOW);

    expect(rows.map((r) => r.patientId)).toEqual(['lapsed', 'never']);
  });

  it('respects a longer supply before calling somebody due', () => {
    // Two pens is eight weeks. At six weeks they are still covered.
    const rows = dueList([
      enrolment({ lastSuppliedAt: daysAgo(42), lastAnswers: { supplyQuantity: '2' } }),
    ], NOW);

    expect(rows).toEqual([]);
  });
});

describe('counting for the dashboard', () => {
  it('separates the states and totals them', () => {
    const rows = dueList([
      enrolment({ patientId: 'a', lastSuppliedAt: daysAgo(25) }),  // due soon
      enrolment({ patientId: 'b', lastSuppliedAt: daysAgo(35) }),  // due
      enrolment({ patientId: 'c', lastSuppliedAt: daysAgo(90) }),  // lapsed
      enrolment({ patientId: 'd', lastSuppliedAt: null }),         // never
    ], NOW);

    const counts = countDue(rows);
    expect(counts).toEqual({ dueSoon: 1, due: 1, lapsed: 1, neverSupplied: 1, total: 4 });
  });

  it('counts nothing when nobody is due', () => {
    expect(countDue([]).total).toBe(0);
  });
});

describe('saying it out loud', () => {
  const rowFor = (days: number) => dueList([
    enrolment({ lastSuppliedAt: daysAgo(28 - days) }),
  ], NOW)[0]!;

  it('counts forward while there is time left', () => {
    expect(describeDue(rowFor(3))).toBe('Runs out in 3 days');
    expect(describeDue(rowFor(1))).toBe('Runs out tomorrow');
    expect(describeDue(rowFor(0))).toBe('Runs out today');
  });

  it('counts back once overdue', () => {
    expect(describeDue(rowFor(-1))).toBe('Ran out yesterday');
    expect(describeDue(rowFor(-5))).toBe('Ran out 5 days ago');
  });

  it('switches to weeks once days stop being useful', () => {
    expect(describeDue(rowFor(-30))).toBe('Ran out 4 weeks ago');
  });

  it('says so plainly when there has never been a supply', () => {
    const row = dueList([enrolment({ lastSuppliedAt: null })], NOW)[0]!;
    expect(describeDue(row)).toBe('Never supplied through us');
  });
});
