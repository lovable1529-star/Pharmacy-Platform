/**
 * Prescriptions — §8.7 as a worklist.
 *
 * The lifecycle is the organising idea, because at any moment the pharmacy's
 * question is "what is waiting on us?" — awaiting payment, ready to dispense,
 * dispensed and waiting to be collected. Grouped by that rather than listed by
 * date, so the queue answers the question without being read end to end.
 */

import { and, desc, eq } from 'drizzle-orm';
import { getStaffContext } from '@/lib/auth/context';
import { getClinicians } from '@/lib/queries/vaccinations';
import { db } from '@/lib/db/client';
import {
  prescription, patient, branch, dispensingSignoff, collectionSignoff, submission,
} from '@/lib/db/schema';
import { PrescriptionsView } from './prescriptions-view';

export const dynamic = 'force-dynamic';

export default async function PrescriptionsPage() {
  const { actor, activeBranch } = await getStaffContext();

  const clinicians = await getClinicians(actor.organisationId);

  const rows = await db
    .select({
      id: prescription.id,
      number: prescription.number,
      status: prescription.status,
      medicineName: prescription.medicineNameSnapshot,
      quantity: prescription.quantity,
      priceMinor: prescription.priceMinorSnapshot,
      paidOnline: prescription.paidOnline,
      issuedAt: prescription.issuedAt,
      createdAt: prescription.createdAt,
      branchId: prescription.branchId,
      branchName: branch.name,
      companyId: branch.companyId,
      patientId: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      submissionId: prescription.submissionId,
      answers: submission.answers,
      dispensedBy: dispensingSignoff.clinicianNameSnapshot,
      dispensedAt: dispensingSignoff.signedAt,
      collectedBy: collectionSignoff.collectedByName,
      collectedAt: collectionSignoff.collectedAt,
    })
    .from(prescription)
    .innerJoin(patient, eq(prescription.patientId, patient.id))
    .innerJoin(branch, eq(prescription.branchId, branch.id))
    .leftJoin(submission, eq(prescription.submissionId, submission.id))
    .leftJoin(dispensingSignoff, eq(dispensingSignoff.prescriptionId, prescription.id))
    .leftJoin(collectionSignoff, eq(collectionSignoff.prescriptionId, prescription.id))
    .where(eq(prescription.organisationId, actor.organisationId))
    .orderBy(desc(prescription.createdAt))
    .limit(400);

  return (
    <PrescriptionsView
      rows={rows.map((r) => {
        const answers = (r.answers ?? {}) as Record<string, unknown>;
        // §6.4 — a question the patient asked must reach the counter, not sit
        // in a form nobody opens at the moment of handing the bag over.
        const asked = [
          'questionsForPharmacist', 'questions', 'patientQuestion',
          'notesForPharmacist', 'anythingElse',
        ]
          .map((k) => answers[k])
          .find((v) => typeof v === 'string' && v.trim().length > 0);

        return {
          id: r.id,
          number: r.number,
          status: r.status,
          medicineName: r.medicineName,
          quantity: r.quantity,
          priceMinor: r.priceMinor,
          paidOnline: r.paidOnline,
          issuedAt: r.issuedAt,
          createdAt: r.createdAt,
          branchId: r.branchId,
          branchName: r.branchName,
          companyId: r.companyId,
          patientName: `${r.firstName} ${r.lastName}`,
          patientId: r.patientId,
          patientQuestion: typeof asked === 'string' ? asked.trim() : null,
          dispensedBy: r.dispensedBy,
          dispensedAt: r.dispensedAt,
          collectedBy: r.collectedBy,
          collectedAt: r.collectedAt,
        };
      })}
      clinicians={clinicians}
          branchId={activeBranch?.id ?? null}
      companyId={activeBranch?.companyId ?? null}
    />
  );
}
