'use server';

/**
 * Completing a consultation.
 *
 * This is the moment a clinical event actually happens, so it does several
 * things atomically or none of them:
 *
 *   · records the consultation with the clinician's answers and declarations
 *   · writes a stock MOVEMENT and updates the cached level
 *   · marks the submission completed
 *   · writes the audit entry
 *
 * The stock movement is the part the legacy system never did — its Issued Items
 * table was empty, meaning inventory never decremented and the numbers on screen
 * were fiction. Here the movement is the truth and the level is a projection of
 * it, so the two can always be reconciled.
 */

import { eq, and, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import {
  consultation, submission, stockLevel, stockMovement, batch, appointment,
} from '@/lib/db/schema';

export interface CompleteConsultationInput {
  submissionId: string;
  patientId: string;
  serviceId: string;
  branchId: string;
  companyId: string;
  clinicianId: string;
  /** Null for services that do not administer a product. */
  batchId: string | null;
  identityVerified: boolean;
  declarationsAccepted: string[];
  /** Clinician-only answers plus the administration details. */
  clinicalData: Record<string, unknown>;
  notes: string | null;
}

const complete = action<CompleteConsultationInput>('consultations:add')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
  .handler(async (input, { tx, actor }) => {
    if (!input.identityVerified) {
      throw new Error('Patient identity must be verified before a consultation can be recorded.');
    }

    // Guard against supplying from a recalled or expired batch. Cheap to check,
    // and the kind of mistake that is very expensive to discover later.
    if (input.batchId) {
      const [b] = await tx
        .select({ recalledAt: batch.recalledAt, expiryDate: batch.expiryDate })
        .from(batch)
        .where(eq(batch.id, input.batchId))
        .limit(1);

      if (!b) throw new Error('That batch no longer exists.');
      if (b.recalledAt) throw new Error('That batch has been recalled and must not be administered.');
      if (new Date(b.expiryDate) < new Date()) {
        throw new Error('That batch has expired and must not be administered.');
      }
    }

    const now = new Date();

    const [created] = await tx
      .insert(consultation)
      .values({
        organisationId: actor.organisationId,
        companyId: input.companyId,
        branchId: input.branchId,
        patientId: input.patientId,
        serviceId: input.serviceId,
        submissionId: input.submissionId,
        clinicianId: input.clinicianId,
        batchId: input.batchId,
        status: 'COMPLETED',
        completedAt: now,
        identityVerified: true,
        declarationsAccepted: input.declarationsAccepted,
        clinicalData: input.clinicalData,
        notes: input.notes,
      })
      .returning();

    if (!created) throw new Error('Could not record the consultation.');

    // Stock: the movement is the truth, the level is a cached projection.
    if (input.batchId) {
      await tx.insert(stockMovement).values({
        organisationId: actor.organisationId,
        branchId: input.branchId,
        batchId: input.batchId,
        kind: 'ADMINISTRATION',
        quantity: -1,
        reason: `Consultation ${created.id}`,
        occurredAt: now,
      });

      await tx
        .update(stockLevel)
        .set({ quantity: sql`${stockLevel.quantity} - 1`, updatedAt: now })
        .where(
          and(
            eq(stockLevel.branchId, input.branchId),
            eq(stockLevel.batchId, input.batchId),
          ),
        );
    }

    await tx
      .update(submission)
      .set({ status: 'COMPLETED', updatedAt: now })
      .where(eq(submission.id, input.submissionId));

    // Close the loop back to the appointment.
    //
    // Without this the booking sat at ARRIVED forever: the consultation was
    // recorded, but the worklist never learned it had been, so the patient
    // stayed on the counter's screen as though still waiting.
    await tx
      .update(appointment)
      .set({
        consultationId: created.id,
        status: 'COMPLETED',
        patientId: input.patientId,
        updatedAt: now,
      })
      .where(eq(appointment.submissionId, input.submissionId));

    return {
      result: { consultationId: created.id },
      audit: {
        action: 'consultation.completed',
        entityType: 'consultation',
        entityId: created.id,
        after: {
          patientId: input.patientId,
          serviceId: input.serviceId,
          batchId: input.batchId,
          clinicianId: input.clinicianId,
        },
      },
    };
  });

export async function completeConsultation(input: CompleteConsultationInput) {
  try {
    const result = await complete(input);
    revalidatePath('/');
    revalidatePath('/consultations');
    revalidatePath('/appointments');
    revalidatePath('/patients');
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('completeConsultation failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.name === 'AuthorisationError'
            ? 'You do not have permission to record consultations at this branch.'
            : error.message
          : 'Could not record the consultation.',
    };
  }
}
