/**
 * The appointment calendar — §14.
 *
 * The view and the anchor date come from the URL, so a particular week is a
 * link somebody can send. Holding them in component state instead would make
 * "look at the 14th with me" impossible to say.
 */

import { and, eq, gte, lt } from 'drizzle-orm';
import { getStaffContext } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import { appointment, service, patient, branch } from '@/lib/db/schema';
import { buildCalendar, type CalendarScale } from '@/lib/scheduling/calendar';
import { CalendarView } from './calendar-view';

export const dynamic = 'force-dynamic';

function readScale(value: string | undefined): CalendarScale {
  return value === 'week' || value === 'day' ? value : 'month';
}

function readAnchor(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(`${value}T12:00:00`);
  // Midday, so a parsed date cannot land on the wrong side of midnight when
  // the offset is applied.
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ scale?: string; on?: string }>;
}) {
  const params = await searchParams;
  const { actor, activeBranch } = await getStaffContext();

  const scale = readScale(params.scale);
  const anchor = readAnchor(params.on);
  const { from, to, days } = buildCalendar(scale, anchor);

  /*
   * The query covers the whole grid, including the days a month view borrows
   * from its neighbours. Stopping at the month boundary would leave a Monday
   * looking empty when it is not.
   */
  const rows = await db
    .select({
      id: appointment.id,
      reference: appointment.reference,
      startsAt: appointment.startsAt,
      status: appointment.status,
      bookedName: appointment.bookedName,
      serviceName: service.name,
      branchName: branch.name,
      firstName: patient.firstName,
      lastName: patient.lastName,
    })
    .from(appointment)
    .innerJoin(service, eq(appointment.serviceId, service.id))
    .innerJoin(branch, eq(appointment.branchId, branch.id))
    .leftJoin(patient, eq(appointment.patientId, patient.id))
    .where(
      and(
        eq(appointment.organisationId, actor.organisationId),
        activeBranch ? eq(appointment.branchId, activeBranch.id) : undefined,
        gte(appointment.startsAt, from),
        lt(appointment.startsAt, to),
      ),
    )
    .orderBy(appointment.startsAt);

  return (
    <CalendarView
      scale={scale}
      anchor={anchor.toISOString()}
      days={days.map((d) => ({ ...d, date: d.date.toISOString() }))}
      branchName={activeBranch?.name ?? 'All branches'}
      appointments={rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        startsAt: r.startsAt.toISOString(),
        status: r.status,
        name: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : r.bookedName,
        serviceName: r.serviceName,
        branchName: r.branchName,
      }))}
    />
  );
}
