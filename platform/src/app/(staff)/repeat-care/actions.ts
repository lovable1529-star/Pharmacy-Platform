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

import { and, desc, eq } from 'drizzle-orm';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { action } from '@/lib/actions';
import {
  submission, reviewEvent, service, patient, clinician, clinicalContactEvent,
  ruleEvaluation, repeatEnrolment,
} from '@/lib/db/schema';
import { db } from '@/lib/db/client';
import { requestPayment } from '@/lib/payments/lifecycle';
import { changeSubmissionStatus } from '@/lib/workflow/history';
import { measurementsUsable } from '@/lib/clinical/plausibility';
import { siValue } from '@/lib/forms/present';
import { raisePrescription } from '@/lib/prescriptions/issue';
import { registerDocument } from '@/lib/documents/register';
import { approvalBlocker } from '@/lib/prescriptions/approval';
import { issuePrescriptionWithoutPayment } from '@/lib/fulfilment/create';
import {
  newPatientApprovalBlockers, type VerificationCall,
} from '@/lib/clinical/new-patient-gate';
import {
  repeatAuthorisationBlockers, type RepeatOutcome,
} from '@/lib/clinical/repeat-gate';
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
  /**
   * What the prescriber is authorising, which is not necessarily what the
   * patient asked for. Supplying `answers.requestedMedicine` regardless meant
   * a dose changed during the call was silently ignored.
   */
  authorised?: {
    medicine: string | null;
    strength: string | null;
    quantity: string | null;
    directions: string | null;
  } | null;
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
          derived: submission.derived,
          serviceKind: service.kind,
          serviceId: submission.serviceId,
        })
        .from(submission)
        .innerJoin(service, eq(submission.serviceId, service.id))
        .where(
          and(
            eq(submission.id, input.submissionId),
            eq(submission.organisationId, actor.organisationId),
          ),
        )
        .limit(1);

      if (!subject) throw new CannotApproveError('That request no longer exists.');

      const answers = (subject.answers ?? {}) as Record<string, unknown>;

      /*
       * A remote NEW patient carries extra requirements: the pharmacist must
       * have spoken to them and confirmed who they are, and must record what
       * they are actually authorising. A repeat request does not - the client
       * is explicit that a routine GREEN should not need a telephone call.
       *
       * Keyed on service kind rather than slug, because the pharmacy renames
       * its own services and a rename must not switch off a safety gate.
       */
      if (subject.serviceKind === 'CONSULTATION') {
        const calls = await tx
          .select({
            outcome: clinicalContactEvent.outcome,
            identityVerified: clinicalContactEvent.identityVerified,
            completedAt: clinicalContactEvent.completedAt,
          })
          .from(clinicalContactEvent)
          .where(
            and(
              eq(clinicalContactEvent.submissionId, input.submissionId),
              eq(clinicalContactEvent.organisationId, actor.organisationId),
            ),
          );

        const blockers = newPatientApprovalBlockers({
          patientId: subject.patientId,
          branchId: subject.branchId,
          answers,
          calls: calls as VerificationCall[],
          authorised: input.authorised ?? null,
        });

        if (blockers.length > 0) throw new CannotApproveError(blockers.join(' '));
      } else {
        const blocker = approvalBlocker({
          patientId: subject.patientId,
          branchId: subject.branchId,
          answers,
        });

        if (blocker) throw new CannotApproveError(blocker);

        /*
         * A repeat carries its own rules, and they are not the same as a new
         * patient's. GREEN is a fast-track authorisation with no call; AMBER
         * needs the pharmacist's reasoning written down; RED cannot be
         * supplied from here at all.
         *
         * The outcome is read from the stored evaluation rather than from what
         * the browser sent, because the browser is where an override would be
         * attempted.
         */
        if (subject.serviceKind === 'REPEAT_SUPPLY') {
          const [evaluation] = await tx
            .select({ outcome: ruleEvaluation.outcome })
            .from(ruleEvaluation)
            .where(eq(ruleEvaluation.submissionId, input.submissionId))
            .orderBy(desc(ruleEvaluation.evaluatedAt))
            .limit(1);

          const [enrolment] = subject.patientId
            ? await tx
              .select({ status: repeatEnrolment.status })
              .from(repeatEnrolment)
              .where(
                and(
                  eq(repeatEnrolment.patientId, subject.patientId),
                  eq(repeatEnrolment.serviceId, subject.serviceId),
                ),
              )
              .limit(1)
            : [];

          /*
           * Whether the engine was working from figures a person could have.
           *
           * Read from the stored derived values rather than recomputed, so this
           * asks what the evaluation actually saw. A null BMI beside a height
           * and a weight that were both answered means calculateBmi refused
           * them — see lib/clinical/plausibility.
           */
          const derivedValues = (subject.derived ?? {}) as Record<string, unknown>;

          const blockers = repeatAuthorisationBlockers({
            outcome: (evaluation?.outcome ?? null) as RepeatOutcome,
            enrolmentStatus: enrolment?.status ?? null,
            note: input.note,
            calls: [],
            measurementsUsable: measurementsUsable(
              siValue(answers, 'height'),
              siValue(answers, 'weight'),
              typeof derivedValues.bmi === 'number' ? derivedValues.bmi : null,
            ),
          });

          if (blockers.length > 0) throw new CannotApproveError(blockers.join(' '));
        }
      }
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

        /*
         * The prescriber's decision wins over the patient's request.
         *
         * This read `answers.requestedMedicine` and the patient's own supply
         * quantity, so a pharmacist who reduced the dose on the telephone
         * still supplied the strength originally asked for. Where an
         * authorisation was recorded it is used; where it was not - a repeat,
         * which does not require one - the request stands as before.
         */
        const authorised = input.authorised ?? null;
        const authorisedValue = authorised?.medicine && authorised.strength
          ? `${authorised.medicine.trim().toLowerCase()}_${authorised.strength.trim()}`
          : null;

        await raisePrescription(tx, {
          organisationId: actor.organisationId,
          submissionId: input.submissionId,
          patientId: context.patientId,
          branchId: context.branchId,
          clinicianId: signer?.id ?? null,
          requestedMedicineValue:
            authorisedValue
            ?? (typeof answers.requestedMedicine === 'string' ? answers.requestedMedicine : null),
          quantity: authorised?.quantity?.trim()
            || (typeof answers.supplyQuantity === 'string'
              ? `${answers.supplyQuantity} month(s)` : null),
          // Was never passed. `raisePrescription` has always accepted it, so a
          // prescriber typed the directions, the field was stored on the
          // authorisation, and the prescription came out with none — which is
          // the one part of it the patient actually follows.
          directions: authorised?.directions?.trim() || null,
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
 *
 * NO LINK IS SENT. Approval raises the charge and moves the request to
 * awaiting payment; a member of staff then confirms the money arrived. There
 * is no payment provider integrated in this phase, so emailing a patient a
 * link to a page that cannot take a payment would be worse than sending
 * nothing at all. The token, the page and the provider abstraction all remain
 * — this is switched off, not deleted — and when a provider is live the same
 * `settlePayment` releases the prescription either way.
 */
async function raisePendingPayment(submissionId: string): Promise<string | null> {
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

    if (!row) return null;

    /*
     * No price means nothing to collect, not nothing to do.
     *
     * This returned null and stopped, which left the prescription sitting at
     * PENDING_PAYMENT with no payment to settle it — forever, and with nothing
     * on screen saying why. Both Weight Management services currently have no
     * price set, so every approval produced a prescription that could never be
     * issued.
     *
     * Where there is genuinely nothing to charge — an NHS-funded service, or a
     * price the pharmacy has not configured yet — the supply proceeds. It is
     * issued here rather than by a payment that will never arrive.
     */
    if (!row.priceMinor || row.priceMinor <= 0) {
      await db.transaction(async (tx) => {
        await issuePrescriptionWithoutPayment(tx, {
          organisationId: row.organisationId,
          submissionId,
        });
      });
      return null;
    }

    const requested = await requestPayment({
      organisationId: row.organisationId,
      submissionId,
      patientId: row.patientId,
      branchId: row.branchId,
      amountMinor: row.priceMinor,
      description: row.serviceName,
      email: row.email,
      // Deliberate and explicit. The default is already false; saying so here
      // means a future reader sees a decision rather than an omission.
      notifyPatient: false,
    });

    return requested?.id ?? null;
  } catch (error) {
    console.error('raisePendingPayment failed', error);
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

    /*
     * Approval raises the charge; it does not collect it and does not tell the
     * patient how to pay. His original flow had a link sent here, and that
     * returns when a provider is integrated — for now the request moves to
     * awaiting payment and a member of staff confirms receipt on the payments
     * screen, which is what releases the prescription.
     *
     * Best effort: a clinical decision that saved must never be reported as
     * failed because raising a charge did not.
     */
    let paymentId: string | null = null;

    if (input.decision === 'APPROVED') {
      paymentId = await raisePendingPayment(input.submissionId);
    }

    revalidateStaffViews();
    return { ok: true as const, ...result, paymentId };
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
