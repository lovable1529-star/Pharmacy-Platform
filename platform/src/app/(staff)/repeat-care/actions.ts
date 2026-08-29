'use server';

/**
 * Review decisions.
 *
 * Each decision is a discrete, attributable, timestamped event rather than text
 * appended to a field. The legacy system accumulated everything into one blob,
 * which is how it ended up containing "bcuz the great vedant has approved it"
 * with no way to tell who wrote it or when.
 *
 * Approving an AMBER REQUIRES a note. His specification is explicit: "Pharmacist
 * must address amber alerts, and document why approved." That is enforced here
 * rather than asked for in the interface, so it cannot be skipped.
 */

import { and, eq } from 'drizzle-orm';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { action } from '@/lib/actions';
import { submission, reviewEvent, service, patient, clinician } from '@/lib/db/schema';
import { db } from '@/lib/db/client';
import { requestPayment } from '@/lib/payments/lifecycle';
import { changeSubmissionStatus } from '@/lib/workflow/history';
import { raisePrescription } from '@/lib/prescriptions/issue';
import { registerDocument } from '@/lib/documents/register';
import { approvalBlocker } from '@/lib/prescriptions/approval';
import { IllegalTransitionError } from '@/lib/workflow/status';

export type ReviewAction = 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';

/**
 * An approval that could not have been completed, refused before it starts.
 *
 * Approving raises a prescription, and `raisePrescription` needs a patient and
 * a branch. It was gated on `patientId && branchId` and simply did nothing when
 * either was absent — so the review event, the status change and the approval
 * document were all written, no prescription existed, and NOTHING said so. The
 * request left the queue looking dealt with.
 *
 * A half-completed approval is worse than a refused one. Refusing leaves the
 * request in the queue, where it is visible, and names what is missing.
 */
class CannotApproveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CannotApproveError';
  }
}

const STATUS_FOR: Record<ReviewAction, 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED'> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  INFO_REQUESTED: 'INFO_REQUESTED',
};

interface DecideInput {
  submissionId: string;
  decision: ReviewAction;
  note: string;
  /** Carried so the audit entry records where the decision was made. */
  branchId?: string | null;
  companyId?: string | null;
}

