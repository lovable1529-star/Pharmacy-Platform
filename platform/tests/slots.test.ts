import { describe, it, expect } from 'vitest';
import { fromZonedTime } from 'date-fns-tz';
import {
  generateSlots, generateSlotsForRange, nextAvailableSlot, isSlotBookable,
  windowsForDay, overlaps, buildAppointmentReference, localDateKey,
  PHARMACY_TIMEZONE,
  type AvailabilityWindow, type ExistingBooking,
} from '@/lib/scheduling/slots';

/**
 * Every fixture here is built in the PHARMACY's timezone, not the machine's.
 *
 * The earlier version of this file used `new Date(2026, 8, 1, 9, 0)`, which is
 * whatever 9am means where the test happens to run. That passed on a laptop in
 * London and produced a booking page offering 04:30 to 12:15 on a server in
 * India — so the fixtures now say what they mean.
 */
const BRANCH = 'br-onchan';
const OTHER_BRANCH = 'br-kirk';

/** A wall-clock time on the Isle of Man, as a UTC instant. */
function iom(date: string, time = '00:00'): Date {
  return fromZonedTime(`${date}T${time}:00`, PHARMACY_TIMEZONE);
}

/** How a moment reads on the pharmacy's own clock. */
function clock(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}

/** Tuesday 1 September 2026. September is British Summer Time, UTC+1. */
const TUESDAY = iom('2026-09-01');
const WEDNESDAY = iom('2026-09-02');
/** Well before the first slot that day. */
const EARLY = iom('2026-09-01', '06:00');

function window(over: Partial<AvailabilityWindow> = {}): AvailabilityWindow {
  return {
    id: 'w1',
    branchId: BRANCH,
    serviceId: null,
    weekday: 2, // Tuesday
    startMinute: 9 * 60,
    endMinute: 12 * 60,
    slotMinutes: 15,
    capacity: 1,
    ...over,
  };
}

function booking(time: string, over: Partial<ExistingBooking> = {}): ExistingBooking {
  const startsAt = iom('2026-09-01', time);
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + 15 * 60_000),
    branchId: BRANCH,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────

describe('slots are generated on the pharmacy clock, not the server clock', () => {
  it('a 09:00–12:00 window starts at 09:00 on the Isle of Man', () => {
    const slots = generateSlots({ windows: [window()], bookings: [], day: TUESDAY, now: EARLY });
    expect(clock(slots[0]!.startsAt)).toBe('09:00');
  });

  it('and ends at 12:00, not some offset of it', () => {
    const slots = generateSlots({ windows: [window()], bookings: [], day: TUESDAY, now: EARLY });
    expect(clock(slots.at(-1)!.endsAt)).toBe('12:00');
  });

  it('holds through a daylight-saving change — 09:00 in winter too', () => {
    // 1 December 2026 is a Tuesday, and the Isle of Man is on GMT by then.
    const december = iom('2026-12-01');
    const slots = generateSlots({
      windows: [window()], bookings: [], day: december, now: iom('2026-12-01', '06:00'),
    });
    expect(clock(slots[0]!.startsAt)).toBe('09:00');
  });

  it('reports the pharmacy’s calendar date, not the server’s', () => {
    expect(localDateKey(iom('2026-09-01', '23:30'))).toBe('2026-09-01');
  });
});

describe('windows apply to the right day', () => {
  it('matches the weekday as the pharmacy sees it', () => {
    expect(windowsForDay([window()], TUESDAY)).toHaveLength(1);
    expect(windowsForDay([window()], WEDNESDAY)).toHaveLength(0);
  });

  it('filters by branch', () => {
    expect(windowsForDay([window()], TUESDAY, { branchId: OTHER_BRANCH })).toHaveLength(0);
  });

  it('treats a window with no service as open to every service', () => {
    expect(windowsForDay([window()], TUESDAY, { serviceId: 'svc-flu' })).toHaveLength(1);
  });

  it('respects a window tied to one service', () => {
    const tied = [window({ serviceId: 'svc-glp1' })];
    expect(windowsForDay(tied, TUESDAY, { serviceId: 'svc-flu' })).toHaveLength(0);
    expect(windowsForDay(tied, TUESDAY, { serviceId: 'svc-glp1' })).toHaveLength(1);
  });

  it('ignores a window that has not started yet', () => {
    expect(windowsForDay([window({ effectiveFrom: '2026-10-01' })], TUESDAY)).toHaveLength(0);
  });

  it('ignores a window that has finished', () => {
    expect(windowsForDay([window({ effectiveTo: '2026-08-01' })], TUESDAY)).toHaveLength(0);
  });

  it('includes a window effective from that very day', () => {
    expect(windowsForDay([window({ effectiveFrom: '2026-09-01' })], TUESDAY)).toHaveLength(1);
  });
});

