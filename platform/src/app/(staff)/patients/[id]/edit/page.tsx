import { eq, and, isNull } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getStaffContext } from '@/lib/auth/context';
import { db } from '@/lib/db/client';
import { patient, gpSurgery } from '@/lib/db/schema';
import { EditPatientForm } from './edit-patient-form';

export const dynamic = 'force-dynamic';

export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { actor } = await getStaffContext();

  const [row] = await db
    .select()
    .from(patient)
    .where(
      and(
        eq(patient.id, id),
        // Scoped to the organisation, so an id from another tenant is a 404
        // rather than a readable record.
        eq(patient.organisationId, actor.organisationId),
      ),
    )
    .limit(1);

  if (!row) notFound();

  const surgeries = await db
    .select({ id: gpSurgery.id, name: gpSurgery.name })
    .from(gpSurgery)
    .where(
      and(
        eq(gpSurgery.organisationId, actor.organisationId),
        isNull(gpSurgery.archivedAt),
      ),
    )
    .orderBy(gpSurgery.name);

  return (
    <div className="mx-auto max-w-[760px] px-6 py-8">
      <Link
        href={`/patients/${row.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2} />
        {row.firstName} {row.lastName}
      </Link>

      <h1 className="text-[28px] leading-tight text-ink">Edit patient details</h1>
      <p className="mb-6 mt-1 text-[14px] text-ink-faint">
        Changes are recorded in the audit log with the previous value.
      </p>

      <EditPatientForm
        patient={{
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          dateOfBirth: row.dateOfBirth,
          gender: row.gender,
          genderSelfDescribed: row.genderSelfDescribed,
          phone: row.phone,
          email: row.email,
          addressLine1: row.addressLine1,
          town: row.town,
          postcode: row.postcode,
          gpSurgeryId: row.gpSurgeryId,
        }}
        surgeries={surgeries}
      />
    </div>
  );
}