const decide = action<DecideInput>('repeat_care:edit')
  .scopedTo((input) => ({ branchId: input.branchId ?? null, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    /*
     * Checked before anything is written, and inside the transaction so the
     * row cannot change underneath the decision.
     */
    if (input.decision === 'APPROVED') {
      const [subject] = await tx
        .select({
          patientId: submission.patientId,
          branchId: submission.branchId,
          answers: submission.answers,
        })
        .from(submission)
        .where(
          and(
            eq(submission.id, input.submissionId),
            eq(submission.organisationId, actor.organisationId),
          ),
        )
        .limit(1);

      if (!subject) throw new CannotApproveError('That request no longer exists.');

      const blocker = approvalBlocker({
        patientId: subject.patientId,
        branchId: subject.branchId,
        answers: (subject.answers ?? {}) as Record<string, unknown>,
      });

      if (blocker) throw new CannotApproveError(blocker);
    }

    await tx.insert(reviewEvent).values({
      organisationId: actor.organisationId,
      submissionId: input.submissionId,
      userId: actor.userId,
      action: input.decision,
      note: input.note.trim() || null,
    });

    /*
     * The status moves through the workflow helper, never by writing the
     * column. That is what guarantees a history row exists for every decision
     * and that an illegal move — approving something already rejected, say —
     * fails here rather than quietly producing a record whose path cannot be
     * explained afterwards.
     */
    const moved = await changeSubmissionStatus(tx, {
      organisationId: actor.organisationId,
      submissionId: input.submissionId,
      to: STATUS_FOR[input.decision],
      by: { userId: actor.userId, label: actor.fullName },
      reason: input.note,
      branchId: input.branchId ?? null,
    });

    /*
     * §10 — an approval and a rejection are both records worth keeping.
     *
     * A rejection especially: the reason a supply was refused is the part
     * somebody comes back to months later, and until now it existed only as a
     * note on a review event nobody browses.
     */
    if (input.decision === 'APPROVED' || input.decision === 'REJECTED') {
      const [subject] = await tx
        .select({
          patientId: submission.patientId,
          firstName: patient.firstName,
          lastName: patient.lastName,
          serviceName: service.name,
        })
        .from(submission)
        .innerJoin(service, eq(submission.serviceId, service.id))
        .leftJoin(patient, eq(submission.patientId, patient.id))
        .where(eq(submission.id, input.submissionId))
        .limit(1);

      const who = subject?.firstName && subject.lastName
        ? `${subject.firstName} ${subject.lastName}`
        : 'Unmatched patient';

      await registerDocument(tx, {
        organisationId: actor.organisationId,
        category: input.decision === 'APPROVED' ? 'APPROVAL_RECORD' : 'REJECTION_RECORD',
        title: `${subject?.serviceName ?? 'Repeat request'} — ${who}`,
        storagePath: `/consultations/${input.submissionId}`,
        patientId: subject?.patientId ?? null,
        submissionId: input.submissionId,
        createdBy: actor.userId,
      });
    }

    /*
     * Approval raises the prescription — §8.7.
     *
     * Raised, not issued: the document and its number wait for the payment
     * condition. Allocating a number now would leave a gap in the sequence for
     * every request that is approved and then never paid for, which reads to
     * anyone auditing it later as a missing prescription.
     */
    if (input.decision === 'APPROVED') {
      const [context] = await tx
        .select({
          patientId: submission.patientId,
          branchId: submission.branchId,
          answers: submission.answers,
        })
        .from(submission)
        .where(eq(submission.id, input.submissionId))
        .limit(1);

      if (context?.patientId && context.branchId) {
        const answers = (context.answers ?? {}) as Record<string, unknown>;

        // The approving pharmacist's own registration, where the person
        // deciding is also on the register. A manager approving without one
        // leaves the signature blank rather than borrowing somebody else's.
        const [signer] = await tx
          .select({ id: clinician.id })
          .from(clinician)
          .where(
            and(
              eq(clinician.userId, actor.userId),
              eq(clinician.organisationId, actor.organisationId),
            ),
          )
          .limit(1);

        await raisePrescription(tx, {
          organisationId: actor.organisationId,
          submissionId: input.submissionId,
          patientId: context.patientId,
          branchId: context.branchId,
          clinicianId: signer?.id ?? null,
          requestedMedicineValue:
            typeof answers.requestedMedicine === 'string' ? answers.requestedMedicine : null,
          quantity: typeof answers.supplyQuantity === 'string'
            ? `${answers.supplyQuantity} month(s)` : null,
          paidOnline: answers.paymentPreference === 'online',
        });
      }
    }

    return {
      result: { status: moved.to },
      audit: {
        action: `submission.${input.decision.toLowerCase()}`,
        entityType: 'submission',
        entityId: input.submissionId,
        before: { status: moved.from },
        after: { status: moved.to, note: input.note.trim() || null },
      },
    };
  });

/**
 * Raise the invoice for an approved request.
 *
 * Priced from the service, because that is where the pharmacy maintains it. A
 * service with no price is not an error — plenty are NHS-funded — it simply
 * means nothing to collect and the supply proceeds straight away.
 */
async function requestPaymentForSubmission(submissionId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({
        organisationId: submission.organisationId,
        patientId: submission.patientId,
        branchId: submission.branchId,
        serviceName: service.name,
        priceMinor: service.priceMinor,
        email: patient.email,
      })
      .from(submission)
      .innerJoin(service, eq(submission.serviceId, service.id))
      .leftJoin(patient, eq(submission.patientId, patient.id))
      .where(eq(submission.id, submissionId))
      .limit(1);

    if (!row || !row.priceMinor || row.priceMinor <= 0) return null;

    const requested = await requestPayment({
      organisationId: row.organisationId,
      submissionId,
      patientId: row.patientId,
      branchId: row.branchId,
      amountMinor: row.priceMinor,
      description: row.serviceName,
      email: row.email,
    });

    return requested?.url ?? null;
  } catch (error) {
    console.error('requestPaymentForSubmission failed', error);
    return null;
  }
}

export async function reviewSubmission(input: DecideInput & { outcome?: string | null }) {
  // A pharmacist overriding an AMBER must say why. Enforced server-side so it
  // holds regardless of what the browser sent.
  if (input.decision === 'APPROVED' && input.outcome !== 'GREEN' && !input.note.trim()) {
    return {
      ok: false as const,
      error: 'Approving a flagged request needs a note explaining why. Please add one.',
    };
  }

  if (input.decision === 'REJECTED' && !input.note.trim()) {
    return {
      ok: false as const,
      error: 'A rejection needs a reason — the patient is sent it.',
    };
  }

  try {
    const result = await decide(input);

    // Approval is what triggers the payment request. His flow: "GREEN/approved
    // AMBER -> secure payment link sent. Rx generated after payment." Best
    // effort — a decision that saved must never be reported as failed because
    // an email was slow.
    let paymentUrl: string | null = null;

    if (input.decision === 'APPROVED') {
      paymentUrl = await requestPaymentForSubmission(input.submissionId);
    }

    revalidateStaffViews();
    return { ok: true as const, ...result, paymentUrl };
  } catch (error) {
    console.error('reviewSubmission failed', error);
    return {
      ok: false as const,
      error:
        error instanceof CannotApproveError
          ? error.message
          : error instanceof IllegalTransitionError
          ? `${error.message} Refresh — someone may have decided this already.`
          : error instanceof Error && error.name === 'AuthorisationError'
            ? 'You do not have permission to review repeat requests.'
            : 'Could not save that decision. Please try again.',
    };
  }
}