describe('generating a day of slots', () => {
  it('divides the window into slots', () => {
    const slots = generateSlots({ windows: [window()], bookings: [], day: TUESDAY, now: EARLY });
    expect(slots).toHaveLength(12); // 09:00–12:00 in 15-minute slots
  });

  it('never runs past the end of the window', () => {
    const slots = generateSlots({
      windows: [window({ endMinute: 9 * 60 + 40 })],
      bookings: [], day: TUESDAY, now: EARLY,
    });
    // 09:00 and 09:15 fit; 09:30–09:45 would overrun 09:40.
    expect(slots).toHaveLength(2);
  });

  it('returns nothing on a day with no window', () => {
    expect(generateSlots({ windows: [window()], bookings: [], day: WEDNESDAY, now: EARLY }))
      .toHaveLength(0);
  });
});

describe('bookings remove slots', () => {
  it('hides a slot that is already taken', () => {
    const slots = generateSlots({
      windows: [window()], bookings: [booking('09:00')], day: TUESDAY, now: EARLY,
    });
    expect(slots.map((s) => clock(s.startsAt))).not.toContain('09:00');
    expect(slots).toHaveLength(11);
  });

  it('keeps a slot open while capacity remains', () => {
    const slots = generateSlots({
      windows: [window({ capacity: 2 })], bookings: [booking('09:00')],
      day: TUESDAY, now: EARLY, includeUnavailable: true,
    });
    const nine = slots.find((s) => clock(s.startsAt) === '09:00');
    expect(nine?.booked).toBe(1);
    expect(nine?.available).toBe(true);
  });

  it('closes it once capacity is used up', () => {
    const slots = generateSlots({
      windows: [window({ capacity: 2 })],
      bookings: [booking('09:00'), booking('09:00')],
      day: TUESDAY, now: EARLY, includeUnavailable: true,
    });
    expect(slots.find((s) => clock(s.startsAt) === '09:00')?.unavailableReason).toBe('full');
  });

  it('frees the slot again when a booking is cancelled', () => {
    const slots = generateSlots({
      windows: [window()], bookings: [booking('09:00', { cancelled: true })],
      day: TUESDAY, now: EARLY,
    });
    expect(slots).toHaveLength(12);
  });

  it('ignores bookings at another branch', () => {
    const slots = generateSlots({
      windows: [window()], bookings: [booking('09:00', { branchId: OTHER_BRANCH })],
      day: TUESDAY, branchId: BRANCH, now: EARLY,
    });
    expect(slots).toHaveLength(12);
  });
});

describe('the past is never offered', () => {
  it('drops slots that have already started', () => {
    const tenAm = iom('2026-09-01', '10:00');
    const slots = generateSlots({ windows: [window()], bookings: [], day: TUESDAY, now: tenAm });
    expect(slots.every((s) => s.startsAt > tenAm)).toBe(true);
  });

  it('respects a minimum notice period', () => {
    const slots = generateSlots({
      windows: [window()], bookings: [], day: TUESDAY,
      now: iom('2026-09-01', '08:50'), leadTimeMinutes: 60, includeUnavailable: true,
    });
    expect(slots.find((s) => clock(s.startsAt) === '09:00')?.unavailableReason).toBe('too-soon');
    expect(slots.find((s) => clock(s.startsAt) === '10:00')?.available).toBe(true);
  });
});

