/**
 * Add a patient.
 *
 * Duplicate detection runs before anything is created — a second record for the
 * same person is how allergy history and previous supplies get lost, and it is
 * far cheaper to catch here than to merge later.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getStaffContext } from '@/lib/auth/context';
import { can } from '@/lib/tenancy/scope';
import { db } from '@/lib/db/client';
import { gpSurgery, submission, appointment } from '@/lib/db/schema';
import { getPatients } from '@/lib/queries/clinical';
import { splitName } from '@/lib/patients/name';
import { NewPatientForm } from './new-patient-form';

export const dynamic = 'force-dynamic';

export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const { actor, activeBranch } = await getStaffContext();

  if (!can(actor, 'patients:edit')) {
    return (
      <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
        <h1 className="mb-2 text-[20px] text-ink">Not available to you</h1>
        <p className="text-[14px] text-ink-soft">Adding a patient needs write access.</p>
      </div>
    );
  }

  const [surgeries, existing] = await Promise.all([
    db
      .select({ id: gpSurgery.id, name: gpSurgery.name })
      .from(gpSurgery)
      .where(and(eq(gpSurgery.organisationId, actor.organisationId), isNull(gpSurgery.archivedAt))),
    getPatients(actor.organisationId),
  ]);

  /*
   * Pre-fill from whatever we already hold.
   *
   * A receptionist adding a patient on somebody else's behalf does not know
   * what that person typed into their form, and asking them to guess is how
   * duplicates get made. Everything known is taken from the questionnaire
   * first, then from the booking, and the receptionist corrects rather than
   * invents.
   */
  const prefill = params.from
    ? await getPrefillFor(actor.organisationId, params.from)
    : null;

  return (
    <NewPatientForm
      surgeries={surgeries}
      linkSubmissionId={params.from ?? null}
      prefill={prefill}
      branchId={activeBranch?.id ?? null}
      companyId={activeBranch?.companyId ?? null}
      existing={existing.map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: p.dateOfBirth,
        postcode: p.postcode,
        phone: p.phone,
      }))}
    />
  );
}

/** Everything already known about the person this form belongs to. */
async function getPrefillFor(organisationId: string, submissionId: string) {
  const [row] = await db
    .select({
      answers: submission.answers,
      bookedName: appointment.bookedName,
      bookedEmail: appointment.bookedEmail,
      bookedPhone: appointment.bookedPhone,
    })
    .from(submission)
    .leftJoin(appointment, eq(appointment.submissionId, submission.id))
    .where(
      and(
        eq(submission.id, submissionId),
        eq(submission.organisationId, organisationId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const answers = (row.answers ?? {}) as Record<string, unknown>;
  const text = (key: string) => {
    const value = answers[key];
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  };

  // The form's own answers win: a patient writing their own name is better
  // information than the name somebody typed when booking for them.
  const booked = row.bookedName ? splitName(row.bookedName) : null;

  return {
    firstName: text('firstName') || booked?.firstName || '',
    lastName: text('lastName') || booked?.lastName || '',
    dateOfBirth: text('dateOfBirth'),
    phone: text('phone') || row.bookedPhone || '',
    email: text('email') || row.bookedEmail || '',
    addressLine1: text('address') || text('addressLine1'),
    town: text('town'),
    postcode: text('postcode'),
  };
}
