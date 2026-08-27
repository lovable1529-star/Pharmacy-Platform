/**
 * Scheduling.
 *
 * One calendar across every service and branch — the client's GLP-1 document
 * requires repeat-care appointments to share the vaccination calendar, so
 * per-service calendars were never an option.
 *
 * Slot generation is pure. Availability windows, existing bookings and the
 * requested date go in; bookable slots come out. No database, no clock beyond
 * what is passed in, which is what makes the edge cases testable — and slot
 * arithmetic is where booking systems usually break.
 */

export interface AvailabilityWindow {
  /** 0 = Sunday, matching JavaScript's getUTCDay(). */
  dayOfWeek: number;
  /** "09:00" — local wall-clock time at the branch. */
  startTime: string;
  endTime: string;
  slotMinutes: number;
  /** null means the window applies to every service. */
  serviceId?: string | null;
  resourceId?: string | null;
}

export interface ExistingBooking {
  startsAt: Date;
  endsAt: Date;
  resourceId?: string | null;
  status: string;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  resourceId?: string | null;
}

/** Bookings in these states no longer occupy their slot. */
const RELEASED_STATUSES = ['CANCELLED', 'NO_SHOW'];

function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return { hours, minutes };
}

function atTime(date: Date, time: { hours: number; minutes: number }): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    time.hours,
    time.minutes,
  ));
}

export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  // Touching intervals do not overlap: a 09:15 slot may start as 09:00–09:15 ends.
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Generates bookable slots for a single day.
 *
 * A slot is excluded when it collides with an active booking on the same
 * resource, when it falls before `notBefore` (no booking into the past, and no
 * booking twenty minutes from now if the service needs an hour's notice), or
 * when it would run past the end of its availability window.
 */
export function generateSlots(input: {
  date: Date;
  availability: AvailabilityWindow[];
  bookings: ExistingBooking[];
  serviceId?: string | null;
  durationMinutes?: number;
  notBefore?: Date;
}): Slot[] {
  const { date, availability, bookings, serviceId, notBefore } = input;

  const dayOfWeek = date.getUTCDay();
  const active = bookings.filter((b) => !RELEASED_STATUSES.includes(b.status));

  const windows = availability.filter(
    (w) => w.dayOfWeek === dayOfWeek && (!w.serviceId || !serviceId || w.serviceId === serviceId),
  );

  const slots: Slot[] = [];

  for (const window of windows) {
    const start = parseTime(window.startTime);
    const end = parseTime(window.endTime);
    if (!start || !end || window.slotMinutes <= 0) continue;

    const windowStart = atTime(date, start);
    const windowEnd = atTime(date, end);
    if (windowEnd <= windowStart) continue;

    const duration = input.durationMinutes ?? window.slotMinutes;
    let cursor = windowStart;

    while (cursor < windowEnd) {
      const slotEnd = new Date(cursor.getTime() + duration * 60_000);

      // A slot must fit entirely inside its window.
      if (slotEnd > windowEnd) break;

      const candidate: Slot = {
        startsAt: cursor,
        endsAt: slotEnd,
        resourceId: window.resourceId ?? null,
      };

      const inPast = notBefore ? candidate.startsAt < notBefore : false;

      const taken = active.some(
        (booking) =>
          overlaps(candidate, booking) &&
          (window.resourceId == null ||
            booking.resourceId == null ||
            booking.resourceId === window.resourceId),
      );

      if (!inPast && !taken) slots.push(candidate);

      cursor = new Date(cursor.getTime() + window.slotMinutes * 60_000);
    }
  }

  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Generates slots across a date range, for a "next available" view. */
export function generateSlotsForRange(input: {
  from: Date;
  days: number;
  availability: AvailabilityWindow[];
  bookings: ExistingBooking[];
  serviceId?: string | null;
  durationMinutes?: number;
  notBefore?: Date;
}): Map<string, Slot[]> {
  const byDate = new Map<string, Slot[]>();

  for (let offset = 0; offset < input.days; offset += 1) {
    const date = new Date(Date.UTC(
      input.from.getUTCFullYear(),
      input.from.getUTCMonth(),
      input.from.getUTCDate() + offset,
    ));

    const slots = generateSlots({ ...input, date });
    if (slots.length > 0) byDate.set(date.toISOString().slice(0, 10), slots);
  }
  return byDate;
}

export function nextAvailableSlot(input: Parameters<typeof generateSlotsForRange>[0]): Slot | null {
  for (const slots of generateSlotsForRange(input).values()) {
    if (slots[0]) return slots[0];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Walk-in queue
// ─────────────────────────────────────────────────────────────

export interface QueueEntry {
  id: string;
  patientName: string;
  serviceName: string;
  arrivedAt: Date;
  /** Set when someone must be seen ahead of the queue order. */
  priority?: boolean;
}

export interface QueuedEntry extends QueueEntry {
  position: number;
  waitingMinutes: number;
  /** Rough estimate from the queue ahead and mean consultation length. */
  estimatedWaitMinutes: number;
}

/**
 * Orders the walk-in queue and estimates waits.
 *
 * Priority entries come first, then arrival order. The estimate is deliberately
 * rough — the point is to give the person behind the counter something honest to
 * say, not to be accurate to the minute.
 */
export function buildQueue(
  entries: QueueEntry[],
  options: { averageConsultationMinutes?: number; activeClinicians?: number; now?: Date } = {},
): QueuedEntry[] {
  const {
    averageConsultationMinutes = 10,
    activeClinicians = 1,
    now = new Date(),
  } = options;

  const clinicians = Math.max(1, activeClinicians);

  return [...entries]
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      return a.arrivedAt.getTime() - b.arrivedAt.getTime();
    })
    .map((entry, index) => ({
      ...entry,
      position: index + 1,
      waitingMinutes: Math.floor((now.getTime() - entry.arrivedAt.getTime()) / 60_000),
      estimatedWaitMinutes: Math.round((index / clinicians) * averageConsultationMinutes),
    }));
}

/** Entries waiting longer than the threshold, for the dashboard. */
export function longWaits(queue: QueuedEntry[], thresholdMinutes = 20): QueuedEntry[] {
  return queue.filter((e) => e.waitingMinutes >= thresholdMinutes);
}