describe('overlapping windows do not duplicate slots', () => {
  it('merges two windows covering the same hours', () => {
    const slots = generateSlots({
      windows: [window({ id: 'a' }), window({ id: 'b' })],
      bookings: [], day: TUESDAY, now: EARLY,
    });
    expect(slots).toHaveLength(12);
  });

  it('takes the greater capacity where they overlap', () => {
    const slots = generateSlots({
      windows: [window({ id: 'a', capacity: 1 }), window({ id: 'b', capacity: 3 })],
      bookings: [], day: TUESDAY, now: EARLY, includeUnavailable: true,
    });
    expect(slots[0]?.capacity).toBe(3);
  });
});

describe('ranges and next available', () => {
  it('returns one entry per day, in order, dated on the pharmacy clock', () => {
    const range = generateSlotsForRange({
      windows: [window()], bookings: [], from: TUESDAY, days: 7, now: EARLY,
    });
    expect(range).toHaveLength(7);
    expect(range[0]?.date).toBe('2026-09-01');
    expect(range[6]?.date).toBe('2026-09-07');
  });

  it('does not skip or repeat a day across a clock change', () => {
    // The Isle of Man returns to GMT on 25 October 2026.
    const range = generateSlotsForRange({
      windows: [window()], bookings: [], from: iom('2026-10-23'), days: 5,
      now: iom('2026-10-23', '06:00'),
    });
    expect(range.map((d) => d.date)).toEqual([
      '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27',
    ]);
  });

  it('only has slots on the days the window covers', () => {
    const range = generateSlotsForRange({
      windows: [window()], bookings: [], from: TUESDAY, days: 7, now: EARLY,
    });
    expect(range.filter((d) => d.slots.length > 0)).toHaveLength(1);
  });

  it('finds the next free slot across days', () => {
    const next = nextAvailableSlot({
      windows: [window()], bookings: [], from: WEDNESDAY, now: EARLY,
    });
    expect(next).not.toBeNull();
    expect(localDateKey(next!.startsAt)).toBe('2026-09-08');
  });

  it('returns null when nothing is available in the search period', () => {
    const next = nextAvailableSlot({
      windows: [window({ weekday: 0 })], bookings: [], from: TUESDAY, now: EARLY, searchDays: 3,
    });
    expect(next).toBeNull();
  });
});

