/**
 * Calendar arithmetic, in the pharmacy's timezone.
 *
 * The Isle of Man runs BST in summer, so a 09:00 local appointment is 08:00
 * UTC. Grouping by the server's calendar day puts early appointments on the
 * wrong date for half the year, and only between midnight and 01:00 local —
 * which is exactly when nobody is testing. The same class of bug has already
 * been fixed twice here, in the slot generator and in dayBounds.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCalendar, groupByLocalDay, addDays, addMonths, startOfLocalWeek,
  localTimeLabel, WEEKDAY_LABELS,
} from '../src/lib/scheduling/calendar';
import { localDateKey } from '../src/lib/scheduling/slots';

/*
 * Assert on the LOCAL key, never on the UTC instant.
 *
 * Midnight on the Isle of Man in summer is 23:00 UTC the previous day, so
 * `toISOString()` on a correct local midnight reads as the day before — an
 * assertion written that way fails against working code and, worse, passes
 * against broken code in winter.
 */

describe('month grid', () => {
  it('always draws six whole weeks', () => {
    // A fixed height stops the grid jumping between a short February and a
    // long month that starts on a Sunday.
    for (const month of ['2026-02-15', '2026-05-15', '2026-08-15']) {
      expect(buildCalendar('month', new Date(`${month}T12:00:00Z`)).days).toHaveLength(42);
    }
  });

  it('starts on a Monday', () => {
    const { days } = buildCalendar('month', new Date('2026-08-15T12:00:00Z'));
    // Monday of the week containing 1 August 2026 is 27 July.
    expect(days[0]!.key).toBe('2026-07-27');
    expect(WEEKDAY_LABELS[0]).toBe('Mon');
  });

  it('marks borrowed days from the neighbouring months', () => {
    const { days } = buildCalendar('month', new Date('2026-08-15T12:00:00Z'));
    // August 2026 starts on a Saturday, so the grid borrows from July.
    expect(days[0]!.inScope).toBe(false);
    expect(days.some((d) => d.inScope)).toBe(true);
  });

  it('covers every borrowed day in its range', () => {
    // Querying only the month would leave a Monday looking empty when it is
    // not — the calendar would lie rather than omit.
    const { from, to, days } = buildCalendar('month', new Date('2026-08-15T12:00:00Z'));
    expect(days[0]!.date.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(days[41]!.date.getTime()).toBeLessThan(to.getTime());
  });
});

describe('week and day', () => {
  it('draws seven days from Monday', () => {
    const { days } = buildCalendar('week', new Date('2026-08-27T12:00:00Z'));
    expect(days).toHaveLength(7);
    expect(days[0]!.key).toBe('2026-08-24');
  });

  it('draws one day', () => {
    const { days } = buildCalendar('day', new Date('2026-08-27T12:00:00Z'));
    expect(days).toHaveLength(1);
    expect(days[0]!.key).toBe('2026-08-27');
  });

  it('finds the Monday of a Sunday', () => {
    // Sunday is the END of the week here, not the start of the next one.
    const monday = startOfLocalWeek(new Date('2026-08-30T12:00:00Z'));
    expect(localDateKey(monday)).toBe('2026-08-24');
  });
});

describe('date arithmetic', () => {
  it('clamps when a month is shorter', () => {
    // 31 January plus a month is February, not March.
    const result = addMonths(new Date('2026-01-31T12:00:00Z'), 1);
    expect(localDateKey(result)).toBe('2026-02-28');
  });

  it('crosses a month boundary by day', () => {
    const result = addDays(new Date('2026-08-31T12:00:00Z'), 1);
    expect(localDateKey(result)).toBe('2026-09-01');
  });
});

describe('grouping by pharmacy day', () => {
  it('keeps an early appointment on its local date', () => {
    // 00:30 BST on 30 August is 23:30 UTC on the 29th. Grouped by the server's
    // day it would appear on the wrong date.
    const items = [{ startsAt: new Date('2026-08-29T23:30:00Z') }];
    const grouped = groupByLocalDay(items);
    expect([...grouped.keys()]).toEqual(['2026-08-30']);
  });

  it('orders a day by time', () => {
    const items = [
      { startsAt: new Date('2026-08-30T13:00:00Z') },
      { startsAt: new Date('2026-08-30T09:00:00Z') },
      { startsAt: new Date('2026-08-30T11:00:00Z') },
    ];
    const day = groupByLocalDay(items).get('2026-08-30')!;
    expect(day.map((d) => d.startsAt.getUTCHours())).toEqual([9, 11, 13]);
  });

  it('shows the pharmacy clock, not the reader clock', () => {
    // 08:00 UTC in August is 09:00 on the Isle of Man.
    expect(localTimeLabel(new Date('2026-08-30T08:00:00Z'))).toBe('09:00');
  });

  it('is correct in winter too', () => {
    // In January there is no offset, so 09:00 UTC is 09:00 local.
    expect(localTimeLabel(new Date('2026-01-15T09:00:00Z'))).toBe('09:00');
  });
});
