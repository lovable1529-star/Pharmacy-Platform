'use server';

/**
 * Moving a supply along: recording the pack, getting it ready, and getting it
 * to the patient.
 *
 * Every move goes through `transitionProblem` first, so the reason a step is
 * refused is a sentence a pharmacist can act on rather than a database
 * exception. The database enforces the same rules regardless — a constraint is
 * what makes a rule true whoever writes the row; this is what makes it legible.
 */

import { and, eq } from 'drizzle-orm';
import { action, query } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { db } from '@/lib/db/client';
import { prescription, prescriptionFulfilment } from '@/lib/db/schema';
import {
  transitionProblem, availableTransitions,
  type FulfilmentStatus, type FulfilmentMethod, type FulfilmentState,
} from '@/lib/fulfilment/transitions';
import { enrolFromSupply } from '@/lib/fulfilment/create';

export interface FulfilmentRow extends FulfilmentState {
  id: string;
  prescriptionId: string;
  carrier: string | null;
  trackingNumber: string | null;
  readyAt: Date | null;
  dispatchedAt: Date | null;
  suppliedAt: Date | null;
  next: FulfilmentStatus[];
}

export async function getFulfilment(prescriptionId: string): Promise<FulfilmentRow | null> {
  const read = query<{ prescriptionId: string }>('consultations:view')
    .scopedTo(() => ({}))
    .handler(async (input, { actor }) => {
      const [row] = await db
        .select({
          id: prescriptionFulfilment.id,
          prescriptionId: prescriptionFulfilment.prescriptionId,
          method: prescriptionFulfilment.method,
          status: prescriptionFulfilment.status,
          batchNumber: prescriptionFulfilment.batchNumber,
          expiryDate: prescriptionFulfilment.expiryDate,
          deliveryAddressSnapshot: prescriptionFulfilment.deliveryAddressSnapshot,
          carrier: prescriptionFulfilment.carrier,
          trackingNumber: prescriptionFulfilment.trackingNumber,
          readyAt: prescriptionFulfilment.readyAt,
          dispatchedAt: prescriptionFulfilment.dispatchedAt,
          suppliedAt: prescriptionFulfilment.suppliedAt,
        })
        .from(prescriptionFulfilment)
        .where(
          and(
            eq(prescriptionFulfilment.prescriptionId, input.prescriptionId),
            eq(prescriptionFulfilment.organisationId, actor.organisationId),
          ),
        )
        .limit(1);

      if (!row) return null;

      const state = {
        ...row,
        method: row.method as FulfilmentMethod,
        status: row.status as FulfilmentStatus,
      };

      return { ...state, next: availableTransitions(state) } satisfies FulfilmentRow;
    });

  try {
    return await read({ prescriptionId });
  } catch (error) {
    console.error('getFulfilment failed', error);
    return null;
  }
}

export interface RecordPackInput {
  fulfilmentId: string;
  batchNumber: string;
  /** ISO `YYYY-MM-DD`. */
  expiryDate: string;
  branchId?: string | null;
  companyId?: string | null;
}

