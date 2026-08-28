/**
 * Appointments.
 *
 * One calendar across every service — his GLP-1 specification requires
 * repeat-care appointments to share the vaccination calendar, so per-service
 * calendars were never an option.
 *
 * Scoped to the branch you are working from, because that is the list a
 * pharmacist standing at Onchan actually needs.
 *
 * The questionnaire's real state is carried through to the counter. "Has a
 * submission row" is not the same as "has answered": an appointment booked
 * online creates the draft immediately, so existence alone would mark every new
 * booking as complete. What staff need to know is whether the patient has
 * STARTED, FINISHED, and what the triage said.
 */

import { and, eq, gte, lte, ne } from 'drizzle-orm';
import { getStaffContext } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import {
  appointment, service, patient, submission, ruleEvaluation,
} from '@/lib/db/schema';
import { AppointmentsView } from './appointments-view';

export const dynamic = 'force-dynamic';

export default async function AppointmentsPage() {
  const { actor, activeBranch } = await getStaffContext();

  if (!activeBranch) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">No branch available</h1>
        <p className="text-[14px] text-ink-soft">
          You do not currently hold access at any branch.
        </p>
      </div>
    );
  }

  // Yesterday onward: someone looking at the list at 9am still needs to see the
  // patient who did not attend yesterday afternoon.
  const from = new Date(Date.now() - 24 * 60 * 60_000);
  const to = new Date(Date.now() + 14 * 24 * 60 * 60_000);

  const rows = await db
    .select({
      id: appointment.id,
      reference: appointment.reference,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      bookedName: appointment.bookedName,
      bookedEmail: appointment.bookedEmail,
      bookedPhone: appointment.bookedPhone,
      serviceName: service.name,
      serviceSlug: service.slug,
      submissionId: appointment.submissionId,
      submissionStatus: submission.status,
      resumeToken: submission.resumeToken,
      answers: submission.answers,
      outcome: ruleEvaluation.outcome,
      patientId: appointment.patientId,
      patientFirstName: patient.firstName,
      patientLastName: patient.lastName,
      consultationId: appointment.consultationId,
    })
    .from(appointment)
    .innerJoin(service, eq(appointment.serviceId, service.id))
    .leftJoin(patient, eq(appointment.patientId, patient.id))
    .leftJoin(submission, eq(appointment.submissionId, submission.id))
    .leftJoin(ruleEvaluation, eq(ruleEvaluation.submissionId, submission.id))
    .where(
      and(
        eq(appointment.organisationId, actor.organisationId),
        eq(appointment.branchId, activeBranch.id),
        gte(appointment.startsAt, from),
        lte(appointment.startsAt, to),
        // Cancelled appointments belong in the record, not in today's worklist.
        ne(appointment.status, 'CANCELLED'),
      ),
    )
    .orderBy(appointment.startsAt);

  // An unstarted draft is not "in progress" — the row exists because the
  // booking created it, not because the patient typed anything.
  const view = rows.map((r) => {
    const answers = (r.answers ?? {}) as Record<string, unknown>;
    const touched = Object.keys(answers).filter((k) => k !== '_metadata').length > 0;

    return {
      ...r,
      formState:
        r.submissionStatus == null
          ? ('none' as const)
          : r.submissionStatus === 'DRAFT'
            ? touched
              ? ('started' as const)
              : ('not-started' as const)
            : ('submitted' as const),
      answers: undefined,
    };
  });

  return (
    <AppointmentsView
      rows={view}
      branchName={activeBranch.name}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100'}
    />
  );
}
