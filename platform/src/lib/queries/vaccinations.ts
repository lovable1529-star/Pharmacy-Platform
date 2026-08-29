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
  batch, product, stockLevel, vaccineAdministration, consentRecord, appointment,
} from '@/lib/db/schema';

/**
 * How far a questionnaire has got.
 *
 * The screen used to show one badge — "ready to give" — on everything not yet
 * administered, and count all of them as waiting. But a draft is created the
 * moment an appointment is booked, so most of that list was bookings nobody had
 * opened. A pharmacist reading "9 waiting" had no way to tell the two people
 * genuinely ready from the seven who had not started.
 */
export type VaccinationStage =
  /** Recorded. Nothing left to do. */
  | 'given'
  /** Submitted and waiting for a pharmacist. The only stage that is "waiting". */
  | 'ready'
  /** Opened and part-filled, not submitted. */
  | 'started'
  /** A booking whose form has never been opened. */
  | 'not-started'
  /** The appointment behind it was cancelled. */
  | 'cancelled';

export interface VaccinationCandidate {
  submissionId: string;
  status: string;
  submittedAt: Date | null;
  patientId: string | null;
  patientName: string;
  dateOfBirth: string | null;
  /**
   * Whether a patient RECORD exists, as opposed to a name we happen to know.
   *
   * These are different facts and the screen has to keep them apart. A booking
   * carries whatever was typed into it; a patient record is the thing history,
   * allergies and previous vaccinations hang off. Somebody can be perfectly
   * well named and still have neither.
   */
  patientLinked: boolean;
  /** True when the name came from the booking rather than a patient record. */
  nameFromBooking: boolean;
  stage: VaccinationStage;
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
      /*
       * The name typed at booking.
       *
       * This column was selected as a literal `null` — stubbed, and the join
       * never written — so every questionnaire without a patient record read as
       * "Unnamed patient" while the name sat on the appointment row all along.
       *
       * A patient record is only created where a full identity exists: a name
       * AND a valid date of birth, either at booking or when the form is
       * submitted. Book somebody by name and phone alone and there is nothing
       * to create a record from, but there is certainly something to show.
       */
      /*
       * A scalar subquery, not a join.
       *
       * `appointment.submission_id` carries a foreign key and an index but no
       * UNIQUE constraint, so nothing at the database level stops two
       * appointments pointing at one questionnaire. A left join would then
       * silently list that patient twice, and a duplicated row on a "who is
       * waiting" screen is the kind of thing that gets someone vaccinated
       * twice or skipped.
       *
       * Newest first, so a rebooking's name wins over the original.
       */
      bookedName: sql<string | null>`(
        select a.booked_name
        from ${appointment} a
        where a.submission_id = ${submission.id}
        order by a.starts_at desc
        limit 1
      )`,
      /*
       * Has anybody actually typed into this form?
       *
       * A draft starts as `{}`, so an empty object means the link was never
       * opened. `_metadata` is written by the submit path rather than by the
       * patient, so it does not count as an answer.
       *
       * Guarded on `jsonb_typeof`, because `jsonb_object_keys` raises on a
       * value that is not an object and one bad row would fail the whole
       * screen rather than one line of it.
       */
      answerCount: sql<number>`(
        case when jsonb_typeof(${submission.answers}) = 'object'
          then (
            select count(*) from jsonb_object_keys(${submission.answers}) as k
            where k <> '_metadata'
          )
          else 0
        end
      )`,
      /* Newest appointment, matching the booked name above. */
      appointmentStatus: sql<string | null>`(
        select a.status
        from ${appointment} a
        where a.submission_id = ${submission.id}
        order by a.starts_at desc
        limit 1
      )`,
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

  return rows.map((r) => {
    const linked = Boolean(r.firstName && r.lastName);
    const booked = r.bookedName?.trim() || null;

    /*
     * Cancelled appointments are shown, not hidden — the same reasoning that
     * keeps completed ones in the list. A pharmacist asking "was she booked in
     * for one?" needs to find the answer, and a screen that silently omits
     * records lies by omission. They are simply not counted as waiting.
     */
    const stage: VaccinationStage =
      r.administrationId !== null ? 'given'
        : r.appointmentStatus === 'CANCELLED' ? 'cancelled'
          : r.status !== 'DRAFT' ? 'ready'
            : Number(r.answerCount) > 0 ? 'started'
              : 'not-started';

    return {
      stage,
      submissionId: r.submissionId,
      status: r.status,
      submittedAt: r.submittedAt,
      patientId: r.patientId,
      // The record first, then the booking, and only then an admission that we
      // do not know. "Unnamed" should mean nobody told us, not that we did not
      // look.
      patientName: linked ? `${r.firstName} ${r.lastName}` : booked ?? 'Unnamed patient',
      dateOfBirth: r.dateOfBirth,
      patientLinked: linked,
      nameFromBooking: !linked && booked !== null,
      serviceName: r.serviceName,
      serviceSlug: r.serviceSlug,
      alreadyRecorded: r.administrationId !== null,
    };
  });
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
