/**
 * Who is due a repeat, and who has quietly stopped.
 *
 * The platform has so far waited for patients to come back. Every enrolment
 * carries the date it was last supplied and nothing reads it except one
 * patient's own record, so nobody can ask the two questions that actually
 * matter to a weight-management clinic: who needs supplying this week, and who
 * ran out a month ago and has not been heard from.
 *
 * The second is the one that costs. A GLP-1 patient who lapses is not a patient
 * who decided to stop — they usually just drifted, and nobody noticed because
 * nothing was looking. That is lost continuity of care as much as lost income.
 *
 * Everything here is pure. `now` is passed in rather than read, because a
 * function that decides whether somebody has lapsed must be testable at a
 * chosen date.
 */

export type DueState =
  /** Still covered by the last supply. */
  | 'COVERED'
  /** Runs out within the next week. */
  | 'DUE_SOON'
  /** Should have re-ordered by now. */
  | 'DUE'
  /** Well past — nobody has heard from them. */
  | 'LAPSED'
  /** Enrolled but never supplied through us. */
  | 'NEVER_SUPPLIED';

/** How long we treat one supply as lasting when the answer is missing. */
export const DEFAULT_SUPPLY_WEEKS = 4;

/** Past due by this much and it stops being a reminder and becomes a lapse. */
export const LAPSED_AFTER_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * How many weeks the last supply covers.
 *
 * Read from the request rather than stored on the enrolment, because nothing
 * records it there — the fulfilment row says what happened to the box, not how
 * many pens were in it. Both questionnaires ask, under different ids: the
 * repeat form as `supplyQuantity`, the new-patient form as `supplyDuration`.
 * Each answers in PENS, one pen being four weekly doses.
 *
 * Falls back to four weeks rather than refusing to answer. A missing answer
 * should not remove somebody from the list — an approximately-due patient is
 * far more useful than an invisible one.
 */
export function supplyWeeks(answers: Record<string, unknown> | null | undefined): number {
  const raw = answers?.supplyQuantity ?? answers?.supplyDuration;
  const pens = Number(raw);

  if (!Number.isFinite(pens) || pens < 1) return DEFAULT_SUPPLY_WEEKS;

  // Guarded rather than trusted: a mistyped quantity should not push somebody
  // a year into the future and out of every list that would have caught it.
  return Math.min(pens, 6) * 4;
}

/** When the last supply runs out. Null when there has never been one. */
export function runsOutOn(
  lastSuppliedAt: Date | null | undefined,
  weeks: number,
): Date | null {
  if (!lastSuppliedAt) return null;
  return new Date(lastSuppliedAt.getTime() + weeks * 7 * DAY_MS);
}

/** Whole days from `now` until the supply runs out. Negative once overdue. */
export function daysUntilDue(runsOut: Date | null, now: Date): number | null {
  if (!runsOut) return null;
  return Math.round((runsOut.getTime() - now.getTime()) / DAY_MS);
}

export function dueState(runsOut: Date | null, now: Date): DueState {
  if (!runsOut) return 'NEVER_SUPPLIED';

  const days = daysUntilDue(runsOut, now)!;

  if (days > 7) return 'COVERED';
  if (days >= 0) return 'DUE_SOON';
  if (days >= -LAPSED_AFTER_DAYS) return 'DUE';
  return 'LAPSED';
}

export interface DueEnrolment {
  patientId: string;
  patientName: string;
  externalRef: string | null;
  medicine: string | null;
  strength: string | null;
  lastSuppliedAt: Date | null;
  /** The answers on their most recent request, for the supply length. */
  lastAnswers: Record<string, unknown> | null;
  /** True when they already have a request in the queue — do not chase them. */
  hasOpenRequest: boolean;
}

export interface DueRow extends DueEnrolment {
  runsOut: Date | null;
  daysUntil: number | null;
  state: DueState;
}

/**
 * The list, ordered by who has been waiting longest.
 *
 * Patients with a request already in the queue are excluded rather than shown
 * greyed out. This is a list of people to CHASE, and somebody who has already
 * come back does not belong on it — leaving them there means a pharmacist rings
 * a patient whose request is sitting three feet away awaiting a decision.
 */
export function dueList(enrolments: readonly DueEnrolment[], now: Date): DueRow[] {
  return enrolments
    .filter((e) => !e.hasOpenRequest)
    .map((e): DueRow => {
      const runsOut = runsOutOn(e.lastSuppliedAt, supplyWeeks(e.lastAnswers));
      return {
        ...e,
        runsOut,
        daysUntil: daysUntilDue(runsOut, now),
        state: dueState(runsOut, now),
      };
    })
    .filter((r) => r.state !== 'COVERED')
    .sort((a, b) => {
      // Never-supplied last: they are a different job from a lapse, and mixing
      // them in would put somebody who has never started above somebody who
      // ran out three weeks ago.
      if (a.state === 'NEVER_SUPPLIED' && b.state !== 'NEVER_SUPPLIED') return 1;
      if (b.state === 'NEVER_SUPPLIED' && a.state !== 'NEVER_SUPPLIED') return -1;
      return (a.daysUntil ?? 0) - (b.daysUntil ?? 0);
    });
}

export interface DueCounts {
  dueSoon: number;
  due: number;
  lapsed: number;
  neverSupplied: number;
  /** Everything worth acting on — what the dashboard counter shows. */
  total: number;
}

export function countDue(rows: readonly DueRow[]): DueCounts {
  const counts: DueCounts = { dueSoon: 0, due: 0, lapsed: 0, neverSupplied: 0, total: 0 };

  for (const row of rows) {
    if (row.state === 'DUE_SOON') counts.dueSoon += 1;
    else if (row.state === 'DUE') counts.due += 1;
    else if (row.state === 'LAPSED') counts.lapsed += 1;
    else if (row.state === 'NEVER_SUPPLIED') counts.neverSupplied += 1;
  }

  counts.total = counts.dueSoon + counts.due + counts.lapsed + counts.neverSupplied;
  return counts;
}

/** How long ago, in words a person would say out loud. */
export function describeDue(row: DueRow): string {
  if (row.state === 'NEVER_SUPPLIED') return 'Never supplied through us';

  const days = row.daysUntil!;
  if (days > 1) return `Runs out in ${days} days`;
  if (days === 1) return 'Runs out tomorrow';
  if (days === 0) return 'Runs out today';
  if (days === -1) return 'Ran out yesterday';

  const overdue = -days;
  if (overdue < 14) return `Ran out ${overdue} days ago`;

  const weeks = Math.floor(overdue / 7);
  return `Ran out ${weeks} weeks ago`;
}
