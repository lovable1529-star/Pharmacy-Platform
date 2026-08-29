/**
 * Breaks and closures, for the slot generator — §12.
 *
 * Loaded together because they answer one question: what parts of this period
 * are not bookable. Keeping them apart would mean two round trips for one
 * answer, on a path a patient waits on.
 */

import { and, eq, gte, isNull, lte, or, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { availabilityBreak, scheduleClosure } from '@/lib/db/schema';
import type { Break, Closure } from '@/lib/scheduling/slots';

export interface ScheduleExclusions {
  breaks: Break[];
  closures: Closure[];
}

export async function loadScheduleExclusions(
  organisationId: string,
  options: { branchId?: string | null; from?: string; to?: string } = {},
): Promise<ScheduleExclusions> {
  const branchFilter: SQL | undefined = options.branchId
    ? eq(availabilityBreak.branchId, options.branchId)
    : undefined;

  const closureFilters = [eq(scheduleClosure.organisationId, organisationId)];
  if (options.branchId) {
    // A closure with no branch closes all of them, so it must survive the filter.
    const scoped = or(
      isNull(scheduleClosure.branchId),
      eq(scheduleClosure.branchId, options.branchId),
    );
    if (scoped) closureFilters.push(scoped);
  }
  if (options.from) closureFilters.push(gte(scheduleClosure.closedOn, options.from));
  if (options.to) closureFilters.push(lte(scheduleClosure.closedOn, options.to));

  const [breaks, closures] = await Promise.all([
    db
      .select({
        branchId: availabilityBreak.branchId,
        serviceId: availabilityBreak.serviceId,
        weekday: availabilityBreak.weekday,
        startMinute: availabilityBreak.startMinute,
        endMinute: availabilityBreak.endMinute,
      })
      .from(availabilityBreak)
      .where(and(eq(availabilityBreak.organisationId, organisationId), branchFilter)),
    db
      .select({
        branchId: scheduleClosure.branchId,
        closedOn: scheduleClosure.closedOn,
        startMinute: scheduleClosure.startMinute,
        endMinute: scheduleClosure.endMinute,
      })
      .from(scheduleClosure)
      .where(and(...closureFilters)),
  ]);

  return { breaks, closures };
}
