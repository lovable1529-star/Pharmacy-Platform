/**
 * Building a calendar grid — §14.
 *
 * Every date here is worked out in the PHARMACY's timezone, not the server's.
 * That is the whole difficulty: a 09:00 appointment on the Isle of Man is
 * 08:00 UTC in summer, so grouping by the server's calendar day puts early
 * appointments on the wrong date for half the year — and the bug only appears
 * between midnight and 01:00 local, which is exactly when nobody is testing.
 *
 * The same class of mistake has already been fixed twice in this project, in
 * the slot generator and in `dayBounds`. Doing the arithmetic in one tested
 * place is what stops it happening a third time.
 */

import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { PHARMACY_TIMEZONE, localDateKey } from './slots';

export type CalendarScale = 'month' | 'week' | 'day';

export interface CalendarDay {
  /** `2026-08-30`, in pharmacy-local terms. */
  key: string;
  date: Date;
  dayOfMonth: number;
  /** False for the leading and trailing days a month grid borrows. */
  inScope: boolean;
  isToday: boolean;
}

/** Monday, because a pharmacy week starts when the doors open. */
const WEEK_STARTS_ON = 1;

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Midnight in the pharmacy's day, expressed as an instant. */
export function startOfLocalDay(date: Date): Date {
  return fromZonedTime(`${localDateKey(date)}T00:00:00.000`, PHARMACY_TIMEZONE);
}

export function addDays(date: Date, days: number): Date {
  const local = toZonedTime(date, PHARMACY_TIMEZONE);
  local.setDate(local.getDate() + days);
  return fromZonedTime(
    `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T00:00:00.000`,
    PHARMACY_TIMEZONE,
  );
}

export function addMonths(date: Date, months: number): Date {
  const local = toZonedTime(date, PHARMACY_TIMEZONE);
  const day = local.getDate();
  local.setDate(1);
  local.setMonth(local.getMonth() + months);

  // Clamp: adding a month to 31 January must not land in March.
  const lastDay = new Date(local.getFullYear(), local.getMonth() + 1, 0).getDate();
  local.setDate(Math.min(day, lastDay));

  return fromZonedTime(
    `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T00:00:00.000`,
    PHARMACY_TIMEZONE,
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The Monday on or before this date, in local terms. */
export function startOfLocalWeek(date: Date): Date {
  const local = toZonedTime(date, PHARMACY_TIMEZONE);
  const shift = (local.getDay() - WEEK_STARTS_ON + 7) % 7;
  return addDays(date, -shift);
}

/**
 * The range a view covers, and the days it draws.
 *
 * A month view draws whole weeks, so it reaches into the previous and next
 * month. Those days are real and may hold appointments — showing them empty
 * because the query stopped at the month boundary would be a calendar that
 * lies about a Monday.
 */
export function buildCalendar(
  scale: CalendarScale,
  anchor: Date,
  today = new Date(),
): { from: Date; to: Date; days: CalendarDay[] } {
  const todayKey = localDateKey(today);

  if (scale === 'day') {
    const start = startOfLocalDay(anchor);
    return {
      from: start,
      to: addDays(start, 1),
      days: [dayOf(start, true, todayKey)],
    };
  }

  if (scale === 'week') {
    const start = startOfLocalWeek(anchor);
    const days = Array.from({ length: 7 }, (_, i) => dayOf(addDays(start, i), true, todayKey));
    return { from: start, to: addDays(start, 7), days };
  }

  // Month: whole weeks covering the month, six rows so the grid never jumps
  // height between a 28-day February and a 31-day May that starts on a Sunday.
  const local = toZonedTime(anchor, PHARMACY_TIMEZONE);
  const monthIndex = local.getMonth();
  const firstOfMonth = fromZonedTime(
    `${local.getFullYear()}-${pad(monthIndex + 1)}-01T00:00:00.000`,
    PHARMACY_TIMEZONE,
  );
  const gridStart = startOfLocalWeek(firstOfMonth);

  const days = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const inScope = toZonedTime(date, PHARMACY_TIMEZONE).getMonth() === monthIndex;
    return dayOf(date, inScope, todayKey);
  });

  return { from: gridStart, to: addDays(gridStart, 42), days };
}

function dayOf(date: Date, inScope: boolean, todayKey: string): CalendarDay {
  const key = localDateKey(date);
  return {
    key,
    date,
    dayOfMonth: toZonedTime(date, PHARMACY_TIMEZONE).getDate(),
    inScope,
    isToday: key === todayKey,
  };
}

/** Group anything with a start time into pharmacy-local days. */
export function groupByLocalDay<T extends { startsAt: Date }>(
  items: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = localDateKey(item.startsAt);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }
  return map;
}

/** `09:00`, in the pharmacy's clock rather than the reader's. */
export function localTimeLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}

export function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}

export function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}
