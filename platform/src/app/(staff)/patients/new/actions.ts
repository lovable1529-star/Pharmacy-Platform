'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { action } from '@/lib/actions';
import { patient, submission, appointment } from '@/lib/db/schema';

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
  /**
   * The questionnaire that sent the user here, if any.
   *
   * Without it the receptionist created a patient and was returned to the same
   * "no patient record yet" wall, because nothing joined the two — while the
   * screen promised they would be joined up.
   */
  linkSubmissionId?: string | null;
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

    /*
     * Attach the questionnaire and its appointment to the patient just created.
     *
     * Both, because the appointment is what the worklist reads and the
     * submission is what the consultation reads — linking one and not the other
     * moves the dead end rather than removing it.
     *
     * `isNull` on each: if something else has since attached a patient, that
     * one wins. Overwriting it would silently move a consultation onto a
     * different person's record.
     */
    if (input.linkSubmissionId) {
      await tx
        .update(submission)
        .set({ patientId: created.id, updatedAt: new Date() })
        .where(
          and(
            eq(submission.id, input.linkSubmissionId),
            eq(submission.organisationId, actor.organisationId),
            isNull(submission.patientId),
          ),
        );

      await tx
        .update(appointment)
        .set({ patientId: created.id, updatedAt: new Date() })
        .where(
          and(
            eq(appointment.submissionId, input.linkSubmissionId),
            eq(appointment.organisationId, actor.organisationId),
            isNull(appointment.patientId),
          ),
        );
    }

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
