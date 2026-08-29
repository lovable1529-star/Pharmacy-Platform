/**
 * Whether an approval can actually be completed.
 *
 * Approving a repeat request raises a prescription, and `raisePrescription`
 * needs a patient and a branch. It was gated on `patientId && branchId` and did
 * nothing at all when either was absent — so the review event, the status change
 * and the approval document were written, no prescription existed, and nothing
 * anywhere said so. The request left the queue looking dealt with.
 *
 * Refusing is better than half-completing: the request stays in the queue, where
 * somebody can see it, and the message names what is missing.
 *
 * Pure and separate from the action so it can be tested without a database —
 * and because a `'use server'` module may only export async functions.
 */

export interface ApprovalSubject {
  patientId: string | null;
  branchId: string | null;
  answers: Record<string, unknown>;
}

/**
 * Why this approval cannot proceed, or null if it can.
 *
 * The messages tell the pharmacist what to do, not what the system failed to
 * find — "match it to a patient first" rather than "patientId is null".
 */
export function approvalBlocker(subject: ApprovalSubject): string | null {
  /*
   * Always required, whatever the service. You cannot approve a clinical
   * request on behalf of somebody you have not identified, and every document
   * the approval produces is filed against the patient record.
   */
  if (!subject.patientId) {
    return 'This request is not linked to a patient record, so nothing can be supplied against '
      + 'it. Match it to a patient first — or ask them for their name and date of birth.';
  }

  /*
   * Branch is required only where a medicine is being supplied: prescription
   * numbers are allocated per branch, so "which branch" is part of the record
   * rather than a preference. A request naming no medicine — a vaccination
   * questionnaire, say — has no number to allocate.
   */
  const requested = subject.answers.requestedMedicine;
  const wantsMedicine = typeof requested === 'string' && requested.trim().length > 0;

  if (wantsMedicine && !subject.branchId) {
    return 'This request has no branch on it, so a prescription number cannot be allocated. '
      + 'Set the collection branch before approving.';
  }

  return null;
}
