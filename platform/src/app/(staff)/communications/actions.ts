'use server';

/**
 * Telling GP practices what we did.
 *
 * The nightly batch already exists. This is the manual side he described in
 * writing and which was never built: "Filter and select by date or date range,
 * filter by GP, exclude previously sent records… Ability to go back
 * historically and resend."
 *
 * The reason it matters is a correction. When a record is amended after the
 * practice has already been told, somebody has to send that one record again —
 * and only that one. Without a resend the pharmacy's only options are to leave
 * the surgery holding wrong information or to re-send the whole day.
 *
 * "Already sent" now lives in its own column rather than inside the clinical
 * JSON, so it can be filtered on, counted, and indexed.
 */

import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { db } from '@/lib/db/client';
import {
  consultation, patient, service, branch, clinician, gpSurgery, batch, product,
} from '@/lib/db/schema';
import { getStaffContext } from '@/lib/auth/context';
import { queueNotification } from '@/lib/notifications/outbox';
import { PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';

export interface GpRecord {
  consultationId: string;
  completedAt: Date | null;
  patientName: string;
  dateOfBirth: string;
  serviceName: string;
  branchName: string;
  clinicianName: string | null;
  productName: string | null;
  batchNumber: string | null;
  gpSurgeryId: string | null;
  gpSurgeryName: string | null;
  gpSurgeryEmail: string | null;
  gpNotifiedAt: Date | null;
  gpNotifyCount: number;
}

export interface GpFilters {
  from: string;
  to: string;
  gpSurgeryId?: string | null;
  /** His words: "Exclude previously sent records". */
  excludeSent?: boolean;
}

export async function getGpRecords(filters: GpFilters): Promise<{
  ok: boolean;
  records?: GpRecord[];
  surgeries?: { id: string; name: string }[];
  error?: string;
}> {
  try {
    const { actor } = await getStaffContext();

    const from = new Date(`${filters.from}T00:00:00Z`);
    const to = new Date(`${filters.to}T23:59:59Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return { ok: false, error: 'That date range is not valid.' };
    }

    const where = [
      eq(consultation.organisationId, actor.organisationId),
      eq(consultation.status, 'COMPLETED'),
      gte(consultation.completedAt, from),
      lte(consultation.completedAt, to),
    ];

    if (filters.gpSurgeryId) where.push(eq(gpSurgery.id, filters.gpSurgeryId));
    if (filters.excludeSent) where.push(isNull(consultation.gpNotifiedAt));

    const [records, surgeries] = await Promise.all([
      db
        .select({
          consultationId: consultation.id,
          completedAt: consultation.completedAt,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          serviceName: service.name,
          branchName: branch.name,
          clinicianName: clinician.fullName,
          productName: product.name,
          batchNumber: batch.batchNumber,
          gpSurgeryId: gpSurgery.id,
          gpSurgeryName: gpSurgery.name,
          gpSurgeryEmail: gpSurgery.email,
          gpNotifiedAt: consultation.gpNotifiedAt,
          gpNotifyCount: consultation.gpNotifyCount,
        })
        .from(consultation)
        .innerJoin(patient, eq(consultation.patientId, patient.id))
        .innerJoin(service, eq(consultation.serviceId, service.id))
        .innerJoin(branch, eq(consultation.branchId, branch.id))
        .leftJoin(clinician, eq(consultation.clinicianId, clinician.id))
        .leftJoin(batch, eq(consultation.batchId, batch.id))
        .leftJoin(product, eq(batch.productId, product.id))
        .leftJoin(gpSurgery, eq(patient.gpSurgeryId, gpSurgery.id))
        .where(and(...where))
        .orderBy(desc(consultation.completedAt))
        .limit(500),

      db
        .select({ id: gpSurgery.id, name: gpSurgery.name })
        .from(gpSurgery)
        .where(
          and(
            eq(gpSurgery.organisationId, actor.organisationId),
            isNull(gpSurgery.archivedAt),
          ),
        )
        .orderBy(gpSurgery.name),
    ]);

    return {
      ok: true,
      surgeries,
      records: records.map((r) => ({
        consultationId: r.consultationId,
        completedAt: r.completedAt,
        patientName: `${r.firstName} ${r.lastName}`,
        dateOfBirth: r.dateOfBirth,
        serviceName: r.serviceName,
        branchName: r.branchName,
        clinicianName: r.clinicianName,
        productName: r.productName,
        batchNumber: r.batchNumber,
        gpSurgeryId: r.gpSurgeryId,
        gpSurgeryName: r.gpSurgeryName,
        gpSurgeryEmail: r.gpSurgeryEmail,
        gpNotifiedAt: r.gpNotifiedAt,
        gpNotifyCount: r.gpNotifyCount,
      })),
    };
  } catch (error) {
    console.error('getGpRecords failed', error);
    return { ok: false, error: 'Could not load records.' };
  }
}

function longDate(date: Date | null): string {
  if (!date) return 'date not recorded';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long', timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const send = action<{ consultationIds: string[] }>('communications:add').handler(
  async (input, { tx, actor }) => {
    if (input.consultationIds.length === 0) {
      throw new Error('Nothing selected.');
    }

    const rows = await tx
      .select({
        id: consultation.id,
        completedAt: consultation.completedAt,
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: patient.dateOfBirth,
        serviceName: service.name,
        branchName: branch.name,
        clinicianName: clinician.fullName,
        gphcNumber: clinician.gphcNumber,
        productName: product.name,
        batchNumber: batch.batchNumber,
        surgeryName: gpSurgery.name,
        surgeryEmail: gpSurgery.email,
        notifyCount: consultation.gpNotifyCount,
      })
      .from(consultation)
      .innerJoin(patient, eq(consultation.patientId, patient.id))
      .innerJoin(service, eq(consultation.serviceId, service.id))
      .innerJoin(branch, eq(consultation.branchId, branch.id))
      .leftJoin(clinician, eq(consultation.clinicianId, clinician.id))
      .leftJoin(batch, eq(consultation.batchId, batch.id))
      .leftJoin(product, eq(batch.productId, product.id))
      .leftJoin(gpSurgery, eq(patient.gpSurgeryId, gpSurgery.id))
      .where(
        and(
          inArray(consultation.id, input.consultationIds),
          eq(consultation.organisationId, actor.organisationId),
        ),
      );

    // One email per practice listing every patient, which is the format he
    // asked for — eleven separate emails per patient would be unusable at the
    // surgery end.
    const bySurgery = new Map<string, typeof rows>();
    const unroutable: string[] = [];

    for (const row of rows) {
      if (!row.surgeryEmail) {
        unroutable.push(`${row.firstName} ${row.lastName}`);
        continue;
      }
      const list = bySurgery.get(row.surgeryEmail);
      if (list) list.push(row);
      else bySurgery.set(row.surgeryEmail, [row]);
    }

    const sentIds: string[] = [];

    for (const [email, list] of bySurgery) {
      const first = list[0];
      if (!first) continue;

      // A resend says so in the subject. A practice receiving what looks like a
      // duplicate needs to know it supersedes rather than repeats.
      const isResend = list.every((r) => r.notifyCount > 0);
      const heading = isResend
        ? 'Updated vaccination record'
        : 'Vaccinations administered at Karsons Pharmacy';

      const body = `
        <p>Dear ${escapeHtml(first.surgeryName ?? 'colleagues')},</p>
        <p>${
          isResend
            ? 'This is an updated record and replaces what we sent previously.'
            : 'The following patients registered with your practice were seen at Karsons Pharmacy.'
        }</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:12px;">
          <thead>
            <tr style="text-align:left;border-bottom:2px solid #191428;">
              <th style="padding:6px 8px;">Patient</th>
              <th style="padding:6px 8px;">Date of birth</th>
              <th style="padding:6px 8px;">Service</th>
              <th style="padding:6px 8px;">Product / batch</th>
              <th style="padding:6px 8px;">Date</th>
              <th style="padding:6px 8px;">Pharmacist</th>
            </tr>
          </thead>
          <tbody>
            ${list
              .map(
                (r) => `
              <tr style="border-bottom:1px solid #DEDAE9;">
                <td style="padding:6px 8px;">${escapeHtml(`${r.firstName} ${r.lastName}`)}</td>
                <td style="padding:6px 8px;">${escapeHtml(r.dateOfBirth)}</td>
                <td style="padding:6px 8px;">${escapeHtml(r.serviceName)}</td>
                <td style="padding:6px 8px;">${escapeHtml(
                  [r.productName, r.batchNumber].filter(Boolean).join(' — ') || '—',
                )}</td>
                <td style="padding:6px 8px;">${escapeHtml(longDate(r.completedAt))}</td>
                <td style="padding:6px 8px;">${escapeHtml(
                  r.clinicianName
                    ? `${r.clinicianName}${r.gphcNumber ? ` (${r.gphcNumber})` : ''}`
                    : '—',
                )}</td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>
        <p style="margin-top:16px;color:#544D6B;">
          Please add these to the patients' records. Reply to this email with any queries.
        </p>`;

      await queueNotification({
        organisationId: actor.organisationId,
        channel: 'EMAIL',
        recipient: email,
        template: isResend ? 'gp_notification_resend' : 'gp_notification',
        subject: `${heading} — ${list.length} patient${list.length === 1 ? '' : 's'}`,
        body,
        entityType: 'gp_surgery',
        entityId: null,
      });

      for (const r of list) sentIds.push(r.id);
    }

    if (sentIds.length > 0) {
      await tx
        .update(consultation)
        .set({
          gpNotifiedAt: new Date(),
          gpNotifyCount: sql`${consultation.gpNotifyCount} + 1`,
        })
        .where(inArray(consultation.id, sentIds));
    }

    return {
      result: {
        queued: sentIds.length,
        practices: bySurgery.size,
        unroutable,
      },
      audit: {
        action: 'gp.notified',
        entityType: 'consultation',
        entityId: null,
        after: { count: sentIds.length, practices: bySurgery.size },
      },
    };
  },
);

export async function sendToGp(consultationIds: string[]) {
  try {
    const result = await send({ consultationIds });
    revalidatePath('/communications');
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('sendToGp failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.name === 'AuthorisationError'
            ? 'You do not have permission to send to GP practices.'
            : error.message
          : 'Could not send those records.',
    };
  }
}
