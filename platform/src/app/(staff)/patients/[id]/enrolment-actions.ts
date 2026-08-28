'use server';

/**
 * Enrolling a patient into Repeat Care.
 *
 * Step one of his GLP-1 workflow, and the piece the system had no concept of:
 * "Pharmacist authorises patient into Repeat Care (baseline record created)."
 *
 * It is a clinical authorisation, not an administrative flag. Enrolling someone
 * says a pharmacist has assessed them and is content for them to request repeat
 * supply online without being seen each time — so it is gated on
 * `repeat_care:edit`, audited, and records who did it.
 *
 * The baseline exists because his decision rules are relative. "Weight loss of
 * at least 2% since last supply", "at least three weeks on the current dose",
 * "no skipping strengths" — none can be evaluated without knowing where the
 * patient started and what they are currently on.
 */

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { db } from '@/lib/db/client';
import { appUser, repeatEnrolment, service } from '@/lib/db/schema';

export interface EnrolmentInput {
  patientId: string;
  serviceId: string;
  externalRef: string | null;
  heightCm: string | null;
  startingWeightKg: string | null;
  startingWaistCm: string | null;
  medicine: string | null;
  strength: string | null;
  strengthSince: string | null;
  notes: string | null;
}

/** Blank strings must become null, not "0", or the rules read a real value. */
function decimal(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null;
}

const save = action<EnrolmentInput>('repeat_care:edit').handler(
  async (input, { tx, actor }) => {
    const values = {
      externalRef: input.externalRef?.trim() || null,
      heightCm: decimal(input.heightCm),
      startingWeightKg: decimal(input.startingWeightKg),
      startingWaistCm: decimal(input.startingWaistCm),
      medicine: input.medicine?.trim() || null,
      strength: input.strength?.trim() || null,
      strengthSince: input.strengthSince?.trim() || null,
      notes: input.notes?.trim() || null,
      updatedAt: new Date(),
    };

    // One enrolment per patient per service. Re-enrolling updates the baseline
    // rather than creating a second one — two baselines would mean the rules
    // silently picking whichever row came back first.
    const [existing] = await tx
      .select({ id: repeatEnrolment.id })
      .from(repeatEnrolment)
      .where(
        and(
          eq(repeatEnrolment.patientId, input.patientId),
          eq(repeatEnrolment.serviceId, input.serviceId),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(repeatEnrolment)
        .set({ ...values, status: 'ACTIVE' })
        .where(eq(repeatEnrolment.id, existing.id));

      return {
        result: { id: existing.id },
        audit: {
          action: 'repeat_care.updated',
          entityType: 'patient',
          entityId: input.patientId,
          after: { serviceId: input.serviceId, ...values },
        },
      };
    }

    const [created] = await tx
      .insert(repeatEnrolment)
      .values({
        organisationId: actor.organisationId,
        patientId: input.patientId,
        serviceId: input.serviceId,
        status: 'ACTIVE',
        enrolledBy: actor.userId,
        ...values,
      })
      .returning({ id: repeatEnrolment.id });

    if (!created) throw new Error('Could not enrol that patient.');

    return {
      result: { id: created.id },
      audit: {
        action: 'repeat_care.enrolled',
        entityType: 'patient',
        entityId: input.patientId,
        after: { serviceId: input.serviceId, ...values },
      },
    };
  },
);

export async function saveEnrolment(input: EnrolmentInput) {
  if (!input.serviceId) {
    return { ok: false as const, error: 'Choose which service to enrol them in.' };
  }

  try {
    await save(input);
    revalidatePath(`/patients/${input.patientId}`);
    return { ok: true as const };
  } catch (error) {
    console.error('saveEnrolment failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.name === 'AuthorisationError'
            ? 'Enrolling a patient into repeat care needs pharmacist access.'
            : error.message
          : 'Could not enrol that patient.',
    };
  }
}

const setStatus = action<{
  patientId: string;
  enrolmentId: string;
  status: 'ACTIVE' | 'PAUSED' | 'STOPPED';
}>('repeat_care:edit').handler(async (input, { tx, actor }) => {
  const [updated] = await tx
    .update(repeatEnrolment)
    .set({ status: input.status, updatedAt: new Date() })
    .where(
      and(
        eq(repeatEnrolment.id, input.enrolmentId),
        eq(repeatEnrolment.organisationId, actor.organisationId),
      ),
    )
    .returning({ id: repeatEnrolment.id });

  if (!updated) throw new Error('That enrolment no longer exists.');

  return {
    result: { id: updated.id },
    audit: {
      // Pausing someone is a clinical decision — they must be seen before the
      // next supply — so it is recorded as one.
      action: `repeat_care.${input.status.toLowerCase()}`,
      entityType: 'patient',
      entityId: input.patientId,
      after: { status: input.status },
    },
  };
});

export async function setEnrolmentStatus(
  patientId: string,
  enrolmentId: string,
  status: 'ACTIVE' | 'PAUSED' | 'STOPPED',
) {
  try {
    await setStatus({ patientId, enrolmentId, status });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true as const };
  } catch (error) {
    console.error('setEnrolmentStatus failed', error);
    return { ok: false as const, error: 'Could not change that enrolment.' };
  }
}

export async function getEnrolments(patientId: string) {
  return db
    .select({
      id: repeatEnrolment.id,
      serviceId: repeatEnrolment.serviceId,
      serviceName: service.name,
      status: repeatEnrolment.status,
      externalRef: repeatEnrolment.externalRef,
      heightCm: repeatEnrolment.heightCm,
      startingWeightKg: repeatEnrolment.startingWeightKg,
      startingWaistCm: repeatEnrolment.startingWaistCm,
      medicine: repeatEnrolment.medicine,
      strength: repeatEnrolment.strength,
      strengthSince: repeatEnrolment.strengthSince,
      lastSuppliedAt: repeatEnrolment.lastSuppliedAt,
      lastWeightKg: repeatEnrolment.lastWeightKg,
      notes: repeatEnrolment.notes,
      enrolledAt: repeatEnrolment.enrolledAt,
      enrolledByName: appUser.fullName,
    })
    .from(repeatEnrolment)
    .innerJoin(service, eq(repeatEnrolment.serviceId, service.id))
    .leftJoin(appUser, eq(repeatEnrolment.enrolledBy, appUser.id))
    .where(eq(repeatEnrolment.patientId, patientId));
}

/** Services a patient can be enrolled in — repeat supply only. */
export async function getRepeatServices(organisationId: string) {
  return db
    .select({ id: service.id, name: service.name })
    .from(service)
    .where(
      and(
        eq(service.organisationId, organisationId),
        eq(service.kind, 'REPEAT_SUPPLY'),
      ),
    )
    .orderBy(service.name);
}
