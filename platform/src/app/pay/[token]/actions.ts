'use server';

/**
 * Settling a demonstration payment.
 *
 * Public, like the questionnaire, because the patient has no account — the
 * token in their link is the credential. It is checked against the database on
 * every call and scoped to exactly one invoice, so holding it lets you settle
 * that one payment and nothing else.
 *
 * It refuses outright when a real payment provider is configured. Otherwise
 * adding Stripe keys would leave a public endpoint in place that marks invoices
 * paid without taking money, which is the kind of leftover that turns a demo
 * shortcut into a way to obtain medicine for free.
 */

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db/client';
import { payment } from '@/lib/db/schema';
import { isDemoMode } from '@/lib/payments/provider';
import { settlePayment } from '@/lib/payments/lifecycle';

export async function payDemo(
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isDemoMode()) {
    // Real provider configured. This path must be dead.
    return {
      ok: false,
      error: 'This payment must be completed through the card checkout.',
    };
  }

  if (!token) return { ok: false, error: 'That link is not valid.' };

  try {
    const [row] = await db
      .select({
        id: payment.id,
        status: payment.status,
        expiresAt: payment.expiresAt,
      })
      .from(payment)
      .where(eq(payment.accessToken, token))
      .limit(1);

    if (!row) return { ok: false, error: 'That link is not valid.' };
    if (row.status === 'PAID') return { ok: true };
    if (row.status !== 'PENDING') {
      return { ok: false, error: 'This request is no longer open.' };
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      return { ok: false, error: 'That link has expired. Please call the pharmacy.' };
    }

    const result = await settlePayment({
      paymentId: row.id,
      provider: 'DEMO',
      providerRef: 'demo-mode',
    });

    if (!result.ok) return { ok: false, error: result.error ?? 'Could not complete that.' };

    revalidatePath(`/pay/${token}`);
    return { ok: true };
  } catch (error) {
    console.error('payDemo failed', error);
    return { ok: false, error: 'Could not complete that. Please call the pharmacy.' };
  }
}
