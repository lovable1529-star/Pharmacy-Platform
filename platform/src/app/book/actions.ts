'use server';

/**
 * Public booking.
 *
 * Like the public form, there is no signed-in user here, so this does not go
 * through the scoped action wrapper. It is narrow instead: it takes a service, a
 * branch and a time, and can do nothing else.
 *
 * The important detail is that the slot is re-checked INSIDE the transaction
 * against freshly read bookings. The list of free slots the patient saw is a
 * snapshot from a moment ago, and two people looking at the same last slot is
 * exactly the case that produces a double booking otherwise.
 */

import { and, eq, gte, lte, isNull, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  appointment, availability, branch, company, service, auditEvent,
} from '@/lib/db/schema';
import { buildFormUrl } from '@/lib/forms/draft';
import { createBooking } from '@/lib/scheduling/book';
import { sealAuditEntry } from '@/lib/audit';
import {
  generateSlotsForRange,
  type AvailabilityWindow, type ExistingBooking,
} from '@/lib/scheduling/slots';
import { bookingConfirmation } from '@/lib/email/patient';
import { sendPatientEmail } from '@/lib/email/patient';

/** Nothing inside the next two hours — the pharmacy needs notice. */
const LEAD_TIME_MINUTES = 120;

export interface BookingOption {
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  estimatedMinutes: number | null;
}

export interface BranchOption {
  id: string;
  name: string;
  code: string;
  town: string | null;
  postcode: string | null;
}

export interface DaySlots {
  date: string;
  slots: { startsAt: string; endsAt: string }[];
}

/** Everything the booking page needs to render, in one round trip. */
export async function getBookingOptions(): Promise<{
  services: BookingOption[];
  branches: BranchOption[];
}> {
  const services = await db
    .select({
      serviceId: service.id,
      serviceName: service.name,
      serviceSlug: service.slug,
    })
    .from(service)
    .where(isNull(service.archivedAt));

  const branches = await db
    .select({
      id: branch.id,
      name: branch.name,
      code: branch.code,
      town: branch.town,
      postcode: branch.postcode,
    })
    .from(branch)
    .where(isNull(branch.archivedAt));

  return {
    services: services.map((s) => ({ ...s, estimatedMinutes: null })),
    branches,
  };
}

async function loadWindows(branchId: string): Promise<AvailabilityWindow[]> {
  const rows = await db
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

async function loadBookings(branchId: string, from: Date, to: Date): Promise<ExistingBooking[]> {
  const rows = await db
    .select({
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      branchId: appointment.branchId,
      cancelledAt: appointment.cancelledAt,
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
    cancelled: r.cancelledAt !== null,
  }));
}

export async function getAvailableSlots(
  branchId: string,
  serviceId: string,
  fromIso: string,
  days = 14,
): Promise<DaySlots[]> {

  const from = new Date(fromIso);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + days);

  const [windows, bookings] = await Promise.all([
    loadWindows(branchId),
    loadBookings(branchId, from, to),
  ]);

  return generateSlotsForRange({
    windows, bookings, from, days, branchId, serviceId,
    leadTimeMinutes: LEAD_TIME_MINUTES,
  }).map((day) => ({
    date: day.date,
    slots: day.slots.map((s) => ({
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
    })),
  }));
}

export interface BookInput {
  serviceId: string;
  branchId: string;
  startsAt: string;
  name: string;
  email: string;
  phone: string;
}

export interface BookResult {
  ok: boolean;
  reference?: string;
  formUrl?: string;
  error?: string;
}

