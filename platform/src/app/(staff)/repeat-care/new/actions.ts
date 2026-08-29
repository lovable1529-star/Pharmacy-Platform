'use server';

/**
 * The internal repeat request — §6.5.
 *
 * For the case the specification is explicit about: a repeat care patient who
 * sees the pharmacist BEFORE supply. Without this the conversation happens, the
 * medicine is handed over, and the repeat care history has no entry for it —
 * so the next request measures weight loss against a supply that was never
 * recorded, and the stability rules count weeks from the wrong date.
 *
 * It deliberately produces the same submission a patient would, against the
 * same published form version and the same ruleset. A separate staff-only
 * shape would be a second source of truth for the same clinical event, and the
 * two would drift the first time the questionnaire changed.
 *
 * What differs is only who filled it in, which the consent record and the
 * status history both carry.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { action } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { db } from '@/lib/db/client';
import {
  service, submission, patient, repeatEnrolment,
} from '@/lib/db/schema';
import { generateResumeToken, resumeExpiry } from '@/lib/forms/draft';

export interface EnrolledPatient {
  patientId: string;
  enrolmentId: string;
  name: string;
  dateOfBirth: string;
  externalRef: string | null;
  medicine: string | null;
  strength: string | null;
  serviceId: string;
  serviceSlug: string;
  serviceName: string;
}

/**
 * Patients a pharmacist may raise an internal request for.
 *
 * Active enrolments only. Someone paused or stopped has been taken off the
 * pathway deliberately, and offering them here would route round that decision
 * from inside the building.
 */
export async function getEnrolledPatients(
  organisationId: string,
): Promise<EnrolledPatient[]> {
  const rows = await db
    .select({
      patientId: patient.id,
      enrolmentId: repeatEnrolment.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      externalRef: repeatEnrolment.externalRef,
      medicine: repeatEnrolment.medicine,
      strength: repeatEnrolment.strength,
      serviceId: service.id,
      serviceSlug: service.slug,
      serviceName: service.name,
    })
    .from(repeatEnrolment)
    .innerJoin(patient, eq(repeatEnrolment.patientId, patient.id))
    .innerJoin(service, eq(repeatEnrolment.serviceId, service.id))
    .where(
      and(
        eq(repeatEnrolment.organisationId, organisationId),
        eq(repeatEnrolment.status, 'ACTIVE'),
        isNull(service.archivedAt),
      ),
    )
    .orderBy(patient.lastName, patient.firstName);

  return rows.map((r) => ({
    patientId: r.patientId,
    enrolmentId: r.enrolmentId,
    name: `${r.firstName} ${r.lastName}`,
    dateOfBirth: r.dateOfBirth,
    externalRef: r.externalRef,
    medicine: r.medicine,
    strength: r.strength,
    serviceId: r.serviceId,
    serviceSlug: r.serviceSlug,
    serviceName: r.serviceName,
  }));
}

export interface StartInternalInput {
  patientId: string;
  serviceId: string;
  branchId: string;
  companyId?: string | null;
}

const start = action<StartInternalInput>('repeat_care:edit')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    const [enrolment] = await tx
      .select({ id: repeatEnrolment.id, status: repeatEnrolment.status })
      .from(repeatEnrolment)
      .where(
        and(
          eq(repeatEnrolment.organisationId, actor.organisationId),
          eq(repeatEnrolment.patientId, input.patientId),
          eq(repeatEnrolment.serviceId, input.serviceId),
        ),
      )
      .limit(1);

    if (!enrolment) throw new Error('That patient is not enrolled in repeat care for this service.');
    if (enrolment.status !== 'ACTIVE') {
      throw new Error('That enrolment is not active. A pharmacist must reactivate it first.');
    }

    const [svc] = await tx
      .select({ publishedFormVersionId: service.publishedFormVersionId })
      .from(service)
      .where(eq(service.id, input.serviceId))
      .limit(1);

    if (!svc?.publishedFormVersionId) {
      throw new Error('That service has no published form.');
    }

    const token = generateResumeToken();

    const [created] = await tx
      .insert(submission)
      .values({
        organisationId: actor.organisationId,
        serviceId: input.serviceId,
        formVersionId: svc.publishedFormVersionId,
        patientId: input.patientId,
        branchId: input.branchId,
        status: 'DRAFT',
        answers: {},
        derived: {},
        resumeToken: token,
        resumeExpiresAt: resumeExpiry(),
      })
      .returning({ id: submission.id });

    if (!created) throw new Error('Could not start the request.');

    return {
      result: { submissionId: created.id, token },
      audit: {
        action: 'repeat_request.started_internally',
        entityType: 'submission',
        entityId: created.id,
        after: { patientId: input.patientId, by: actor.fullName },
      },
    };
  });

export async function startInternalRequest(input: StartInternalInput) {
  try {
    const result = await start(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('startInternalRequest failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to raise a repeat request.'
          : error instanceof Error
            ? error.message
            : 'Could not start the request.',
    };
  }
}
