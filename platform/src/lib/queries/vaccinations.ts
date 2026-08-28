/**
 * Reads for the vaccination workflow.
 *
 * §26.1 asks for a pharmacist home that starts with a patient search rather
 * than navigation through data screens, so the shape here is "find a person",
 * not "list a table".
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  submission, patient, service, formVersion, branch, clinician,
  batch, product, stockLevel, vaccineAdministration, consentRecord,
} from '@/lib/db/schema';

export interface VaccinationCandidate {
  submissionId: string;
  status: string;
  submittedAt: Date | null;
  patientId: string | null;
  patientName: string;
  dateOfBirth: string | null;
  serviceName: string;
  serviceSlug: string;
  alreadyRecorded: boolean;
}

/**
 * Questionnaires for vaccination services, newest first.
 *
 * Includes completed ones: a pharmacist looking for "did Mrs Kelly have hers?"
 * needs to find the answer, and hiding finished records would make the search
 * lie by omission. `alreadyRecorded` is what the screen uses to distinguish
 * them, rather than the list quietly excluding them.
 */
export async function getVaccinationCandidates(
  organisationId: string,
  limit = 300,
): Promise<VaccinationCandidate[]> {
  const rows = await db
    .select({
      submissionId: submission.id,
      status: submission.status,
      submittedAt: submission.submittedAt,
      patientId: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      bookedName: sql<string | null>`null`,
      serviceName: service.name,
      serviceSlug: service.slug,
      administrationId: vaccineAdministration.id,
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .leftJoin(patient, eq(submission.patientId, patient.id))
    .leftJoin(vaccineAdministration, eq(vaccineAdministration.submissionId, submission.id))
    .where(
      and(
        eq(submission.organisationId, organisationId),
        eq(service.kind, 'VACCINATION'),
        isNull(service.archivedAt),
      ),
    )
    .orderBy(desc(submission.submittedAt))
    .limit(limit);

  return rows.map((r) => ({
    submissionId: r.submissionId,
    status: r.status,
    submittedAt: r.submittedAt,
    patientId: r.patientId,
    patientName:
      r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : 'Unnamed patient',
    dateOfBirth: r.dateOfBirth,
    serviceName: r.serviceName,
    serviceSlug: r.serviceSlug,
    alreadyRecorded: r.administrationId !== null,
  }));
}

export interface VaccinationConsultation {
  submissionId: string;
  status: string;
  answers: Record<string, unknown>;
  schema: unknown;
  serviceName: string;
  patientId: string | null;
  patientName: string;
  dateOfBirth: string | null;
  address: string | null;
  gpSurgeryId: string | null;
  consentAccepted: boolean;
  administration: {
    id: string;
    vaccineName: string;
    batchNumber: string;
    administeredOn: string;
    site: string;
    clinicianName: string;
  } | null;
}

/** Everything the pharmacist verifies before recording — §26.2. */
export async function getVaccinationConsultation(
  organisationId: string,
  submissionId: string,
): Promise<VaccinationConsultation | null> {
  const [row] = await db
    .select({
      submissionId: submission.id,
      status: submission.status,
      answers: submission.answers,
      schema: formVersion.schema,
      serviceName: service.name,
      patientId: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      address: patient.addressLine1,
      gpSurgeryId: patient.gpSurgeryId,
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .innerJoin(formVersion, eq(submission.formVersionId, formVersion.id))
    .leftJoin(patient, eq(submission.patientId, patient.id))
    .where(
      and(eq(submission.id, submissionId), eq(submission.organisationId, organisationId)),
    )
    .limit(1);

  if (!row) return null;

  const [consent] = await db
    .select({ accepted: consentRecord.accepted })
    .from(consentRecord)
    .where(eq(consentRecord.submissionId, submissionId))
    .limit(1);

  const [existing] = await db
    .select({
      id: vaccineAdministration.id,
      vaccineName: vaccineAdministration.vaccineNameSnapshot,
      batchNumber: vaccineAdministration.batchNumberSnapshot,
      administeredOn: vaccineAdministration.administeredOn,
      site: vaccineAdministration.site,
      clinicianName: vaccineAdministration.clinicianNameSnapshot,
    })
    .from(vaccineAdministration)
    .where(eq(vaccineAdministration.submissionId, submissionId))
    .limit(1);

  return {
    submissionId: row.submissionId,
    status: row.status,
    answers: (row.answers ?? {}) as Record<string, unknown>,
    schema: row.schema,
    serviceName: row.serviceName,
    patientId: row.patientId,
    patientName:
      row.firstName && row.lastName ? `${row.firstName} ${row.lastName}` : 'Unnamed patient',
    dateOfBirth: row.dateOfBirth,
    address: row.address,
    gpSurgeryId: row.gpSurgeryId,
    consentAccepted: consent?.accepted === true,
    administration: existing ?? null,
  };
}

export interface UsableBatch {
  batchId: string;
  productName: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
}

/**
 * Batches that may actually be given at this branch — §28.4.
 *
 * Expired, recalled and empty batches are excluded here rather than shown and
 * refused later. The validator still checks all three, because a list is a
 * convenience and the safety check must not depend on it.
 */
export async function getUsableBatches(
  organisationId: string,
  branchId: string,
): Promise<UsableBatch[]> {
  const rows = await db
    .select({
      batchId: batch.id,
      productName: product.name,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      quantity: stockLevel.quantity,
    })
    .from(stockLevel)
    .innerJoin(batch, eq(stockLevel.batchId, batch.id))
    .innerJoin(product, eq(batch.productId, product.id))
    .where(
      and(
        eq(stockLevel.organisationId, organisationId),
        eq(stockLevel.branchId, branchId),
        isNull(batch.recalledAt),
        sql`${batch.expiryDate} >= current_date`,
        sql`${stockLevel.quantity} > 0`,
      ),
    )
    .orderBy(product.name, batch.expiryDate);

  return rows.map((r) => ({ ...r, quantity: r.quantity ?? 0 }));
}

/** The pharmacist dropdown, auto-filling a registration number on selection. */
export async function getClinicians(organisationId: string) {
  return db
    .select({
      id: clinician.id,
      fullName: clinician.fullName,
      gphcNumber: clinician.gphcNumber,
    })
    .from(clinician)
    .where(and(eq(clinician.organisationId, organisationId), isNull(clinician.archivedAt)))
    .orderBy(clinician.fullName);
}

/** Branches, so §27.1's "branch above pharmacist" ordering can be honoured. */
export async function getBranches(organisationId: string) {
  return db
    .select({ id: branch.id, name: branch.name, companyId: branch.companyId })
    .from(branch)
    .where(eq(branch.organisationId, organisationId))
    .orderBy(branch.name);
}
