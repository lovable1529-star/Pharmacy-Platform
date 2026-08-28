/**
 * Data for the end-of-day notification jobs.
 *
 * Kept apart from the routes so the shape of the query is reviewable on its own,
 * and so the batching logic can be tested against plain objects rather than a
 * database.
 */

import { and, eq, gte, lte, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  consultation, patient, gpSurgery, service, clinician, branch, batch, product,
} from '@/lib/db/schema';
import { fromZonedTime } from 'date-fns-tz';
import { localDateKey, PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';
import type { NotifiableConsultation } from '@/lib/communications/batching';

/**
 * Start and end of a day in the PHARMACY's timezone, expressed as UTC.
 *
 * The comment above this function always claimed that; the implementation did
 * not do it. `setHours` uses the runtime's zone — UTC on Vercel, UTC+5:30 on a
 * developer machine — so "today" was whoever-is-running-it's today. Around
 * midnight the daily summary and every date-filtered report picked up the wrong
 * consultations, and the GP batch mailed the wrong day's patients.
 *
 * Same defect the slot generator had. These two callers were missed then.
 */
export function dayBounds(date: Date): { from: Date; to: Date } {
  const key = localDateKey(date, PHARMACY_TIMEZONE);
  return {
    from: fromZonedTime(`${key}T00:00:00.000`, PHARMACY_TIMEZONE),
    to: fromZonedTime(`${key}T23:59:59.999`, PHARMACY_TIMEZONE),
  };
}

export async function getConsultationsToNotify(
  organisationId: string,
  date: Date,
  includeAlreadySent = false,
): Promise<NotifiableConsultation[]> {
  const { from, to } = dayBounds(date);

  const rows = await db
    .select({
      consultationId: consultation.id,
      completedAt: consultation.completedAt,
      clinicalData: consultation.clinicalData,
      gpNotifiedAt: consultation.gpNotifiedAt,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      gpSurgeryId: gpSurgery.id,
      gpSurgeryName: gpSurgery.name,
      gpSurgeryEmail: gpSurgery.email,
      serviceName: service.name,
      branchName: branch.name,
      clinicianName: clinician.fullName,
      clinicianGphc: clinician.gphcNumber,
      batchNumber: batch.batchNumber,
      productName: product.name,
    })
    .from(consultation)
    .innerJoin(patient, eq(consultation.patientId, patient.id))
    .innerJoin(service, eq(consultation.serviceId, service.id))
    .innerJoin(branch, eq(consultation.branchId, branch.id))
    .leftJoin(gpSurgery, eq(patient.gpSurgeryId, gpSurgery.id))
    .leftJoin(clinician, eq(consultation.clinicianId, clinician.id))
    .leftJoin(batch, eq(consultation.batchId, batch.id))
    .leftJoin(product, eq(batch.productId, product.id))
    .where(
      and(
        eq(consultation.organisationId, organisationId),
        eq(consultation.status, 'COMPLETED'),
        gte(consultation.completedAt, from),
        lte(consultation.completedAt, to),
      ),
    );

  return rows.map((r) => {
    const clinical = (r.clinicalData ?? {}) as Record<string, unknown>;
    return {
      consultationId: r.consultationId,
      patientName: `${r.firstName} ${r.lastName}`,
      patientDateOfBirth: r.dateOfBirth,
      gpSurgeryId: r.gpSurgeryId ?? '',
      gpSurgeryName: r.gpSurgeryName ?? 'No GP recorded',
      gpSurgeryEmail: r.gpSurgeryEmail ?? '',
      serviceName: r.serviceName,
      productName: r.productName,
      batchNumber: r.batchNumber,
      administeredAt: r.completedAt ?? new Date(),
      branchName: r.branchName,
      clinicianName: r.clinicianName ?? 'Not recorded',
      clinicianGphc: r.clinicianGphc ?? '—',
      siteOfAdministration:
        typeof clinical.siteOfAdministration === 'string' ? clinical.siteOfAdministration : null,
      fundedBy:
        clinical.fundedBy === 'NHS' || clinical.fundedBy === 'Private'
          ? (clinical.fundedBy as 'NHS' | 'Private')
          : null,
      // The COLUMN, not the clinical JSONB.
      //
      // These were two separate stores: the nightly batch stamped the blob, the
      // Communications screen stamped `gp_notified_at`. Neither could see the
      // other, so a practice notified overnight still appeared unsent the next
      // morning and got the same record twice.
      notifiedAt: includeAlreadySent ? null : r.gpNotifiedAt,
    };
  });
}

/** Where the internal daily summary goes. */
export async function getInternalRecipients(organisationId: string): Promise<string[]> {
  const rows = await db
    .select({ inboxEmail: branch.inboxEmail })
    .from(branch)
    .where(and(eq(branch.organisationId, organisationId), isNull(branch.archivedAt)));

  return [...new Set(rows.map((r) => r.inboxEmail).filter((e): e is string => Boolean(e)))];
}
