/**
 * Raising and issuing a prescription — §8.
 *
 * The lifecycle §8.7 draws is: approved, then payment, and only once the
 * payment condition is satisfied does a prescription document exist. So the
 * record is raised at approval in PENDING_PAYMENT and moves to ISSUED when
 * payment is settled — or immediately, when the patient is paying on
 * collection and there is nothing to wait for.
 *
 * §8.1 keeps payment status independent of prescription status, and that is
 * not pedantry: "paid" and "issued" are different facts, and a patient paying
 * at the counter has a perfectly valid prescription that nobody has been paid
 * for yet.
 *
 * Everything about the medicine is snapshotted. A price list edited next
 * month, or a medicine renamed, must not change what a prescription issued
 * today says it was for.
 */

import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import {
  prescription, submission, service, clinician, medicine, medicineStrength,
} from '@/lib/db/schema';
import { allocatePrescriptionNumber } from '@/lib/pdf/numbering';
import { parseMedicineValue } from '@/lib/clinical/derived';
import type { DoseLadders } from '@/lib/clinical/derived';

export interface IssueInput {
  organisationId: string;
  submissionId: string;
  patientId: string;
  branchId: string;
  clinicianId?: string | null;
  /** `mounjaro_7.5mg`, as answered. */
  requestedMedicineValue?: string | null;
  quantity?: string | null;
  directions?: string | null;
  /** True when they paid online; false means payment is due on collection. */
  paidOnline: boolean;
  ladders?: DoseLadders;
}

/**
 * Raise the prescription for an approved request.
 *
 * Returns the existing one if there already is one. A pharmacist approving,
 * then re-approving after an amendment, must not produce two prescriptions for
 * one supply — the patient would be able to collect twice.
 */
export async function raisePrescription(
  tx: Tx,
  input: IssueInput,
): Promise<{ id: string; created: boolean } | null> {
  const [existing] = await tx
    .select({ id: prescription.id })
    .from(prescription)
    .where(eq(prescription.submissionId, input.submissionId))
    .limit(1);

  if (existing) return { id: existing.id, created: false };

  // What was actually requested, and what it costs.
  const [context] = await tx
    .select({
      serviceName: service.name,
      priceMinor: service.priceMinor,
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .where(eq(submission.id, input.submissionId))
    .limit(1);

  if (!context) return null;

  const parsed = input.requestedMedicineValue
    ? parseMedicineValue(input.requestedMedicineValue, input.ladders)
    : null;

  // Link to the master where we can, so reporting can group by medicine, but
  // the snapshot is what the document is printed from either way.
  let medicineId: string | null = null;
  if (parsed) {
    const [row] = await tx
      .select({ id: medicine.id })
      .from(medicine)
      .where(
        and(
          eq(medicine.organisationId, input.organisationId),
          eq(medicine.brand, parsed.medicine),
        ),
      )
      .limit(1);
    medicineId = row?.id ?? null;
  }

  let signer: { fullName: string; gphcNumber: string; signatureUrl: string | null } | null = null;
  if (input.clinicianId) {
    const [row] = await tx
      .select({
        fullName: clinician.fullName,
        gphcNumber: clinician.gphcNumber,
        signatureUrl: clinician.signatureUrl,
      })
      .from(clinician)
      .where(eq(clinician.id, input.clinicianId))
      .limit(1);
    signer = row ?? null;
  }

  const [created] = await tx
    .insert(prescription)
    .values({
      organisationId: input.organisationId,
      submissionId: input.submissionId,
      patientId: input.patientId,
      branchId: input.branchId,
      clinicianId: input.clinicianId ?? null,
      medicineId,
      status: 'PENDING_PAYMENT',
      medicineNameSnapshot: parsed
        ? `${parsed.medicine} ${parsed.strength}`
        : context.serviceName,
      strengthSnapshot: parsed?.strength ?? null,
      quantity: input.quantity ?? null,
      directions: input.directions ?? null,
      priceMinorSnapshot: context.priceMinor,
      clinicianNameSnapshot: signer?.fullName ?? null,
      registrationNumberSnapshot: signer?.gphcNumber ?? null,
      signatureSnapshot: signer?.signatureUrl ?? null,
      paidOnline: input.paidOnline,
    })
    .returning({ id: prescription.id });

  return created ? { id: created.id, created: true } : null;
}

/**
 * Move a raised prescription to issued, allocating its number.
 *
 * The number is allocated HERE rather than at approval, because a number is
 * the pharmacy's external reference to a real supply. Allocating one for a
 * request that is never paid for would leave a gap in the sequence that looks,
 * to anyone auditing it later, like a missing prescription.
 */
export async function issuePrescription(
  tx: Tx,
  prescriptionId: string,
): Promise<{ number: string | null } | null> {
  const [row] = await tx
    .select({
      id: prescription.id,
      status: prescription.status,
      number: prescription.number,
      submissionId: prescription.submissionId,
    })
    .from(prescription)
    .where(eq(prescription.id, prescriptionId))
    .limit(1);

  if (!row) return null;

  // Already issued. Re-issuing must not burn a second number for one supply.
  if (row.status !== 'PENDING_PAYMENT') return { number: row.number };

  const consultationNumber = row.submissionId
    ? await allocatePrescriptionNumber(row.submissionId).catch(() => null)
    : null;

  await tx
    .update(prescription)
    .set({
      status: 'ISSUED',
      number: consultationNumber ?? row.number,
      issuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(prescription.id, prescriptionId));

  return { number: consultationNumber ?? row.number };
}

/** The strengths on the master, for the issue form's dropdown. */
export async function getStrengthsFor(
  tx: Tx,
  organisationId: string,
  brand: string,
): Promise<string[]> {
  const rows = await tx
    .select({ label: medicineStrength.label })
    .from(medicineStrength)
    .innerJoin(medicine, eq(medicineStrength.medicineId, medicine.id))
    .where(
      and(
        eq(medicine.organisationId, organisationId),
        eq(medicine.brand, brand),
        eq(medicineStrength.active, true),
      ),
    )
    .orderBy(medicineStrength.position);

  return rows.map((r) => r.label);
}
