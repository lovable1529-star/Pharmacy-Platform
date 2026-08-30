/**
 * Whether a payment may be confirmed as received.
 *
 * Pure, so it can be tested without a database, and separate from the action
 * because a `'use server'` module may export only async functions.
 *
 * Confirming is not bookkeeping — it is what approves the request, allocates
 * the prescription number and issues the document. It therefore has to be as
 * guarded as the clinical decision that preceded it.
 */

/** Statuses a request may hold and still have money taken against it. */
const PAYABLE = new Set(['SUBMITTED', 'IN_REVIEW', 'APPROVED']);

export interface PaymentSubject {
  status: string;
  /** The request it belongs to. Null for a payment raised on its own. */
  submissionStatus: string | null;
}

export type ConfirmVerdict =
  | { can: true; alreadySettled: boolean }
  | { can: false; reason: string };

export function canConfirmPayment(subject: PaymentSubject): ConfirmVerdict {
  /*
   * Already paid is not an error. Two people ticking the same box, or one
   * person double-clicking, must leave one payment and one prescription — so
   * this succeeds and settlement does nothing on the second pass, rather than
   * showing a failure for something that worked.
   */
  if (subject.status === 'PAID') return { can: true, alreadySettled: true };

  if (subject.status === 'CANCELLED') {
    return { can: false, reason: 'This payment was cancelled. Raise a new one if it is owed.' };
  }

  if (subject.status !== 'PENDING') {
    return { can: false, reason: `This payment is ${subject.status.toLowerCase()}.` };
  }

  /*
   * Money must not be taken for something nobody has authorised, and must not
   * be taken for something already refused. The clinical decision comes first;
   * payment releases the supply.
   */
  if (subject.submissionStatus !== null && !PAYABLE.has(subject.submissionStatus)) {
    const readable = subject.submissionStatus.toLowerCase().replace(/_/g, ' ');
    return {
      can: false,
      reason: `That request is ${readable}, so a payment against it cannot be confirmed.`,
    };
  }

  return { can: true, alreadySettled: false };
}
