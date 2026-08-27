/**
 * Slot generation.
 *
 * Availability is stored as recurring windows — "Tuesdays, 9am to 5pm, 15-minute
 * slots" — because that is the thing the pharmacy actually decides. Concrete
 * slots are derived on demand rather than materialised as rows, so changing
 * opening hours does not mean regenerating a table, and the table does not grow
 * forever into a future nobody has booked yet.
 *
 * Pure throughout: windows and existing bookings go in, slots come out. No
 * database, and the clock arrives as an argument so "is this slot in the past"
 * is testable rather than dependent on when the suite happens to run.
 *
 * One calendar serves every service. His GLP-1 specification requires
 * repeat-care appointments to share the vaccination calendar, so per-service
 * calendars were never an option — a window with no service attached is open to
 * all of them.
 */

import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * The pharmacy's own timezone.
 *
 * Availability is stored as wall-clock minutes — "Tuesdays, 9am" — and 9am means
 * 9am on the Isle of Man, not 9am wherever the server happens to be running.
 * Getting this wrong is invisible in development and produces a booking page
 * showing 04:30 to 12:15 for a pharmacy open 09:00 to 17:00.
 */
export const PHARMACY_TIMEZONE = 'Europe/Isle_of_Man';

export interface AvailabilityWindow {
  id: string;
  branchId: string;
  /** Null means the window is open to every service. */
  serviceId: string | null;
  /** 0 = Sunday, matching Date#getDay. */
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  capacity: number;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface ExistingBooking {
  startsAt: Date;
  endsAt: Date;
  branchId: string;
  /** Cancelled bookings free their slot again. */
  cancelled?: boolean;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  booked: number;
  available: boolean;
  /** Why it cannot be booked, when it cannot. */
  unavailableReason?: 'full' | 'past' | 'too-soon';
}

export function overlaps(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * The UTC instant for a wall-clock time on a given day, in the pharmacy's zone.
 *
 * `setHours` would use the SERVER's timezone, which is the bug this replaces.
 * Building an ISO local string and converting through the named zone also gets
 * British Summer Time right — the pharmacy opens at 9am in March and in July,
 * even though those are different UTC instants.
 */
function atMinutes(day: Date, minutes: number, timeZone: string): Date {
  const local = toZonedTime(day, timeZone);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const d = String(local.getDate()).padStart(2, '0');
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');

  return fromZonedTime(`${y}-${m}-${d}T${hh}:${mm}:00`, timeZone);
}

/** The weekday as the pharmacy sees it, not as the server does. */
function localWeekday(day: Date, timeZone: string): number {
  return toZonedTime(day, timeZone).getDay();
}

/** The calendar date as the pharmacy sees it — YYYY-MM-DD. */
export function localDateKey(day: Date, timeZone = PHARMACY_TIMEZONE): string {
  const local = toZonedTime(day, timeZone);
  return [
    local.getFullYear(),
    String(local.getMonth() + 1).padStart(2, '0'),
    String(local.getDate()).padStart(2, '0'),
  ].join('-');
}

function withinEffectiveDates(
  window: AvailabilityWindow,
  day: Date,
  timeZone: string,
): boolean {
  const key = localDateKey(day, timeZone);
  if (window.effectiveFrom && window.effectiveFrom > key) return false;
  if (window.effectiveTo && window.effectiveTo < key) return false;
  return true;
}

/** Windows that apply to a given day and service. */
export function windowsForDay(
  windows: AvailabilityWindow[],
  day: Date,
  options: { branchId?: string; serviceId?: string; timeZone?: string } = {},
): AvailabilityWindow[] {
  const timeZone = options.timeZone ?? PHARMACY_TIMEZONE;
  const weekday = localWeekday(day, timeZone);

  return windows.filter((w) => {
    if (w.weekday !== weekday) return false;
    if (options.branchId && w.branchId !== options.branchId) return false;
    // A null serviceId means "any service"; a set one must match.
    if (options.serviceId && w.serviceId !== null && w.serviceId !== options.serviceId) {
      return false;
    }
    return withinEffectiveDates(w, day, timeZone);
  });
}

export interface GenerateSlotsInput {
  windows: AvailabilityWindow[];
  bookings: ExistingBooking[];
  day: Date;
  branchId?: string;
  serviceId?: string;
  now?: Date;
  /** Minimum notice before a slot can be booked. */
  leadTimeMinutes?: number;
  /** Include slots that cannot be booked, flagged with a reason. */
  includeUnavailable?: boolean;
  /** Defaults to the pharmacy's own zone, which is almost always what you want. */
  timeZone?: string;
}

/**
 * Every slot for one day at one branch.
 *
 * Overlapping windows are merged by slot start, taking the greatest capacity —
 * otherwise a pharmacy that adds a second window covering the same hours ends
 * up with duplicate slots at the same time, which reads as a bug to whoever is
 * looking at the calendar.
 */
export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const {
    windows, bookings, day, branchId, serviceId,
    now = new Date(), leadTimeMinutes = 0, includeUnavailable = false,
    timeZone = PHARMACY_TIMEZONE,
  } = input;

  const applicable = windowsForDay(windows, day, { branchId, serviceId, timeZone });
  if (applicable.length === 0) return [];

  const live = bookings.filter(
    (b) => !b.cancelled && (!branchId || b.branchId === branchId),
  );

  const byStart = new Map<number, Slot>();

  for (const window of applicable) {
    if (window.slotMinutes <= 0) continue;

    for (
      let minute = window.startMinute;
      minute + window.slotMinutes <= window.endMinute;
      minute += window.slotMinutes
    ) {
      const startsAt = atMinutes(day, minute, timeZone);
      const endsAt = atMinutes(day, minute + window.slotMinutes, timeZone);
      const key = startsAt.getTime();

      const booked = live.filter((b) => overlaps(b, { startsAt, endsAt })).length;
      const existing = byStart.get(key);
      const capacity = Math.max(existing?.capacity ?? 0, window.capacity);

      let unavailableReason: Slot['unavailableReason'];
      if (startsAt <= now) unavailableReason = 'past';
      else if (startsAt.getTime() - now.getTime() < leadTimeMinutes * 60_000) {
        unavailableReason = 'too-soon';
      } else if (booked >= capacity) unavailableReason = 'full';

      byStart.set(key, {
        startsAt,
        endsAt,
        capacity,
        booked,
        available: unavailableReason === undefined,
        ...(unavailableReason ? { unavailableReason } : {}),
      });
    }
  }

  const slots = [...byStart.values()].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );

  return includeUnavailable ? slots : slots.filter((s) => s.available);
}

/** Slots across a range of days, keyed by ISO date. */
export function generateSlotsForRange(
  input: Omit<GenerateSlotsInput, 'day'> & { from: Date; days: number },
): { date: string; slots: Slot[] }[] {
  const { from, days, ...rest } = input;
  const timeZone = rest.timeZone ?? PHARMACY_TIMEZONE;
  const result: { date: string; slots: Slot[] }[] = [];

  // Walk the LOCAL calendar, not the UTC one.
  //
  // Advancing the instant by a day drifts across a daylight-saving boundary: on
  // the night the clocks go back, midnight-BST plus three days lands inside the
  // 25th again, so the range shows that date twice and loses the 27th. Stepping
  // the calendar date and re-anchoring at local midday avoids the boundary
  // entirely — midday is comfortably inside the day in every zone and season.
  const [startYear, startMonth, startDay] = localDateKey(from, timeZone)
    .split('-')
    .map(Number) as [number, number, number];

  for (let offset = 0; offset < days; offset += 1) {
    const calendar = new Date(Date.UTC(startYear, startMonth - 1, startDay + offset));
    const date = [
      calendar.getUTCFullYear(),
      String(calendar.getUTCMonth() + 1).padStart(2, '0'),
      String(calendar.getUTCDate()).padStart(2, '0'),
    ].join('-');

    const day = fromZonedTime(`${date}T12:00:00`, timeZone);

    result.push({ date, slots: generateSlots({ ...rest, day, timeZone }) });
  }

  return result;
}

export function nextAvailableSlot(
  input: Omit<GenerateSlotsInput, 'day'> & { from: Date; searchDays?: number },
): Slot | null {
  const { from, searchDays = 30, ...rest } = input;

  for (const day of generateSlotsForRange({ ...rest, from, days: searchDays })) {
    const first = day.slots.find((s) => s.available);
    if (first) return first;
  }
  return null;
}

/**
 * Final check before writing a booking.
 *
 * Slot lists are generated from a snapshot, so two people can be looking at the
 * same free slot at the same time. This runs inside the booking transaction
 * against freshly read bookings, which is what actually prevents a double
 * booking — the list on screen is only ever a hint.
 */
export function isSlotBookable(input: {
  windows: AvailabilityWindow[];
  bookings: ExistingBooking[];
  startsAt: Date;
  branchId: string;
  serviceId?: string;
  now?: Date;
  leadTimeMinutes?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { startsAt, now = new Date(), leadTimeMinutes = 0 } = input;

  const slots = generateSlots({
    windows: input.windows,
    bookings: input.bookings,
    day: startsAt,
    branchId: input.branchId,
    serviceId: input.serviceId,
    now,
    leadTimeMinutes,
    includeUnavailable: true,
  });

  const slot = slots.find((s) => s.startsAt.getTime() === startsAt.getTime());

  if (!slot) return { ok: false, reason: 'That time is not offered at this branch.' };
  if (slot.unavailableReason === 'past') {
    return { ok: false, reason: 'That time has already passed.' };
  }
  if (slot.unavailableReason === 'too-soon') {
    return { ok: false, reason: 'That appointment is too soon — please choose a later time.' };
  }
  if (slot.unavailableReason === 'full') {
    return { ok: false, reason: 'Somebody just took that slot. Please choose another.' };
  }

  return { ok: true };
}

/** e.g. ONC-4K7P2 — short enough to read out over the phone. */
export function buildAppointmentReference(branchCode: string, seed: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  let suffix = '';
  for (let i = 0; i < 5; i += 1) {
    suffix += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length) + 7;
  }

  return `${branchCode.toUpperCase()}-${suffix}`;
}

export function formatSlotTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Isle_of_Man',
  }).format(date);
}
