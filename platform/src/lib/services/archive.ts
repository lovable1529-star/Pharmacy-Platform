/**
 * Withdrawing a service.
 *
 * ── Why nothing is deleted ───────────────────────────────────────────────
 *
 * Fourteen tables point at a service, and most of them are clinical: every
 * submission answered against it, every consultation, every prescription
 * raised from it, every patient enrolled in repeat care through it, and every
 * version of its questionnaire.
 *
 * A real delete is therefore either refused by the database or, if it were
 * made to cascade, destroys the record of care that was given. Neither is a
 * feature. "Delete this service" reads as tidying a list; what it would
 * actually mean is erasing the justification for medicine somebody already
 * took.
 *
 * So a service is ARCHIVED. It disappears from the list, its public form stops
 * accepting new requests, and it stops being offered anywhere a service is
 * chosen — while every record made through it stays exactly as it was, and
 * stays readable.
 *
 * ── Why work in progress blocks it ───────────────────────────────────────
 *
 * Archiving a service with requests still waiting would strand them: a patient
 * who submitted this morning would never be reviewed, and nobody would be told
 * why. Those have to be dealt with first — which is a decision for a
 * pharmacist, not something to sweep up automatically.
 */

export interface ServiceUsage {
  /** Requests still waiting on somebody: submitted, in review, info requested. */
  openSubmissions: number;
  /** Prescriptions raised but not yet supplied. */
  openPrescriptions: number;
  /** Patients who can currently order a repeat through this service. */
  activeEnrolments: number;
  /** Appointments booked in the future. */
  futureAppointments: number;
  /** Everything ever answered against it. Historical, never a blocker. */
  totalSubmissions: number;
}

export interface ArchiveVerdict {
  can: boolean;
  /** Why it cannot proceed. Empty when it can. */
  blockers: string[];
  /** True but worth saying out loud before they confirm. */
  consequences: string[];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Whether this service can be withdrawn, and what happens if it is.
 *
 * Blockers and consequences are deliberately separate. A blocker is work that
 * would be stranded; a consequence is something true that the person clicking
 * should know before they do. Presenting them as one list would let a real
 * obstacle hide among things that are merely worth mentioning.
 */
export function canArchiveService(usage: ServiceUsage): ArchiveVerdict {
  const blockers: string[] = [];
  const consequences: string[] = [];

  if (usage.openSubmissions > 0) {
    blockers.push(
      `${plural(usage.openSubmissions, 'request is', 'requests are')} still waiting for a `
      + 'decision. Approve, decline or defer them first — archiving would leave those '
      + 'patients waiting for a reply that never comes.',
    );
  }

  if (usage.openPrescriptions > 0) {
    blockers.push(
      `${plural(usage.openPrescriptions, 'prescription has', 'prescriptions have')} been `
      + 'raised but not yet supplied. Finish or cancel them first.',
    );
  }

  if (usage.futureAppointments > 0) {
    blockers.push(
      `${plural(usage.futureAppointments, 'appointment is', 'appointments are')} booked in `
      + 'the future. Cancel or move them first, so the patients are told.',
    );
  }

  /*
   * Enrolments do not block — a paused service with enrolled patients is a
   * legitimate thing to want — but they must be said, because the effect is
   * immediate and silent from the patient's side.
   */
  if (usage.activeEnrolments > 0) {
    consequences.push(
      `${plural(usage.activeEnrolments, 'patient is', 'patients are')} enrolled in repeat `
      + 'care through this service. They will no longer be able to order a repeat, and '
      + 'nothing will tell them why.',
    );
  }

  if (usage.totalSubmissions > 0) {
    consequences.push(
      `${plural(usage.totalSubmissions, 'form', 'forms')} answered against this service `
      + 'will be kept and stay readable. Archiving deletes nothing.',
    );
  }

  consequences.push('Its public link will stop accepting new requests immediately.');

  return { can: blockers.length === 0, blockers, consequences };
}
