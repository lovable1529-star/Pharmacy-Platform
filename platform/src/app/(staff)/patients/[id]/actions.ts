'use server';

/**
 * Correcting a patient record.
 *
 * Demographics are wrong more often than anyone expects — a misheard surname on
 * the phone, a transposed date of birth, a patient who has moved house. Without
 * a way to fix them, staff work around the system by creating a second record,
 * and a split medical history is a genuine clinical risk rather than an
 * inconvenience.
 *
 * The BEFORE state is read inside the transaction and written to the audit
 * entry alongside the after. "Someone changed this date of birth" is not a
 * useful answer to a complaint; "it was 1962-03-04, changed to 1962-04-03 by
 * this user at this time" is.
 */

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { patient } from '@/lib/db/schema';

export interface UpdatePatientInput {
  id: string;
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
}

const update = action<UpdatePatientInput>('patients:edit').handler(
  async (input, { tx }) => {
    const [before] = await tx
      .select()
      .from(patient)
      .where(eq(patient.id, input.id))
      .limit(1);

    if (!before) throw new Error('That patient record no longer exists.');
    if (before.archivedAt) throw new Error('That record has been archived.');

    const [after] = await tx
      .update(patient)
      .set({
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
        updatedAt: new Date(),
      })
      .where(eq(patient.id, input.id))
      .returning();

    if (!after) throw new Error('Could not save those changes.');

    // Only what actually changed. An audit log where every entry lists every
    // field is one nobody reads.
    const fields = [
      'firstName', 'lastName', 'dateOfBirth', 'gender', 'genderSelfDescribed',
      'phone', 'email', 'addressLine1', 'town', 'postcode', 'gpSurgeryId',
    ] as const;

    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};

    for (const field of fields) {
      if (before[field] !== after[field]) {
        changedBefore[field] = before[field];
        changedAfter[field] = after[field];
      }
    }

    return {
      result: { id: after.id, changed: Object.keys(changedAfter).length },
      audit: {
        action: 'patient.updated',
        entityType: 'patient',
        entityId: after.id,
        before: changedBefore,
        after: changedAfter,
      },
    };
  },
);

export async function updatePatient(input: UpdatePatientInput) {
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
    const result = await update(input);
    revalidatePath('/patients');
    revalidatePath(`/patients/${input.id}`);
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('updatePatient failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.name === 'AuthorisationError'
            ? 'You do not have permission to change patient records.'
            : error.message
          : 'Could not save those changes.',
    };
  }
}
