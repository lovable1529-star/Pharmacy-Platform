'use server';

/**
 * Withdrawing a service.
 *
 * Presented to staff as removing it, and implemented as archiving, because
 * fourteen tables point at a service and most of them are clinical. Deleting
 * one would either be refused by the database or destroy the record of care
 * that was given through it. See `lib/services/archive.ts` for the reasoning.
 *
 * Two steps on purpose. `getServiceUsage` is a read that tells the person what
 * they are about to do; `archiveService` does it. The counts are taken again
 * inside the write, because the dialog may have been open for a while and a
 * request can arrive in that time.
 */

import { and, count, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { action, query } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { db } from '@/lib/db/client';
import {
  service, submission, prescription, repeatEnrolment, appointment,
} from '@/lib/db/schema';
import { canArchiveService, type ServiceUsage } from '@/lib/services/archive';

/** Statuses that mean somebody is still waiting on a person. */
const OPEN_SUBMISSION = ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED', 'RESUBMITTED'] as const;
/** Raised, but the medicine has not reached the patient. */
const OPEN_PRESCRIPTION = ['PENDING_PAYMENT', 'ISSUED', 'DISPENSED'] as const;

async function countUsage(organisationId: string, serviceId: string): Promise<ServiceUsage> {
  const scope = and(
    eq(submission.serviceId, serviceId),
    eq(submission.organisationId, organisationId),
  );

  const [open, total, rx, enrolled, booked] = await Promise.all([
    db.select({ n: count() }).from(submission)
      .where(and(scope, inArray(submission.status, [...OPEN_SUBMISSION]))),
    db.select({ n: count() }).from(submission)
      .where(and(scope, ne(submission.status, 'DRAFT'))),
    db.select({ n: count() }).from(prescription)
      .innerJoin(submission, eq(prescription.submissionId, submission.id))
      .where(and(scope, inArray(prescription.status, [...OPEN_PRESCRIPTION]))),
    db.select({ n: count() }).from(repeatEnrolment)
      .where(and(
        eq(repeatEnrolment.serviceId, serviceId),
        eq(repeatEnrolment.organisationId, organisationId),
        eq(repeatEnrolment.status, 'ACTIVE'),
      )),
    db.select({ n: count() }).from(appointment)
      .where(and(
        eq(appointment.serviceId, serviceId),
        eq(appointment.organisationId, organisationId),
        gt(appointment.startsAt, new Date()),
        ne(appointment.status, 'CANCELLED'),
      )),
  ]);

  return {
    openSubmissions: open[0]?.n ?? 0,
    totalSubmissions: total[0]?.n ?? 0,
    openPrescriptions: rx[0]?.n ?? 0,
    activeEnrolments: enrolled[0]?.n ?? 0,
    futureAppointments: booked[0]?.n ?? 0,
  };
}

export interface ServiceArchivePreview {
  serviceName: string;
  usage: ServiceUsage;
  can: boolean;
  blockers: string[];
  consequences: string[];
}

/** What archiving this service would mean. Read-only — changes nothing. */
export async function getServiceUsage(
  serviceId: string,
): Promise<ServiceArchivePreview | null> {
  const read = query<{ serviceId: string }>('services:view')
    .scopedTo(() => ({}))
    .handler(async (input, { actor }) => {
      const [row] = await db
        .select({ name: service.name })
        .from(service)
        .where(and(
          eq(service.id, input.serviceId),
          eq(service.organisationId, actor.organisationId),
        ))
        .limit(1);

      if (!row) return null;

      const usage = await countUsage(actor.organisationId, input.serviceId);
      const verdict = canArchiveService(usage);

      return { serviceName: row.name, usage, ...verdict } satisfies ServiceArchivePreview;
    });

  try {
    return await read({ serviceId });
  } catch (error) {
    console.error('getServiceUsage failed', error);
    return null;
  }
}

export interface ArchiveServiceInput {
  serviceId: string;
  /** The typed service name. Guards against archiving the wrong row. */
  confirmation: string;
}

const archive = action<ArchiveServiceInput>('services:delete').handler(
  async (input, { tx, actor }) => {
    const [row] = await tx
      .select({ id: service.id, name: service.name, archivedAt: service.archivedAt })
      .from(service)
      .where(and(
        eq(service.id, input.serviceId),
        eq(service.organisationId, actor.organisationId),
      ))
      .limit(1);

    if (!row) throw new Error('That service no longer exists.');

    // Already archived is not an error — two people clicking, or one clicking
    // twice, should leave one archived service and no complaint.
    if (row.archivedAt) {
      return {
        result: { name: row.name, alreadyArchived: true },
        audit: {
          action: 'service.archive_noop',
          entityType: 'service',
          entityId: row.id,
          after: { archivedAt: row.archivedAt },
        },
      };
    }

    /*
     * Names must match. The dialog can be left open while somebody else works,
     * and this is the difference between withdrawing the service you meant and
     * withdrawing the one above it in the list.
     */
    if (input.confirmation.trim().toLowerCase() !== row.name.trim().toLowerCase()) {
      throw new Error('The name did not match. Type the service name exactly to confirm.');
    }

    /*
     * Counted again here, not trusted from the dialog. A request can arrive
     * between reading the preview and pressing the button, and archiving would
     * strand it.
     */
    const usage = await countUsage(actor.organisationId, input.serviceId);
    const verdict = canArchiveService(usage);

    if (!verdict.can) throw new Error(verdict.blockers.join(' '));

    await tx
      .update(service)
      .set({ archivedAt: new Date() })
      .where(and(
        eq(service.id, input.serviceId),
        eq(service.organisationId, actor.organisationId),
        // Archive only what is still live, so a concurrent click cannot move
        // the timestamp somebody else already set.
        isNull(service.archivedAt),
      ));

    return {
      result: { name: row.name, alreadyArchived: false },
      audit: {
        action: 'service.archived',
        entityType: 'service',
        entityId: row.id,
        before: { archivedAt: null },
        after: { archivedAt: new Date().toISOString(), usageAtArchive: usage },
      },
    };
  },
);

export async function archiveService(input: ArchiveServiceInput) {
  if (!input.confirmation.trim()) {
    return { ok: false as const, error: 'Type the service name to confirm.' };
  }

  try {
    const result = await archive(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('archiveService failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'Removing a service needs administrator access.'
          : error instanceof Error
            ? error.message
            : 'Could not remove that service.',
    };
  }
}