describe('the check that actually prevents a double booking', () => {
  const startsAt = iom('2026-09-01', '09:00');

  it('accepts a genuinely free slot', () => {
    expect(isSlotBookable({
      windows: [window()], bookings: [], startsAt, branchId: BRANCH, now: EARLY,
    })).toEqual({ ok: true });
  });

  it('refuses a slot somebody took a moment ago, and says so plainly', () => {
    const result = isSlotBookable({
      windows: [window()], bookings: [booking('09:00')], startsAt, branchId: BRANCH, now: EARLY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('just took');
  });

  it('refuses a time the branch does not offer', () => {
    const result = isSlotBookable({
      windows: [window()], bookings: [],
      startsAt: iom('2026-09-01', '15:00'), branchId: BRANCH, now: EARLY,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a slot in the past', () => {
    const result = isSlotBookable({
      windows: [window()], bookings: [], startsAt,
      branchId: BRANCH, now: iom('2026-09-01', '11:00'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('passed');
  });
});

describe('supporting bits', () => {
  it('detects overlapping ranges', () => {
    const a = { startsAt: iom('2026-09-01', '09:00'), endsAt: iom('2026-09-01', '09:15') };
    const b = { startsAt: iom('2026-09-01', '09:10'), endsAt: iom('2026-09-01', '09:25') };
    const c = { startsAt: iom('2026-09-01', '09:15'), endsAt: iom('2026-09-01', '09:30') };
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(a, c)).toBe(false); // touching, not overlapping
  });

  it('builds a reference that is stable and readable', () => {
    const ref = buildAppointmentReference('ONC', 'abc-123');
    expect(ref).toMatch(/^ONC-[A-Z2-9]{5}$/);
    expect(buildAppointmentReference('ONC', 'abc-123')).toBe(ref);
  });

  it('avoids characters that are misread aloud', () => {
    const ref = buildAppointmentReference('KMI', 'some-uuid-value');
    expect(ref.slice(4)).not.toMatch(/[OI01]/);
  });
});

describe('breaks and closures — §12', () => {
  const WINDOW = {
    id: 'w1', branchId: 'b1', serviceId: null,
    weekday: 4, // Thursday
    startMinute: 9 * 60, endMinute: 17 * 60,
    slotMinutes: 30, capacity: 1,
  };
  // Thursday 27 August 2026, midday, so the local date is unambiguous.
  const DAY = new Date('2026-08-27T12:00:00Z');
  const PAST = new Date('2026-08-01T00:00:00Z');

  function slotsWith(extra: Record<string, unknown> = {}) {
    return generateSlots({
      windows: [WINDOW], bookings: [], day: DAY, branchId: 'b1',
      now: PAST, ...extra,
    });
  }

  it('gives a full day when nothing blocks it', () => {
    expect(slotsWith()).toHaveLength(16);
  });

  it('removes the slots a lunch break covers', () => {
    const slots = slotsWith({
      breaks: [{
        branchId: 'b1', serviceId: null, weekday: 4,
        startMinute: 13 * 60, endMinute: 14 * 60,
      }],
    });
    // Two half-hour slots disappear.
    expect(slots).toHaveLength(14);
    expect(slots.some((s) => localTimeOf(s.startsAt) === '13:00')).toBe(false);
    expect(slots.some((s) => localTimeOf(s.startsAt) === '14:00')).toBe(true);
  });

  it('splits the day rather than truncating it', () => {
    // The reason breaks remove slots instead of shortening the window: a
    // shortened window would drop the whole afternoon.
    const slots = slotsWith({
      breaks: [{
        branchId: 'b1', serviceId: null, weekday: 4,
        startMinute: 13 * 60, endMinute: 14 * 60,
      }],
    });
    expect(slots.some((s) => localTimeOf(s.startsAt) === '09:00')).toBe(true);
    expect(slots.some((s) => localTimeOf(s.startsAt) === '16:30')).toBe(true);
  });

  it('excludes a slot that is only partly covered', () => {
    // Half a slot is not a bookable appointment.
    const slots = slotsWith({
      breaks: [{
        branchId: 'b1', serviceId: null, weekday: 4,
        startMinute: 13 * 60 + 15, endMinute: 13 * 60 + 25,
      }],
    });
    expect(slots.some((s) => localTimeOf(s.startsAt) === '13:00')).toBe(false);
  });

  it('ignores a break on another weekday', () => {
    expect(slotsWith({
      breaks: [{
        branchId: 'b1', serviceId: null, weekday: 1,
        startMinute: 13 * 60, endMinute: 14 * 60,
      }],
    })).toHaveLength(16);
  });

  it('closes the whole day when both minutes are null', () => {
    // The bank holiday case. Getting it wrong means somebody books on
    // Christmas Day and turns up to a locked door.
    expect(slotsWith({
      closures: [{ branchId: 'b1', closedOn: '2026-08-27', startMinute: null, endMinute: null }],
    })).toHaveLength(0);
  });

  it('closes every branch when the closure names none', () => {
    expect(slotsWith({
      closures: [{ branchId: null, closedOn: '2026-08-27', startMinute: null, endMinute: null }],
    })).toHaveLength(0);
  });

  it('closes only part of a day when given minutes', () => {
    const slots = slotsWith({
      closures: [{
        branchId: 'b1', closedOn: '2026-08-27',
        startMinute: 15 * 60, endMinute: 17 * 60,
      }],
    });
    expect(slots).toHaveLength(12);
    expect(slots.some((s) => localTimeOf(s.startsAt) === '15:00')).toBe(false);
  });

  it('ignores a closure on a different date', () => {
    expect(slotsWith({
      closures: [{ branchId: 'b1', closedOn: '2026-08-28', startMinute: null, endMinute: null }],
    })).toHaveLength(16);
  });

  it('ignores a closure at another branch', () => {
    expect(slotsWith({
      closures: [{ branchId: 'b2', closedOn: '2026-08-27', startMinute: null, endMinute: null }],
    })).toHaveLength(16);
  });
});

/** The pharmacy's clock, not the runner's. */
function localTimeOf(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Isle_of_Man',
  }).format(date);
}
