'use server';

/**
 * Appointment operations.
 *
 * Everything a receptionist actually does to a booking after it exists:
 * check the patient in, move it, call it off, record that nobody turned up.
 *
 * All of it goes through the scoped, audited action wrapper. These are clinical
 * records — "who moved this appointment and when" is a question that gets asked
 * after a complaint, and the answer cannot be "we don't know".
 */

import { and, eq, gte, isNull, lte, ne } from 'drizzle-orm';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { action } from '@/lib/actions';
import { db } from '@/lib/db/client';
import { appointment, availability, branch, service, submission } from '@/lib/db/schema';
import {
  generateSlotsForRange, isSlotBookable,
  type AvailabilityWindow, type ExistingBooking,
} from '@/lib/scheduling/slots';
import { sendPatientEmail, bookingConfirmation } from '@/lib/email/patient';
import { getStaffContext } from '@/lib/auth/context';
import { createBooking } from '@/lib/scheduling/book';
import { buildFormUrl } from '@/lib/forms/draft';
import { resolveAppUrl } from '@/lib/app-url';
import { loadScheduleExclusions } from '@/lib/queries/schedule';

const LEAD_TIME_MINUTES = 0; // Staff can book right up to the minute; patients cannot.

// ─────────────────────────────────────────────────────────────
// Arrive
// ─────────────────────────────────────────────────────────────

/**
 * Checking a patient in.
 *
 * Small, but it is a clinical event — it is the record that someone attended —
 * so it goes through the same scoped, audited path as everything else rather
 * than being a quiet status update.
 */
const arrive = action<{ appointmentId: string }>('appointments:edit').handler(
  async (input, { tx, actor }) => {
    const [updated] = await tx
      .update(appointment)
      // The clock, not just the flag. Status said THAT they had arrived and
      // never WHEN, so nothing could measure the wait his brief complains about.
      .set({ status: 'ARRIVED', arrivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(appointment.id, input.appointmentId),
      // Scoped to the organisation in the WHERE itself, not by a prior read.
      // §16.1: changing an id in a request must never reach another tenant's
      // record. A predicate on the mutation cannot be forgotten the way a
      // read-then-write guard can.
          eq(appointment.organisationId, actor.organisationId),
          // Do not resurrect a cancelled booking by checking it in.
          ne(appointment.status, 'CANCELLED'),
        ),
      )
      .returning({ id: appointment.id, reference: appointment.reference });

    if (!updated) throw new Error('That appointment is no longer open.');

    return {
      result: { id: updated.id },
      audit: {
        action: 'appointment.arrived',
        entityType: 'appointment',
        entityId: updated.id,
        after: { reference: updated.reference },
      },
    };
  },
);

export async function markArrived(appointmentId: string) {
  try {
    await arrive({ appointmentId });
    revalidateStaffViews();
    return { ok: true as const };
  } catch (error) {
    console.error('markArrived failed', error);
    return { ok: false as const, error: message(error) };
  }
}

// ─────────────────────────────────────────────────────────────
// Did not attend
// ─────────────────────────────────────────────────────────────

const noShow = action<{ appointmentId: string }>('appointments:edit').handler(
  async (input, { tx, actor }) => {
    const [updated] = await tx
      .update(appointment)
      .set({ status: 'DID_NOT_ATTEND', updatedAt: new Date() })
      .where(
        and(
          eq(appointment.id, input.appointmentId),
          eq(appointment.organisationId, actor.organisationId),
        ),
      )
      .returning({ id: appointment.id, reference: appointment.reference });

    if (!updated) throw new Error('That appointment no longer exists.');

    return {
      result: { id: updated.id },
      audit: {
        action: 'appointment.no_show',
        entityType: 'appointment',
        entityId: updated.id,
        after: { reference: updated.reference },
      },
    };
  },
);

export async function markNoShow(appointmentId: string) {
  try {
    await noShow({ appointmentId });
    revalidateStaffViews();
    return { ok: true as const };
  } catch (error) {
    console.error('markNoShow failed', error);
    return { ok: false as const, error: message(error) };
  }
}

// ─────────────────────────────────────────────────────────────
// Cancel
// ─────────────────────────────────────────────────────────────

