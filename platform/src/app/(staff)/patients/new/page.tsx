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
import { gpSurgery } from '@/lib/db/schema';
import { getPatients } from '@/lib/queries/clinical';
import { NewPatientForm } from './new-patient-form';

export const dynamic = 'force-dynamic';

export default async function NewPatientPage() {
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

  return (
    <NewPatientForm
      surgeries={surgeries}
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