const recordPack = action<RecordPackInput>('consultations:edit')
  .scopedTo((input) => ({ branchId: input.branchId ?? null, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    const [updated] = await tx
      .update(prescriptionFulfilment)
      .set({
        batchNumber: input.batchNumber.trim(),
        expiryDate: input.expiryDate,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(prescriptionFulfilment.id, input.fulfilmentId),
          eq(prescriptionFulfilment.organisationId, actor.organisationId),
        ),
      )
      .returning({ id: prescriptionFulfilment.id });

    if (!updated) throw new Error('That supply record no longer exists.');

    return {
      result: { id: updated.id },
      audit: {
        action: 'fulfilment.batch_recorded',
        entityType: 'prescription_fulfilment',
        entityId: updated.id,
        after: { batchNumber: input.batchNumber.trim(), expiryDate: input.expiryDate },
      },
    };
  });

export async function recordPackDetails(input: RecordPackInput) {
  if (!input.batchNumber.trim()) {
    return { ok: false as const, error: 'A batch number is needed — it is what a recall is traced through.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) {
    return { ok: false as const, error: 'An expiry date is needed.' };
  }

  try {
    await recordPack(input);
    revalidateStaffViews();
    return { ok: true as const };
  } catch (error) {
    console.error('recordPackDetails failed', error);
    return { ok: false as const, error: 'Could not save those pack details.' };
  }
}

export interface AdvanceInput {
  fulfilmentId: string;
  to: FulfilmentStatus;
  carrier?: string | null;
  trackingNumber?: string | null;
  branchId?: string | null;
  companyId?: string | null;
}

const advance = action<AdvanceInput>('consultations:edit')
  .scopedTo((input) => ({ branchId: input.branchId ?? null, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    const [row] = await tx
      .select({
        id: prescriptionFulfilment.id,
        prescriptionId: prescriptionFulfilment.prescriptionId,
        method: prescriptionFulfilment.method,
        status: prescriptionFulfilment.status,
        batchNumber: prescriptionFulfilment.batchNumber,
        expiryDate: prescriptionFulfilment.expiryDate,
        deliveryAddressSnapshot: prescriptionFulfilment.deliveryAddressSnapshot,
      })
      .from(prescriptionFulfilment)
      .where(
        and(
          eq(prescriptionFulfilment.id, input.fulfilmentId),
          eq(prescriptionFulfilment.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!row) throw new Error('That supply record no longer exists.');

    const problem = transitionProblem(
      {
        method: row.method as FulfilmentMethod,
        status: row.status as FulfilmentStatus,
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate,
        deliveryAddressSnapshot: row.deliveryAddressSnapshot,
      },
      input.to,
    );

    if (problem) throw new Error(problem);

    const now = new Date();
    const supplied = input.to === 'SUPPLIED' || input.to === 'COLLECTED';

    /*
     * Carrier and tracking are only written when this move actually supplies
     * them. Setting them unconditionally would blank a tracking number
     * recorded at dispatch as soon as somebody marked the parcel delivered.
     */
    const carrier = input.carrier?.trim();
    const tracking = input.trackingNumber?.trim();

    await tx
      .update(prescriptionFulfilment)
      .set({
        status: input.to,
        carrier: carrier ? carrier : undefined,
        trackingNumber: tracking ? tracking : undefined,
        readyAt: input.to === 'READY' ? now : undefined,
        dispatchedAt: input.to === 'DISPATCHED' ? now : undefined,
        suppliedAt: supplied ? now : undefined,
        preparedBy: input.to === 'READY' ? actor.userId : undefined,
        dispatchedBy: input.to === 'DISPATCHED' ? actor.userId : undefined,
        suppliedBy: supplied ? actor.userId : undefined,
        updatedAt: now,
      })
      .where(eq(prescriptionFulfilment.id, row.id));

    /*
     * The medicine has actually reached the patient, so repeat care opens.
     *
     * This is the join the implementation plan was missing: a remote new
     * patient has no consultation to be enrolled from, so without this they
     * complete the whole journey and can never request a repeat.
     */
    let enrolment: Awaited<ReturnType<typeof enrolFromSupply>> = null;
    if (supplied) {
      enrolment = await enrolFromSupply(tx, {
        organisationId: actor.organisationId,
        prescriptionId: row.prescriptionId,
      });

      await tx
        .update(prescription)
        .set({ status: input.to === 'COLLECTED' ? 'COLLECTED' : 'DISPENSED', updatedAt: now })
        .where(eq(prescription.id, row.prescriptionId));
    }

    return {
      result: { enrolment },
      audit: {
        action: `fulfilment.${input.to.toLowerCase()}`,
        entityType: 'prescription_fulfilment',
        entityId: row.id,
        before: { status: row.status },
        after: { status: input.to, enrolmentCreated: enrolment?.created ?? false },
      },
    };
  });

export async function advanceFulfilment(input: AdvanceInput) {
  try {
    const result = await advance(input);
    revalidateStaffViews();
    return { ok: true as const, enrolment: result.enrolment };
  } catch (error) {
    console.error('advanceFulfilment failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to change this supply.'
          : error instanceof Error
            ? error.message
            : 'Could not update that supply.',
    };
  }
}