const cancel = action<{ appointmentId: string; reason: string }>(
  'appointments:delete',
).handler(async (input, { tx, actor }) => {
  const [before] = await tx
    .select({
      status: appointment.status,
      reference: appointment.reference,
      submissionId: appointment.submissionId,
    })
    .from(appointment)
    .where(
      and(
        eq(appointment.id, input.appointmentId),
        eq(appointment.organisationId, actor.organisationId),
      ),
    )
    .limit(1);

  if (!before) throw new Error('That appointment no longer exists.');
  if (before.status === 'COMPLETED') {
    throw new Error('A completed appointment cannot be cancelled.');
  }

  const [updated] = await tx
    .update(appointment)
    .set({
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReason: input.reason.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointment.id, input.appointmentId),
        eq(appointment.organisationId, actor.organisationId),
      ),
    )
    .returning({ id: appointment.id, reference: appointment.reference });

  if (!updated) throw new Error('Could not cancel that appointment.');

  // Kill the questionnaire link. A cancelled appointment must not leave a live
  // URL that still accepts a patient's medical answers.
  if (before.submissionId) {
    await tx
      .update(submission)
      .set({ resumeToken: null, resumeExpiresAt: null })
      .where(
        and(eq(submission.id, before.submissionId), eq(submission.status, 'DRAFT')),
      );
  }

  return {
    result: { id: updated.id },
    audit: {
      action: 'appointment.cancelled',
      entityType: 'appointment',
      entityId: updated.id,
      before: { status: before.status },
      after: { reference: updated.reference, reason: input.reason },
    },
  };
});

export async function cancelAppointment(appointmentId: string, reason: string) {
  try {
    await cancel({ appointmentId, reason });
    revalidateStaffViews();
    return { ok: true as const };
  } catch (error) {
    console.error('cancelAppointment failed', error);
    return { ok: false as const, error: message(error) };
  }
}

// ─────────────────────────────────────────────────────────────
// Reschedule
// ─────────────────────────────────────────────────────────────

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

