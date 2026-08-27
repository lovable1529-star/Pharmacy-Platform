/**
 * Appointments.
 *
 * One calendar across every service — his GLP-1 specification requires
 * repeat-care appointments to share the vaccination calendar, so per-service
 * calendars were never an option.
 *
 * Scoped to the branch you are working from, because that is the list a
 * pharmacist standing at Onchan actually needs.
 */

import { and, eq, gte, lte } from 'drizzle-orm';
import { getStaffContext } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import { appointment, service, patient } from '@/lib/db/schema';
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

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 14);

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
      submissionId: appointment.submissionId,
      patientFirstName: patient.firstName,
      patientLastName: patient.lastName,
    })
    .from(appointment)
    .innerJoin(service, eq(appointment.serviceId, service.id))
    .leftJoin(patient, eq(appointment.patientId, patient.id))
    .where(
      and(
        eq(appointment.organisationId, actor.organisationId),
        eq(appointment.branchId, activeBranch.id),
        gte(appointment.startsAt, from),
        lte(appointment.startsAt, to),
      ),
    )
    .orderBy(appointment.startsAt);

  return <AppointmentsView rows={rows} branchName={activeBranch.name} />;
}
