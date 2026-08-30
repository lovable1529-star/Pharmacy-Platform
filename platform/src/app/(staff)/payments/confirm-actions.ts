'use server';

/**
 * Confirming that a payment has been received.
 *
 * There is no payment provider in this phase. The pharmacy takes the money
 * however it takes it, and a member of staff asserts here that it arrived —
 * which is why this writes `confirmed_by` alongside `paid_at`. The timestamp
 * is the event; the person is the accountability, and without one a "paid"
 * flag is an unsigned claim.
 *
 * It settles through the same `settlePayment()` a provider webhook will call.
 * Everything payment unlocks — approving the request, allocating the
 * prescription number, issuing the document — must happen identically however
 * the money was confirmed, and two settlement paths would drift the first time
 * one of them changed.
 */

import { and, eq } from 'drizzle-orm';
import { action } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { payment, submission } from '@/lib/db/schema';
import { settlePayment } from '@/lib/payments/lifecycle';
import { canConfirmPayment } from '@/lib/payments/confirm';

export interface ConfirmPaymentInput {
  paymentId: string;
  /** The tick itself. Absent, nothing happens. */
  acknowledged: boolean;
  note?: string | null;
  branchId?: string | null;
  companyId?: string | null;
}

/**
 * Reads and audits, but does not settle — settlement happens outside the
 * transaction so the tick, the approval and the prescription issue all run
 * through the one path a webhook will use.
 *
 * Guarded by `reports:edit`, matching the `takeAtTill` action beside it. That
 * key is a poor description of taking money, but there is no `payments`
 * resource in the permission matrix and inventing one here would guard this
 * action with a permission no role has been granted — which fails closed on
 * everybody, including the pharmacist who needs it. Adding the resource
 * properly means touching the matrix and every role, and is tracked separately.
 */
const check = action<ConfirmPaymentInput>('reports:edit')
  .scopedTo((input) => ({ branchId: input.branchId ?? null, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    const [row] = await tx
      .select({
        id: payment.id,
        status: payment.status,
        amountMinor: payment.amountMinor,
        submissionStatus: submission.status,
      })
      .from(payment)
      .leftJoin(submission, eq(payment.submissionId, submission.id))
      .where(
        and(
          eq(payment.id, input.paymentId),
          eq(payment.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!row) throw new Error('That payment no longer exists.');

    // The rules live in lib/payments/confirm.ts so they can be tested without
    // a database, and so the same verdict is reached wherever it is asked.
    const verdict = canConfirmPayment({
      status: row.status,
      submissionStatus: row.submissionStatus ?? null,
    });

    if (!verdict.can) throw new Error(verdict.reason);

    if (verdict.alreadySettled) {
      return {
        result: { alreadySettled: true, amountMinor: row.amountMinor, confirmedBy: actor.userId },
        audit: {
          action: 'payment.confirm_manual_noop',
          entityType: 'payment',
          entityId: input.paymentId,
          after: { status: row.status },
        },
      };
    }

    return {
      // Carried out so settlement, which runs outside this transaction, can
      // record WHO asserted the money arrived. That attribution is the whole
      // accountability of a manual confirmation.
      result: { alreadySettled: false, amountMinor: row.amountMinor, confirmedBy: actor.userId },
      audit: {
        action: 'payment.confirmed_manual',
        entityType: 'payment',
        entityId: input.paymentId,
        after: {
          amountMinor: row.amountMinor,
          confirmedBy: actor.userId,
          note: input.note?.trim() || null,
        },
      },
    };
  });

export async function confirmManualPayment(input: ConfirmPaymentInput) {
  if (!input.acknowledged) {
    return {
      ok: false as const,
      error: 'Tick the box to confirm the payment has actually been received.',
    };
  }

  try {
    const checked = await check(input);

    if (!checked.alreadySettled) {
      await settlePayment({
        paymentId: input.paymentId,
        provider: 'MANUAL',
        confirmedBy: checked.confirmedBy,
        confirmationNote: input.note ?? null,
      });
    }

    revalidateStaffViews();
    return {
      ok: true as const,
      alreadySettled: checked.alreadySettled,
      amountMinor: checked.amountMinor,
    };
  } catch (error) {
    console.error('confirmManualPayment failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to confirm payments.'
          : error instanceof Error
            ? error.message
            : 'Could not confirm that payment. Please try again.',
    };
  }
}
