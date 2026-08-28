/**
 * Appointment reminders, and draining the outbox.
 *
 * The reminder template has existed since the first build and nothing ever
 * called it. Reminders are the single biggest lever on did-not-attend rates,
 * and a pharmacy that books a fortnight ahead without one will have empty
 * slots — so this is a revenue feature as much as a courtesy.
 *
 * Two jobs in one pass, because they belong to the same clock:
 *
 *   1. Queue a reminder for anything happening tomorrow that has not had one.
 *   2. Send whatever is due, whichever channel it goes by.
 *
 * `reminderSentAt` is stamped when the message is QUEUED, not when it is sent.
 * That is deliberate: if the send fails the outbox retries it, and stamping on
 * success instead would let a second run queue a duplicate in the meantime.
 * One reminder that failed and is retrying beats two that arrived.
 */

import { NextResponse } from 'next/server';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { appointment, branch, service, submission } from '@/lib/db/schema';
import { buildFormUrl } from '@/lib/forms/draft';
import { appointmentReminder } from '@/lib/email/patient';
import { queueNotification, drainOutbox } from '@/lib/notifications/outbox';
import { isAuthorisedCron } from '@/lib/cron/guard';
import { PHARMACY_TIMEZONE } from '@/lib/scheduling/slots';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** How far ahead a reminder goes out. */
const LEAD_HOURS = 24;

function shortWhen(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: PHARMACY_TIMEZONE,
  }).format(date);
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + LEAD_HOURS * 60 * 60_000);

  const due = await db
    .select({
      id: appointment.id,
      organisationId: appointment.organisationId,
      reference: appointment.reference,
      startsAt: appointment.startsAt,
      bookedName: appointment.bookedName,
      bookedEmail: appointment.bookedEmail,
      bookedPhone: appointment.bookedPhone,
      serviceName: service.name,
      branchName: branch.name,
      addressLine1: branch.addressLine1,
      town: branch.town,
      postcode: branch.postcode,
      phone: branch.phone,
      serviceSlug: service.slug,
      submissionStatus: submission.status,
      resumeToken: submission.resumeToken,
    })
    .from(appointment)
    .innerJoin(service, eq(appointment.serviceId, service.id))
    .innerJoin(branch, eq(appointment.branchId, branch.id))
    .leftJoin(submission, eq(appointment.submissionId, submission.id))
    .where(
      and(
        eq(appointment.status, 'BOOKED'),
        isNull(appointment.reminderSentAt),
        gte(appointment.startsAt, now),
        lte(appointment.startsAt, windowEnd),
      ),
    )
    .limit(200);

  let queued = 0;
  let skipped = 0;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100';

  for (const row of due) {
    // A reminder that also nudges an unfinished form is worth far more than one
    // that only restates the time — it is the last chance to have the
    // questionnaire done before they are standing at the counter.
    const formCompleted =
      row.submissionStatus != null && row.submissionStatus !== 'DRAFT';

    const formUrl =
      !formCompleted && row.resumeToken
        ? buildFormUrl(appUrl, row.serviceSlug, row.resumeToken)
        : null;

    const message = appointmentReminder({
      patientName: row.bookedName,
      serviceName: row.serviceName,
      startsAt: row.startsAt,
      formCompleted,
      formUrl,
      branch: {
        name: row.branchName,
        addressLine1: row.addressLine1,
        town: row.town,
        postcode: row.postcode,
        phone: row.phone,
      },
    });

    let any = false;

    if (row.bookedEmail) {
      await queueNotification({
        organisationId: row.organisationId,
        channel: 'EMAIL',
        recipient: row.bookedEmail,
        template: 'appointment_reminder',
        subject: message.subject,
        body: message.html,
        entityType: 'appointment',
        entityId: row.id,
      });
      any = true;
    }

    // SMS goes out too where there is a number. It queues as UNAVAILABLE until
    // Twilio is configured, which keeps it visible rather than silently absent
    // — and an older patient population is exactly who a text reaches and an
    // email does not.
    if (row.bookedPhone) {
      await queueNotification({
        organisationId: row.organisationId,
        channel: 'SMS',
        recipient: row.bookedPhone,
        template: 'appointment_reminder',
        body:
          `Karsons Pharmacy: your ${row.serviceName} appointment is ${shortWhen(row.startsAt)} ` +
          `at ${row.branchName}. Ref ${row.reference}.` +
          (formUrl ? ` Please finish your form first: ${formUrl}` : '') +
          ` Call ${row.phone ?? 'the pharmacy'} to change it.`,
        entityType: 'appointment',
        entityId: row.id,
      });
      any = true;
    }

    if (!any) {
      skipped += 1;
      continue;
    }

    // Stamped on QUEUE, not on send — see the note at the top.
    await db
      .update(appointment)
      .set({ reminderSentAt: new Date() })
      .where(eq(appointment.id, row.id));

    queued += 1;
  }

  const delivery = await drainOutbox(100);

  return NextResponse.json({
    reminders: { considered: due.length, queued, skippedNoContact: skipped },
    delivery,
  });
}
