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
import { submission, reviewEvent } from '@/lib/db/schema';

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
    revalidatePath('/repeat-care');
    return { ok: true as const, ...result };
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
