'use server';

/**
 * Payments from the pharmacy's side.
 *
 * Two things staff actually need: to see what is owed and what has been paid,
 * and to record money taken at the till — because his brief offers both, "pay
 * online, pay on collection in the pharmacy".
 *
 * Recording an in-person payment goes through exactly the same settlement as an
 * online one, so the prescription is issued and the receipts sent identically.
 * A second code path for cash would be a second place for the gate to be
 * forgotten.
 */

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { db } from '@/lib/db/client';
import { payment, patient, service, submission, branch } from '@/lib/db/schema';
import { getStaffContext } from '@/lib/auth/context';
import { settlePayment } from '@/lib/payments/lifecycle';

export interface PaymentRow {
  id: string;
  amountMinor: number;
  currency: string;
  description: string;
  status: string;
  provider: string;
  accessToken: string;
  createdAt: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
  patientName: string | null;
  serviceName: string | null;
  branchName: string | null;
}

export async function getPayments(status?: string): Promise<{
  ok: boolean;
  payments?: PaymentRow[];
  error?: string;
}> {
  try {
    const { actor } = await getStaffContext();

    const where = [eq(payment.organisationId, actor.organisationId)];
    if (status === 'PENDING' || status === 'PAID' || status === 'CANCELLED') {
      where.push(eq(payment.status, status));
    }

    const rows = await db
      .select({
        id: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        description: payment.description,
        status: payment.status,
        provider: payment.provider,
        accessToken: payment.accessToken,
        createdAt: payment.createdAt,
        paidAt: payment.paidAt,
        expiresAt: payment.expiresAt,
        firstName: patient.firstName,
        lastName: patient.lastName,
        serviceName: service.name,
        branchName: branch.name,
      })
      .from(payment)
      .leftJoin(patient, eq(payment.patientId, patient.id))
      .leftJoin(submission, eq(payment.submissionId, submission.id))
      .leftJoin(service, eq(submission.serviceId, service.id))
      .leftJoin(branch, eq(payment.branchId, branch.id))
      .where(and(...where))
      .orderBy(desc(payment.createdAt))
      .limit(200);

    return {
      ok: true,
      payments: rows.map((r) => ({
        id: r.id,
        amountMinor: r.amountMinor,
        currency: r.currency,
        description: r.description,
        status: r.status,
        provider: r.provider,
        accessToken: r.accessToken,
        createdAt: r.createdAt,
        paidAt: r.paidAt,
        expiresAt: r.expiresAt,
        patientName:
          r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
        serviceName: r.serviceName,
        branchName: r.branchName,
      })),
    };
  } catch (error) {
    console.error('getPayments failed', error);
    return { ok: false, error: 'Could not load payments.' };
  }
}

const takeAtTill = action<{ paymentId: string }>('reports:edit').handler(
  async (input, { tx, actor }) => {
    const [row] = await tx
      .select({ id: payment.id, status: payment.status })
      .from(payment)
      .where(
        and(
          eq(payment.id, input.paymentId),
          eq(payment.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!row) throw new Error('That payment no longer exists.');
    if (row.status !== 'PENDING') throw new Error('That payment is not open.');

    return {
      result: { id: row.id },
      audit: {
        action: 'payment.taken_in_person',
        entityType: 'payment',
        entityId: row.id,
      },
    };
  },
);

export async function recordInPersonPayment(paymentId: string) {
  try {
    await takeAtTill({ paymentId });

    // Same settlement as an online payment — one gate, one path.
    const result = await settlePayment({
      paymentId,
      provider: 'IN_PERSON',
      providerRef: 'counter',
    });

    if (!result.ok) return { ok: false as const, error: 'Could not record that payment.' };

    revalidatePath('/payments');
    return { ok: true as const };
  } catch (error) {
    console.error('recordInPersonPayment failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.name === 'AuthorisationError'
            ? 'You do not have permission to record payments.'
            : error.message
          : 'Could not record that payment.',
    };
  }
}

const cancel = action<{ paymentId: string }>('reports:edit').handler(
  async (input, { tx, actor }) => {
    const [cancelled] = await tx
      .update(payment)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(payment.id, input.paymentId),
          eq(payment.organisationId, actor.organisationId),
          eq(payment.status, 'PENDING'),
        ),
      )
      .returning({ id: payment.id });

    if (!cancelled) throw new Error('That payment is no longer open.');

    return {
      result: { id: cancelled.id },
      audit: {
        action: 'payment.cancelled',
        entityType: 'payment',
        entityId: cancelled.id,
      },
    };
  },
);

export async function cancelPayment(paymentId: string) {
  try {
    await cancel({ paymentId });
    revalidatePath('/payments');
    return { ok: true as const };
  } catch (error) {
    console.error('cancelPayment failed', error);
    return { ok: false as const, error: 'Could not cancel that payment.' };
  }
}
