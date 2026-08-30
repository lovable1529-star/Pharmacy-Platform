/**
 * Creating the fulfilment record when a prescription is issued, and closing
 * the loop when it is finally supplied.
 *
 * Both live here rather than in a route action because both are consequences
 * of something else happening — a payment settling, a parcel going out — and
 * a consequence that only fires when somebody remembers to click the right
 * screen is not a consequence.
 */

import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import {
  prescription, prescriptionFulfilment, submission, patient, repeatEnrolment, service,
} from '@/lib/db/schema';
import { methodFromAnswers } from '@/lib/fulfilment/transitions';
import { enrolmentSeedFromSupply, seedGaps } from '@/lib/clinical/enrol-on-supply';
import type { Answers } from '@/types/form-schema';

/**
 * One fulfilment per issued prescription, from the patient's own choice.
 *
 * Idempotent: the unique index on `prescription_id` is what guarantees it, and
 * settlement can be retried by a webhook arriving twice.
 */
export async function createFulfilmentForPrescription(
  tx: Tx,
  input: { organisationId: string; prescriptionId: string; submissionId: string | null },
): Promise<string | null> {
  const [existing] = await tx
    .select({ id: prescriptionFulfilment.id })
    .from(prescriptionFulfilment)
    .where(eq(prescriptionFulfilment.prescriptionId, input.prescriptionId))
    .limit(1);

  if (existing) return existing.id;

  let answers: Answers = {};
  let address: string | null = null;

  if (input.submissionId) {
    const [row] = await tx
      .select({
        answers: submission.answers,
        addressLine: patient.addressLine1,
        town: patient.town,
        postcode: patient.postcode,
      })
      .from(submission)
      .leftJoin(patient, eq(submission.patientId, patient.id))
      .where(eq(submission.id, input.submissionId))
      .limit(1);

    if (row) {
      answers = (row.answers ?? {}) as Answers;
      /*
       * Snapshotted now, not read at dispatch. A patient who moves house next
       * year must not retrospectively change where last month's parcel went.
       * The form's own delivery address wins over the record's, because it is
       * what they asked for on the day.
       */
      const chosen = answers.deliveryAddress;
      address = typeof chosen === 'string' && chosen.trim()
        ? chosen.trim()
        : [row.addressLine, row.town, row.postcode].filter(Boolean).join(', ') || null;
    }
  }

  const method = methodFromAnswers(answers as Record<string, unknown>);

  const [created] = await tx
    .insert(prescriptionFulfilment)
    .values({
      organisationId: input.organisationId,
      prescriptionId: input.prescriptionId,
      method,
      status: 'PENDING',
      deliveryAddressSnapshot: method === 'DELIVERY' ? address : null,
    })
    .returning({ id: prescriptionFulfilment.id });

  return created?.id ?? null;
}

export interface EnrolmentOutcome {
  created: boolean;
  updated: boolean;
  gaps: string[];
}

/**
 * Put the patient on repeat care, now that something has actually been supplied.
 *
 * The client's rule is that history moves forward only after a real supply, so
 * this is the moment — not approval, which may be for medicine that never
 * leaves the pharmacy.
 *
 * An existing enrolment is UPDATED rather than replaced: the starting weight
 * is where they began and must survive every later supply, while the last
 * supply, last weight and current strength move each time.
 */
export async function enrolFromSupply(
  tx: Tx,
  input: { organisationId: string; prescriptionId: string },
): Promise<EnrolmentOutcome | null> {
  const [row] = await tx
    .select({
      patientId: prescription.patientId,
      submissionId: prescription.submissionId,
      medicineName: prescription.medicineNameSnapshot,
      strength: prescription.strengthSnapshot,
      answers: submission.answers,
      serviceId: submission.serviceId,
      serviceKind: service.kind,
    })
    .from(prescription)
    .leftJoin(submission, eq(prescription.submissionId, submission.id))
    .leftJoin(service, eq(submission.serviceId, service.id))
    .where(
      and(
        eq(prescription.id, input.prescriptionId),
        eq(prescription.organisationId, input.organisationId),
      ),
    )
    .limit(1);

  if (!row || !row.patientId || !row.serviceId) return null;

  /*
   * Only pathways that lead to repeat supply. A flu vaccination is a supply
   * too, and enrolling somebody into repeat care because they had a jab would
   * open the repeat questionnaire to a patient nobody assessed for it.
   */
  if (row.serviceKind === 'VACCINATION') return null;

  /*
   * Enrolment belongs to the REPEAT service, which is the one whose gate reads
   * it — not to the new-patient service the request came through.
   */
  const [repeatService] = await tx
    .select({ id: service.id })
    .from(service)
    .where(
      and(
        eq(service.organisationId, input.organisationId),
        eq(service.kind, 'REPEAT_SUPPLY'),
      ),
    )
    .limit(1);

  if (!repeatService) return null;

  const seed = enrolmentSeedFromSupply({
    medicineName: row.medicineName,
    strength: row.strength,
    answers: (row.answers ?? {}) as Answers,
    suppliedAt: new Date(),
  });

  const gaps = seedGaps(seed);

  const [existing] = await tx
    .select({ id: repeatEnrolment.id })
    .from(repeatEnrolment)
    .where(
      and(
        eq(repeatEnrolment.patientId, row.patientId),
        eq(repeatEnrolment.serviceId, repeatService.id),
      ),
    )
    .limit(1);

  if (existing) {
    await tx
      .update(repeatEnrolment)
      .set({
        // The starting figures are deliberately absent: they are where this
        // patient began and must survive every later supply.
        medicine: seed.medicine,
        strength: seed.strength,
        strengthSince: seed.strengthSince,
        lastSuppliedAt: seed.lastSuppliedAt,
        lastWeightKg: seed.lastWeightKg,
        updatedAt: new Date(),
      })
      .where(eq(repeatEnrolment.id, existing.id));

    return { created: false, updated: true, gaps };
  }

  await tx.insert(repeatEnrolment).values({
    organisationId: input.organisationId,
    patientId: row.patientId,
    serviceId: repeatService.id,
    status: 'ACTIVE',
    heightCm: seed.heightCm,
    startingWeightKg: seed.startingWeightKg,
    startingWaistCm: seed.startingWaistCm,
    medicine: seed.medicine,
    strength: seed.strength,
    strengthSince: seed.strengthSince,
    lastSuppliedAt: seed.lastSuppliedAt,
    lastWeightKg: seed.lastWeightKg,
    notes: 'Created automatically on first supply.',
  });

  return { created: true, updated: false, gaps };
}
