/**
 * Creating a booking.
 *
 * Shared by the public booking page and the staff counter, because the two must
 * not drift. If the website creates a questionnaire draft and the counter does
 * not, then whether a patient can fill their form in advance depends on who
 * happened to book it — which is the kind of inconsistency that takes months to
 * notice and is miserable to explain.
 *
 * The differences between the two callers are passed in, not forked:
 *
 *   leadTimeMinutes  patients need notice; staff booking someone standing in
 *                    front of them do not.
 *   patientId        the counter usually knows who this is already.
 *
 * The caller supplies the transaction. The slot re-check happens INSIDE it,
 * against freshly read bookings, because the list of free slots on screen is
 * always a snapshot from a moment ago.
 */

import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import {
  appointment, availability, branch, company, service, submission,
} from '@/lib/db/schema';
import { generateResumeToken, resumeExpiry } from '@/lib/forms/draft';
import {
  buildAppointmentReference, isSlotBookable, localWeekdayOf,
  type AvailabilityWindow, type ExistingBooking,
} from './slots';

export interface CreateBookingInput {
  organisationId: string;
  branchId: string;
  serviceId: string;
  startsAt: Date;
  name: string;
  email: string | null;
  phone: string | null;
  patientId?: string | null;
  notes?: string | null;
  leadTimeMinutes: number;
}

export interface CreatedBooking {
  id: string;
  reference: string;
  resumeToken: string | null;
  serviceSlug: string;
  serviceName: string;
  branch: {
    name: string;
    addressLine1: string | null;
    town: string | null;
    postcode: string | null;
    phone: string | null;
  };
}

export type BookingOutcome =
  | { ok: true; booking: CreatedBooking }
  | { ok: false; reason: string };

async function loadWindows(tx: Tx, branchId: string): Promise<AvailabilityWindow[]> {
  const rows = await tx
    .select()
    .from(availability)
    .where(and(eq(availability.branchId, branchId), isNull(availability.archivedAt)));

  return rows.map((r) => ({
    id: r.id,
    branchId: r.branchId,
    serviceId: r.serviceId,
    weekday: r.weekday,
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    slotMinutes: r.slotMinutes,
    capacity: r.capacity,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
  }));
}

async function loadBookings(
  tx: Tx,
  branchId: string,
  around: Date,
): Promise<ExistingBooking[]> {
  // A day either side, in absolute time. Deriving the boundary with setHours()
  // would use the server's zone, which on a UTC+5:30 machine cuts the pharmacy's
  // afternoon in half and silently drops real bookings from the conflict check.
  const from = new Date(around.getTime() - 24 * 60 * 60_000);
  const to = new Date(around.getTime() + 24 * 60 * 60_000);

  const rows = await tx
    .select({
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      branchId: appointment.branchId,
      status: appointment.status,
    })
    .from(appointment)
    .where(
      and(
        eq(appointment.branchId, branchId),
        gte(appointment.startsAt, from),
        lte(appointment.startsAt, to),
      ),
    );

  return rows.map((r) => ({
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    branchId: r.branchId,
    cancelled: r.status === 'CANCELLED',
  }));
}

export async function createBooking(
  tx: Tx,
  input: CreateBookingInput,
): Promise<BookingOutcome> {
  const [ctx] = await tx
    .select({
      serviceName: service.name,
      serviceSlug: service.slug,
      publishedFormVersionId: service.publishedFormVersionId,
      branchName: branch.name,
      branchCode: branch.code,
      addressLine1: branch.addressLine1,
      town: branch.town,
      postcode: branch.postcode,
      branchPhone: branch.phone,
      companyId: company.id,
    })
    .from(service)
    .innerJoin(branch, eq(branch.id, input.branchId))
    .innerJoin(company, eq(branch.companyId, company.id))
    .where(eq(service.id, input.serviceId))
    .limit(1);

  if (!ctx) return { ok: false, reason: 'That service is not available at this branch.' };

  const [windows, bookings] = await Promise.all([
    loadWindows(tx, input.branchId),
    loadBookings(tx, input.branchId, input.startsAt),
  ]);

  const check = isSlotBookable({
    windows,
    bookings,
    startsAt: input.startsAt,
    branchId: input.branchId,
    serviceId: input.serviceId,
    leadTimeMinutes: input.leadTimeMinutes,
  });

  if (!check.ok) return { ok: false, reason: check.reason };

  const window = windows.find((w) => w.weekday === localWeekdayOf(input.startsAt));
  const endsAt = new Date(
    input.startsAt.getTime() + (window?.slotMinutes ?? 15) * 60_000,
  );

  const id = crypto.randomUUID();
  const reference = buildAppointmentReference(ctx.branchCode, id);

  const [created] = await tx
    .insert(appointment)
    .values({
      id,
      organisationId: input.organisationId,
      companyId: ctx.companyId,
      branchId: input.branchId,
      serviceId: input.serviceId,
      patientId: input.patientId ?? null,
      startsAt: input.startsAt,
      endsAt,
      bookedName: input.name.trim(),
      bookedEmail: input.email?.trim() || null,
      bookedPhone: input.phone?.trim() || null,
      notes: input.notes?.trim() || null,
      reference,
    })
    .returning({ id: appointment.id });

  if (!created) return { ok: false, reason: 'Could not save that booking.' };

  // The questionnaire draft is created NOW, not when the patient first opens
  // the link. That is what makes "resume where you left off" possible at all,
  // and what lets the counter see "part done" instead of a blank.
  let resumeToken: string | null = null;

  if (ctx.publishedFormVersionId) {
    resumeToken = generateResumeToken();

    const [draft] = await tx
      .insert(submission)
      .values({
        organisationId: input.organisationId,
        serviceId: input.serviceId,
        formVersionId: ctx.publishedFormVersionId,
        patientId: input.patientId ?? null,
        branchId: input.branchId,
        status: 'DRAFT',
        answers: {},
        derived: {},
        resumeToken,
        resumeExpiresAt: resumeExpiry(),
      })
      .returning({ id: submission.id });

    if (draft) {
      await tx
        .update(appointment)
        .set({ submissionId: draft.id })
        .where(eq(appointment.id, created.id));
    }
  }

  return {
    ok: true,
    booking: {
      id: created.id,
      reference,
      resumeToken,
      serviceSlug: ctx.serviceSlug,
      serviceName: ctx.serviceName,
      branch: {
        name: ctx.branchName,
        addressLine1: ctx.addressLine1,
        town: ctx.town,
        postcode: ctx.postcode,
        phone: ctx.branchPhone,
      },
    },
  };
}
