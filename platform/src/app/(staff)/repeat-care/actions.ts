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

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { submission, reviewEvent, service, patient } from '@/lib/db/schema';
import { db } from '@/lib/db/client';
import { requestPayment } from '@/lib/payments/lifecycle';

export type ReviewAction = 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';

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
    const [before] = await tx
      .select({ status: submission.status })
      .from(submission)
      .where(eq(submission.id, input.submissionId))
      .limit(1);

    if (!before) throw new Error('That request no longer exists.');

    await tx.insert(reviewEvent).values({
      organisationId: actor.organisationId,
      submissionId: input.submissionId,
      userId: actor.userId,
      action: input.decision,
      note: input.note.trim() || null,
    });

    const [after] = await tx
      .update(submission)
      .set({ status: STATUS_FOR[input.decision], updatedAt: new Date() })
      .where(eq(submission.id, input.submissionId))
      .returning({ status: submission.status });

    return {
      result: { status: after?.status ?? STATUS_FOR[input.decision] },
      audit: {
        action: `submission.${input.decision.toLowerCase()}`,
        entityType: 'submission',
        entityId: input.submissionId,
        before: { status: before.status },
        after: { status: after?.status, note: input.note.trim() || null },
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

    revalidatePath('/repeat-care');
    return { ok: true as const, ...result, paymentUrl };
  } catch (error) {
    console.error('reviewSubmission failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to review repeat requests.'
          : 'Could not save that decision. Please try again.',
    };
  }
}
