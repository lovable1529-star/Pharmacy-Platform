'use server';

/**
 * Recording a patient's allergies.
 *
 * The table existed and nothing wrote to it. For a service whose whole purpose
 * is putting a needle in someone's arm, a patient record with no way to note an
 * allergy is a clinical safety gap rather than a missing feature — and the
 * product allergen list it is matched against was equally unreachable.
 *
 * Withdrawing an entry removes the row but writes the withdrawal to the audit
 * chain, so "this was recorded and later withdrawn" stays distinguishable from
 * "this was never recorded" — after an anaphylaxis that difference is the whole
 * enquiry. The live list stays clean because a pharmacist scanning before an
 * injection must not have to work out which entries still count.
 */

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { db } from '@/lib/db/client';
import { allergy } from '@/lib/db/schema';

export interface AllergyInput {
  patientId: string;
  substance: string;
  reaction: string | null;
  severity: string | null;
}

const addAllergyAction = action<AllergyInput>('patients:edit').handler(
  async (input, { tx, actor }) => {
    const substance = input.substance.trim();

    const [created] = await tx
      .insert(allergy)
      .values({
        organisationId: actor.organisationId,
        patientId: input.patientId,
        // Stored lowercase so it matches the product allergen list, which is
        // normalised the same way. Two spellings of "penicillin" that do not
        // match each other are worse than no check at all.
        substance: substance.toLowerCase(),
        reaction: input.reaction?.trim() || null,
        severity: input.severity,
      })
      .returning({ id: allergy.id });

    if (!created) throw new Error('Could not record that allergy.');

    return {
      result: { id: created.id },
      audit: {
        action: 'allergy.recorded',
        entityType: 'patient',
        entityId: input.patientId,
        after: { substance, reaction: input.reaction, severity: input.severity },
      },
    };
  },
);

export async function addAllergy(input: AllergyInput) {
  if (!input.substance.trim()) {
    return { ok: false as const, error: 'Name the substance.' };
  }

  try {
    await addAllergyAction(input);
    revalidatePath(`/patients/${input.patientId}`);
    return { ok: true as const };
  } catch (error) {
    console.error('addAllergy failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to change patient records.'
          : 'Could not record that allergy.',
    };
  }
}

const removeAllergyAction = action<{ id: string; patientId: string }>(
  'patients:edit',
).handler(async (input, { tx, actor }) => {
  const [before] = await tx
    .select({ substance: allergy.substance })
    .from(allergy)
    .where(
      and(eq(allergy.id, input.id), eq(allergy.organisationId, actor.organisationId)),
    )
    .limit(1);

  if (!before) throw new Error('That entry no longer exists.');

  await tx
    .delete(allergy)
    .where(
      and(eq(allergy.id, input.id), eq(allergy.organisationId, actor.organisationId)),
    );

  return {
    result: { id: input.id },
    audit: {
      // The row goes; the audit entry is what preserves that it ever existed.
      action: 'allergy.withdrawn',
      entityType: 'patient',
      entityId: input.patientId,
      before: { substance: before.substance },
    },
  };
});

export async function removeAllergy(id: string, patientId: string) {
  try {
    await removeAllergyAction({ id, patientId });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true as const };
  } catch (error) {
    console.error('removeAllergy failed', error);
    return { ok: false as const, error: 'Could not remove that entry.' };
  }
}

export async function getAllergies(patientId: string) {
  return db
    .select({
      id: allergy.id,
      substance: allergy.substance,
      reaction: allergy.reaction,
      severity: allergy.severity,
      recordedAt: allergy.recordedAt,
    })
    .from(allergy)
    .where(eq(allergy.patientId, patientId))
    .orderBy(desc(allergy.recordedAt));
}
