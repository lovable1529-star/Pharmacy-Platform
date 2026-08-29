'use server';

/**
 * Dispensing and collection — §8.3 and §8.4.
 *
 * Two signatures, deliberately separate. The dispensing pharmacist is
 * confirming they reviewed the consultation and are happy to hand it over; the
 * person collecting is confirming they received it. Recording one as if it were
 * the other loses the distinction the pharmacy actually needs when a supply is
 * queried later.
 *
 * Each is unique per prescription at the database level. A second dispensing
 * signature on one supply would mean one of them describes something that did
 * not happen.
 */

import { and, eq } from 'drizzle-orm';
import { action } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import {
  prescription, clinician, dispensingSignoff, collectionSignoff,
} from '@/lib/db/schema';

export interface DispenseInput {
  prescriptionId: string;
  clinicianId: string;
  branchId: string;
  companyId?: string | null;
  /** §6.4 — did the question the patient raised actually get put to them? */
  patientSpokenTo: boolean;
  notes: string | null;
}

const dispense = action<DispenseInput>('consultations:edit')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    const [row] = await tx
      .select({ id: prescription.id, status: prescription.status })
      .from(prescription)
      .where(
        and(
          eq(prescription.id, input.prescriptionId),
          eq(prescription.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!row) throw new Error('That prescription no longer exists.');
    if (row.status === 'PENDING_PAYMENT') {
      throw new Error('This has not been issued yet — payment is still outstanding.');
    }
    if (row.status === 'CANCELLED') {
      throw new Error('This prescription was cancelled.');
    }

    const [signer] = await tx
      .select({ fullName: clinician.fullName, gphcNumber: clinician.gphcNumber })
      .from(clinician)
      .where(
        and(
          eq(clinician.id, input.clinicianId),
          eq(clinician.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!signer) throw new Error('That pharmacist is not on the register.');

    await tx.insert(dispensingSignoff).values({
      organisationId: actor.organisationId,
      prescriptionId: input.prescriptionId,
      clinicianId: input.clinicianId,
      clinicianNameSnapshot: signer.fullName,
      registrationNumberSnapshot: signer.gphcNumber,
      patientSpokenTo: input.patientSpokenTo,
      notes: input.notes?.trim() || null,
    });

    await tx
      .update(prescription)
      .set({ status: 'DISPENSED', updatedAt: new Date() })
      .where(eq(prescription.id, input.prescriptionId));

    return {
      result: { status: 'DISPENSED' as const },
      audit: {
        action: 'prescription.dispensed',
        entityType: 'prescription',
        entityId: input.prescriptionId,
        after: { by: signer.fullName, patientSpokenTo: input.patientSpokenTo },
      },
    };
  });

export interface CollectInput {
  prescriptionId: string;
  branchId: string;
  companyId?: string | null;
  collectedByName: string;
  isPatient: boolean;
}

const collect = action<CollectInput>('consultations:edit')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    const [row] = await tx
      .select({ id: prescription.id, status: prescription.status })
      .from(prescription)
      .where(
        and(
          eq(prescription.id, input.prescriptionId),
          eq(prescription.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!row) throw new Error('That prescription no longer exists.');
    if (row.status !== 'DISPENSED') {
      // Collection follows dispensing. Recording it the other way round would
      // say somebody took a supply nobody had checked.
      throw new Error('This has not been dispensed yet.');
    }

    await tx.insert(collectionSignoff).values({
      organisationId: actor.organisationId,
      prescriptionId: input.prescriptionId,
      collectedByName: input.collectedByName.trim(),
      isPatient: input.isPatient,
    });

    await tx
      .update(prescription)
      .set({ status: 'COLLECTED', updatedAt: new Date() })
      .where(eq(prescription.id, input.prescriptionId));

    return {
      result: { status: 'COLLECTED' as const },
      audit: {
        action: 'prescription.collected',
        entityType: 'prescription',
        entityId: input.prescriptionId,
        after: { by: input.collectedByName.trim(), isPatient: input.isPatient },
      },
    };
  });

function wrap<T>(run: () => Promise<T>, fallback: string) {
  return run().then(
    (result) => {
      revalidateStaffViews();
      return { ok: true as const, ...(result as object) };
    },
    (error: unknown) => {
      console.error(fallback, error);
      return {
        ok: false as const,
        error:
          error instanceof Error && error.name === 'AuthorisationError'
            ? 'You do not have permission to do that.'
            : error instanceof Error
              ? error.message
              : fallback,
      };
    },
  );
}

export async function dispensePrescription(input: DispenseInput) {
  return wrap(() => dispense(input), 'Could not record the dispensing.');
}

export async function collectPrescription(input: CollectInput) {
  if (!input.collectedByName.trim()) {
    return { ok: false as const, error: 'Enter the name of the person collecting.' };
  }
  return wrap(() => collect(input), 'Could not record the collection.');
}