async function loadBookings(
  branchId: string,
  from: Date,
  to: Date,
): Promise<ExistingBooking[]> {
  const rows = await db
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

export interface DaySlots {
  date: string;
  slots: { startsAt: string; available: boolean }[];
}

/** Free slots for moving an appointment, from today for `days` days. */
export async function getRescheduleSlots(
  appointmentId: string,
  days = 21,
  /** Look at a different branch, for a patient who walked into the wrong shop. */
  branchOverride: string | null = null,
): Promise<{ ok: boolean; days?: DaySlots[]; error?: string }> {
  try {
    const [row] = await db
      .select({
        branchId: appointment.branchId,
        serviceId: appointment.serviceId,
        startsAt: appointment.startsAt,
        organisationId: appointment.organisationId,
      })
      .from(appointment)
      .where(eq(appointment.id, appointmentId))
      .limit(1);

    if (!row) return { ok: false, error: 'That appointment no longer exists.' };

    const branchId = branchOverride ?? row.branchId;
    const movingBranch = branchId !== row.branchId;

    const from = new Date();
    const to = new Date(Date.now() + (days + 1) * 24 * 60 * 60_000);

    const [windows, bookings, exclusions] = await Promise.all([
      loadWindows(branchId),
      loadBookings(branchId, from, to),
      // §12 — a slot inside lunch or on a closed day must not be offered.
      loadScheduleExclusions(row.organisationId, {
        branchId,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      }),
    ]);

    // The slot it currently occupies must appear free — otherwise the booking
    // blocks itself and the patient cannot be moved by fifteen minutes. That
    // only applies at its own branch; elsewhere the slot is somebody else's.
    const others = movingBranch
      ? bookings
      : bookings.filter((b) => b.startsAt.getTime() !== row.startsAt.getTime());

    const generated = generateSlotsForRange({
      windows,
      bookings: others,
      from,
      days,
      branchId,
      serviceId: row.serviceId,
      leadTimeMinutes: LEAD_TIME_MINUTES,
      breaks: exclusions.breaks,
      closures: exclusions.closures,
    });

    return {
      ok: true,
      days: generated
        .filter((d) => d.slots.length > 0)
        .map((d) => ({
          date: d.date,
          slots: d.slots.map((s) => ({
            startsAt: s.startsAt.toISOString(),
            available: s.available,
          })),
        })),
    };
  } catch (error) {
    console.error('getRescheduleSlots failed', error);
    return { ok: false, error: 'Could not load available times.' };
  }
}

const reschedule = action<{
  appointmentId: string;
  startsAt: string;
  notify: boolean;
  /** Moving sites, when a patient turns up at the wrong shop. */
  branchId?: string | null;
}>('appointments:edit').handler(async (input, { tx }) => {
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw new Error('That time is not valid.');

  const [before] = await tx
    .select({
      id: appointment.id,
      branchId: appointment.branchId,
      serviceId: appointment.serviceId,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      reference: appointment.reference,
      bookedName: appointment.bookedName,
      bookedEmail: appointment.bookedEmail,
    })
    .from(appointment)
    .where(eq(appointment.id, input.appointmentId))
    .limit(1);

  if (!before) throw new Error('That appointment no longer exists.');
  if (before.status === 'COMPLETED') {
    throw new Error('A completed appointment cannot be moved.');
  }

  // A patient who books at Onchan and walks into Kirk Michael should be moved,
  // not cancelled and rebooked — cancelling would throw away the questionnaire
  // they have already filled in.
  const targetBranchId = input.branchId ?? before.branchId;

  // Re-check the destination inside the transaction against fresh bookings.
  // The list the receptionist clicked was a snapshot; two people moving
  // patients into the last free slot is exactly how a double booking happens.
  const dayFrom = new Date(startsAt.getTime() - 24 * 60 * 60_000);
  const dayTo = new Date(startsAt.getTime() + 24 * 60 * 60_000);

  const [windows, bookings] = await Promise.all([
    loadWindows(targetBranchId),
    loadBookings(targetBranchId, dayFrom, dayTo),
  ]);

  // Only exclude the appointment's own slot when it is not changing branch —
  // at a different site that slot belongs to somebody else.
  const others =
    targetBranchId === before.branchId
      ? bookings.filter((b) => b.startsAt.getTime() !== before.startsAt.getTime())
      : bookings;

  const check = isSlotBookable({
    windows,
    bookings: others,
    startsAt,
    branchId: targetBranchId,
    serviceId: before.serviceId,
    leadTimeMinutes: LEAD_TIME_MINUTES,
  });

  if (!check.ok) throw new Error(check.reason);

  const durationMs = before.endsAt.getTime() - before.startsAt.getTime();
  const endsAt = new Date(startsAt.getTime() + durationMs);

  const [updated] = await tx
    .update(appointment)
    .set({
      startsAt,
      endsAt,
      branchId: targetBranchId,
      // A moved appointment has not been reminded about at its new time.
      reminderSentAt: null,
      updatedAt: new Date(),
    })
    .where(eq(appointment.id, input.appointmentId))
    .returning({ id: appointment.id });

  if (!updated) throw new Error('Could not move that appointment.');

  return {
    result: {
      id: updated.id,
      email: before.bookedEmail,
      name: before.bookedName,
      reference: before.reference,
      startsAt,
      branchId: targetBranchId,
      serviceId: before.serviceId,
      notify: input.notify,
    },
    audit: {
      action: 'appointment.rescheduled',
      entityType: 'appointment',
      entityId: updated.id,
      before: { startsAt: before.startsAt.toISOString(), branchId: before.branchId },
      after: {
        startsAt: startsAt.toISOString(),
        branchId: targetBranchId,
        reference: before.reference,
      },
    },
  };
});

export async function rescheduleAppointment(
  appointmentId: string,
  startsAt: string,
  notify = true,
  branchId: string | null = null,
) {
  try {
    const moved = await reschedule({ appointmentId, startsAt, notify, branchId });

    if (moved.notify && moved.email) {
      // Best effort. A booking that moved must not be reported as failed
      // because a mail server was slow.
      void (async () => {
        const [ctx] = await db
          .select({
            serviceName: service.name,
            branchName: branch.name,
            addressLine1: branch.addressLine1,
            town: branch.town,
            postcode: branch.postcode,
            phone: branch.phone,
          })
          .from(branch)
          .innerJoin(service, eq(service.id, moved.serviceId))
          .where(eq(branch.id, moved.branchId))
          .limit(1);

        if (!ctx || !moved.email) return;

        await sendPatientEmail(
          moved.email,
          bookingConfirmation({
            patientName: moved.name,
            serviceName: ctx.serviceName,
            startsAt: moved.startsAt,
            reference: moved.reference,
            branch: {
              name: ctx.branchName,
              addressLine1: ctx.addressLine1,
              town: ctx.town,
              postcode: ctx.postcode,
              phone: ctx.phone,
            },
            heading: 'Your appointment has been moved',
          }),
        );
      })();
    }

    revalidateStaffViews();
    return { ok: true as const };
  } catch (error) {
    console.error('rescheduleAppointment failed', error);
    return { ok: false as const, error: message(error) };
  }
}

// ─────────────────────────────────────────────────────────────

function message(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Something went wrong.';
}


// ─────────────────────────────────────────────────────────────
// Booking from the counter
// ─────────────────────────────────────────────────────────────

/**
 * Services bookable at the branch the user is working from.
 *
 * A service with no published form can still be booked — not every service is
 * a questionnaire, and refusing to book a blood pressure check because nobody
 * has designed a form for it would be absurd.
 */
export async function getCounterBookingOptions(): Promise<{
  ok: boolean;
  branchId?: string;
  branchName?: string;
  services?: { id: string; name: string }[];
  error?: string;
}> {
  try {
    const { actor, activeBranch } = await getStaffContext();
    if (!activeBranch) return { ok: false, error: 'You have no branch access.' };

    const rows = await db
      .select({ id: service.id, name: service.name, branchIds: service.branchIds })
      .from(service)
      .where(
        and(
          eq(service.organisationId, actor.organisationId),
          isNull(service.archivedAt),
        ),
      )
      .orderBy(service.name);

    // An empty branchIds means "offered everywhere".
    const offered = rows.filter(
      (r) => r.branchIds.length === 0 || r.branchIds.includes(activeBranch.id),
    );

    return {
      ok: true,
      branchId: activeBranch.id,
      branchName: activeBranch.name,
      services: offered.map((r) => ({ id: r.id, name: r.name })),
    };
  } catch (error) {
    console.error('getCounterBookingOptions failed', error);
    return { ok: false, error: 'Could not load services.' };
  }
}

/** Free slots at the working branch for a service, for the slot picker. */
export async function getCounterSlots(
  serviceId: string,
  days = 21,
): Promise<{ ok: boolean; days?: DaySlots[]; error?: string }> {
  try {
    const { actor, activeBranch } = await getStaffContext();
    if (!activeBranch) return { ok: false, error: 'You have no branch access.' };

    const from = new Date();
    const to = new Date(Date.now() + (days + 1) * 24 * 60 * 60_000);

    const [windows, bookings, exclusions] = await Promise.all([
      loadWindows(activeBranch.id),
      loadBookings(activeBranch.id, from, to),
      loadScheduleExclusions(actor.organisationId, {
        branchId: activeBranch.id,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      }),
    ]);

    const generated = generateSlotsForRange({
      windows, bookings, from, days,
      branchId: activeBranch.id,
      serviceId,
      leadTimeMinutes: LEAD_TIME_MINUTES,
      breaks: exclusions.breaks,
      closures: exclusions.closures,
    });

    return {
      ok: true,
      days: generated
        .filter((d) => d.slots.length > 0)
        .map((d) => ({
          date: d.date,
          slots: d.slots.map((s) => ({
            startsAt: s.startsAt.toISOString(),
            available: s.available,
          })),
        })),
    };
  } catch (error) {
    console.error('getCounterSlots failed', error);
    return { ok: false, error: 'Could not load available times.' };
  }
}

export interface CounterBookingInput {
  serviceId: string;
  branchId: string;
  startsAt: string;
  name: string;
  email: string | null;
  phone: string | null;
  patientId: string | null;
  /** Ignored when an existing patient was chosen; used to create one otherwise. */
  dateOfBirth: string | null;
  notes: string | null;
  sendEmail: boolean;
}

const bookAtCounter = action<CounterBookingInput>('appointments:add')
  .scopedTo((input) => ({ branchId: input.branchId }))
  .handler(async (input, { tx, actor }) => {
    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) throw new Error('That time is not valid.');
    if (!input.name.trim()) throw new Error('Please give a name for the booking.');

    const outcome = await createBooking(tx, {
      organisationId: actor.organisationId,
      branchId: input.branchId,
      serviceId: input.serviceId,
      startsAt,
      name: input.name,
      email: input.email,
      phone: input.phone,
      patientId: input.patientId,
      dateOfBirth: input.dateOfBirth,
      notes: input.notes,
      // Zero, not two hours: staff book people who are standing in front of them.
      leadTimeMinutes: LEAD_TIME_MINUTES,
    });

    if (!outcome.ok) throw new Error(outcome.reason);

    return {
      result: outcome.booking,
      audit: {
        action: 'appointment.booked',
        entityType: 'appointment',
        entityId: outcome.booking.id,
        after: {
          reference: outcome.booking.reference,
          startsAt: startsAt.toISOString(),
          serviceId: input.serviceId,
          bookedBy: 'counter',
        },
      },
    };
  });

export async function bookAtCounterAction(input: CounterBookingInput) {
  try {
    const booking = await bookAtCounter(input);

    if (input.sendEmail && input.email) {
      const appUrl = resolveAppUrl();
      void sendPatientEmail(
        input.email,
        bookingConfirmation({
          patientName: input.name,
          serviceName: booking.serviceName,
          startsAt: new Date(input.startsAt),
          reference: booking.reference,
          branch: booking.branch,
          formUrl: booking.resumeToken
            ? buildFormUrl(appUrl, booking.serviceSlug, booking.resumeToken)
            : null,
        }),
      );
    }

    revalidateStaffViews();
    return { ok: true as const, reference: booking.reference };
  } catch (error) {
    console.error('bookAtCounterAction failed', error);
    return { ok: false as const, error: message(error) };
  }
}
