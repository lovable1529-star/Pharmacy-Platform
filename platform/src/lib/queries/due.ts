/**
 * The enrolments behind the due list.
 *
 * One read. The supply length lives in the answers of each patient's most
 * recent request, so that is fetched alongside rather than per row — a query
 * per patient against a database in Seoul turns a 30-patient list into six
 * seconds of round trips.
 */

import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { patient, repeatEnrolment, service, submission } from '@/lib/db/schema';
import { dueList, type DueEnrolment, type DueRow } from '@/lib/repeat-care/due';

/** Statuses that mean the patient has already come back and is waiting on us. */
const OPEN = ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED', 'RESUBMITTED'] as const;

export async function getDueList(
  organisationId: string,
  now = new Date(),
): Promise<DueRow[]> {
  const enrolments = await db
    .select({
      patientId: repeatEnrolment.patientId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      externalRef: repeatEnrolment.externalRef,
      medicine: repeatEnrolment.medicine,
      strength: repeatEnrolment.strength,
      lastSuppliedAt: repeatEnrolment.lastSuppliedAt,
      serviceId: repeatEnrolment.serviceId,
    })
    .from(repeatEnrolment)
    .innerJoin(patient, eq(repeatEnrolment.patientId, patient.id))
    .where(and(
      eq(repeatEnrolment.organisationId, organisationId),
      eq(repeatEnrolment.status, 'ACTIVE'),
    ));

  if (enrolments.length === 0) return [];

  const patientIds = enrolments.map((e) => e.patientId);

  /*
   * Every non-draft submission for these patients, newest first. The most
   * recent one gives the supply length; any OPEN one means they are already in
   * the queue and must not be chased.
   */
  const rows = await db
    .select({
      patientId: submission.patientId,
      answers: submission.answers,
      status: submission.status,
      submittedAt: submission.createdAt,
      serviceKind: service.kind,
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .where(and(
      eq(submission.organisationId, organisationId),
      inArray(submission.patientId, patientIds),
      isNotNull(submission.patientId),
    ))
    .orderBy(desc(submission.createdAt));

  const latestAnswers = new Map<string, Record<string, unknown>>();
  const openRequest = new Set<string>();

  for (const row of rows) {
    if (!row.patientId) continue;

    // Newest first, so the first one seen for a patient is their latest.
    if (!latestAnswers.has(row.patientId) && row.status !== 'DRAFT') {
      latestAnswers.set(row.patientId, (row.answers ?? {}) as Record<string, unknown>);
    }

    if ((OPEN as readonly string[]).includes(row.status)) openRequest.add(row.patientId);
  }

  const input: DueEnrolment[] = enrolments.map((e) => ({
    patientId: e.patientId,
    patientName: `${e.firstName} ${e.lastName}`.trim(),
    externalRef: e.externalRef,
    medicine: e.medicine,
    strength: e.strength,
    lastSuppliedAt: e.lastSuppliedAt,
    lastAnswers: latestAnswers.get(e.patientId) ?? null,
    hasOpenRequest: openRequest.has(e.patientId),
  }));

  return dueList(input, now);
}