export async function bookAppointment(input: BookInput): Promise<BookResult> {
  if (!input.name.trim()) return { ok: false, error: 'Please give your name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return { ok: false, error: 'Please give an email address we can send your confirmation to.' };
  }

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return { ok: false, error: 'That appointment time is not valid.' };
  }

  try {
    const context = await db
      .select({
        serviceName: service.name,
        serviceSlug: service.slug,
        organisationId: service.organisationId,
        publishedFormVersionId: service.publishedFormVersionId,
        branchName: branch.name,
        branchCode: branch.code,
        branchAddress: branch.addressLine1,
        branchTown: branch.town,
        branchPostcode: branch.postcode,
        branchPhone: branch.phone,
        companyId: company.id,
      })
      .from(service)
      .innerJoin(branch, eq(branch.id, input.branchId))
      .innerJoin(company, eq(branch.companyId, company.id))
      .where(eq(service.id, input.serviceId))
      .limit(1);

    const ctx = context[0];
    if (!ctx) return { ok: false, error: 'That service is not available at this branch.' };

    const result = await db.transaction(async (tx) => {
      // The shared booking core: slot re-check inside the transaction, the
      // appointment row, and the questionnaire draft. Identical to what the
      // counter runs, so the two paths cannot drift apart.
      const outcome = await createBooking(tx, {
        organisationId: ctx.organisationId,
        branchId: input.branchId,
        serviceId: input.serviceId,
        startsAt,
        name: input.name,
        email: input.email,
        phone: input.phone,
        leadTimeMinutes: LEAD_TIME_MINUTES,
      });

      if (!outcome.ok) return { conflict: outcome.reason };

      const previous = await tx
        .select({ hash: auditEvent.hash })
        .from(auditEvent)
        .where(eq(auditEvent.organisationId, ctx.organisationId))
        .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
        .limit(1);

      const sealed = sealAuditEntry(
        {
          organisationId: ctx.organisationId,
          userId: null,
          branchId: input.branchId,
          action: 'appointment.booked',
          entityType: 'appointment',
          entityId: outcome.booking.id,
          after: {
            reference: outcome.booking.reference,
            startsAt: startsAt.toISOString(),
            serviceId: input.serviceId,
            bookedBy: 'patient',
          },
        },
        {
          id: crypto.randomUUID(),
          occurredAt: new Date(),
          previousHash: previous[0]?.hash ?? null,
        },
      );

      await tx.insert(auditEvent).values({
        id: sealed.id,
        organisationId: sealed.organisationId,
        branchId: sealed.branchId ?? null,
        action: sealed.action,
        entityType: sealed.entityType,
        entityId: sealed.entityId ?? null,
        after: sealed.after ?? null,
        previousHash: sealed.previousHash,
        hash: sealed.hash,
        occurredAt: sealed.occurredAt,
      });

      return {
        reference: outcome.booking.reference,
        resumeToken: outcome.booking.resumeToken,
      };
    });

    if ('conflict' in result) return { ok: false, error: result.conflict };

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100';

    // The token, never the reference. ONC-3JBX4 is printed on the confirmation
    // and read out over the phone; if it also unlocked the questionnaire, every
    // receipt would be a key to someone's medical answers.
    const formUrl = result.resumeToken
      ? buildFormUrl(appUrl, ctx.serviceSlug, result.resumeToken)
      : `${appUrl}/f/${ctx.serviceSlug}`;

    // Confirmation is best-effort — a booking that saved must not be reported as
    // failed because a mail server was slow.
    void sendPatientEmail(
      input.email.trim(),
      bookingConfirmation({
        patientName: input.name.trim(),
        serviceName: ctx.serviceName,
        startsAt,
        reference: result.reference!,
        branch: {
          name: ctx.branchName,
          addressLine1: ctx.branchAddress,
          town: ctx.branchTown,
          postcode: ctx.branchPostcode,
          phone: ctx.branchPhone,
        },
        formUrl,
      }),
    ).catch((error) => console.error('[book] confirmation email failed', error));

    return { ok: true, reference: result.reference, formUrl };
  } catch (error) {
    console.error('bookAppointment failed', error);
    return { ok: false, error: 'We could not save that booking. Please try again, or call us.' };
  }
}
