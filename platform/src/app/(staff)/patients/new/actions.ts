'use server';

import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { action } from '@/lib/actions';
import { patient } from '@/lib/db/schema';

export interface NewPatientInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string | null;
  genderSelfDescribed: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  town: string | null;
  postcode: string | null;
  gpSurgeryId: string | null;
  branchId: string | null;
  companyId: string | null;
}

const create = action<NewPatientInput>('patients:edit')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
  .handler(async (input, { tx, actor }) => {
    const [created] = await tx
      .insert(patient)
      .values({
        organisationId: actor.organisationId,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        genderSelfDescribed: input.genderSelfDescribed,
        phone: input.phone,
        email: input.email,
        addressLine1: input.addressLine1,
        town: input.town,
        postcode: input.postcode?.toUpperCase() ?? null,
        gpSurgeryId: input.gpSurgeryId,
        // Recorded for reporting only. Access is never scoped by it — a patient
        // belongs to the organisation and must be findable at either branch.
        registeredBranchId: input.branchId,
      })
      .returning();

    if (!created) throw new Error('Could not create the record.');

    return {
      result: { id: created.id },
      audit: {
        action: 'patient.created',
        entityType: 'patient',
        entityId: created.id,
        after: {
          firstName: created.firstName,
          lastName: created.lastName,
          dateOfBirth: created.dateOfBirth,
        },
      },
    };
  });

export async function createPatient(input: NewPatientInput) {
  if (!input.firstName.trim() || !input.lastName.trim()) {
    return { ok: false as const, error: 'A first and last name are needed.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) {
    return { ok: false as const, error: 'Enter a full date of birth.' };
  }
  if (new Date(input.dateOfBirth) > new Date()) {
    return { ok: false as const, error: 'That date of birth is in the future.' };
  }

  try {
    const result = await create(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('createPatient failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to add patients here.'
          : 'Could not create that record.',
    };
  }
}
