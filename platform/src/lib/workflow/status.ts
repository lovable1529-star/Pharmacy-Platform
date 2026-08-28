/**
 * The submission lifecycle, as a state machine.
 *
 * The specification draws it explicitly:
 *
 *     DRAFT → PENDING → APPROVED
 *                     → REJECTED → RESUBMITTED → PENDING
 *
 * and adds two requirements that only a real machine can satisfy. Pending is
 * not merely an initial state — a pharmacist may deliberately push a reviewed
 * case back to it when more information is needed (§7.2). And a rejected case
 * may be corrected and resubmitted while the previous rejection is preserved
 * (§7.4).
 *
 * Until now status was a column that any caller could set to anything. Nothing
 * stopped a completed consultation returning to draft, or an approval being
 * written over a rejection with no trace of either. Declaring the legal moves
 * in one place means an illegal one fails loudly at the point it is attempted,
 * rather than quietly producing a record whose history cannot be explained.
 *
 * Our vocabulary is wider than the spec's four words because it was built
 * around the clinical flow: SUBMITTED and IN_REVIEW are both "pending" in the
 * spec's language, and INFO_REQUESTED is the state §6.2 calls "Request
 * Information". The mapping is written down in PLAIN_ENGLISH below so the two
 * documents can be read against each other.
 */

export const SUBMISSION_STATUSES = [
  'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED',
  'RESUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED',
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** How each of our states reads in the specification's own vocabulary. */
export const PLAIN_ENGLISH: Record<SubmissionStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Pending',
  IN_REVIEW: 'Pending — being reviewed',
  INFO_REQUESTED: 'Pending — more information needed',
  RESUBMITTED: 'Resubmitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

/**
 * Where each state may go next.
 *
 * Read it as the clinical pathway rather than as a graph: a patient's
 * questionnaire arrives, a pharmacist looks at it, and it either proceeds, goes
 * back for more, or stops.
 */
const TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  // Filling it in. Cancelled covers an abandoned draft being cleared.
  DRAFT: ['SUBMITTED', 'CANCELLED'],

  // Arrived and waiting. GREEN goes straight to approved without a human;
  // anything else waits for one.
  SUBMITTED: ['IN_REVIEW', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'CANCELLED'],

  // A pharmacist has it open.
  IN_REVIEW: ['APPROVED', 'REJECTED', 'INFO_REQUESTED', 'SUBMITTED', 'CANCELLED'],

  // Sent back to the patient. They answer, and it returns as resubmitted.
  INFO_REQUESTED: ['RESUBMITTED', 'CANCELLED', 'REJECTED'],

  // Back in the queue, carrying its history with it.
  RESUBMITTED: ['IN_REVIEW', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'CANCELLED'],

  // Approved. Completion follows supply; cancellation is still possible before
  // then, because a patient can change their mind after approval.
  APPROVED: ['COMPLETED', 'CANCELLED'],

  // A rejection is not the end: §7.4 requires that a corrected case can come
  // back, with the rejection preserved.
  REJECTED: ['RESUBMITTED', 'CANCELLED'],

  // Terminal.
  CANCELLED: [],
  COMPLETED: [],
};

export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: SubmissionStatus): readonly SubmissionStatus[] {
  return TRANSITIONS[from] ?? [];
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: SubmissionStatus,
    readonly to: SubmissionStatus,
  ) {
    super(
      `A ${PLAIN_ENGLISH[from].toLowerCase()} request cannot become ` +
      `${PLAIN_ENGLISH[to].toLowerCase()}.`,
    );
    this.name = 'IllegalTransitionError';
  }
}

/**
 * Throws unless the move is legal.
 *
 * Re-entering the same state is allowed and recorded: a pharmacist reopening a
 * case they already had open is not an error, and the history is more useful
 * for showing it happened.
 */
export function assertTransition(from: SubmissionStatus, to: SubmissionStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/**
 * Once approved, the answers are clinical history.
 *
 * §20: after approval the questionnaire must not be silently modified, and any
 * permitted correction has to create an audit event or a revision. These are
 * the states in which the answers are frozen.
 */
const LOCKED: readonly SubmissionStatus[] = ['APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'];

export function isLocked(status: SubmissionStatus): boolean {
  return LOCKED.includes(status);
}
