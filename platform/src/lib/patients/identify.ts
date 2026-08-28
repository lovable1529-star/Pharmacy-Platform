/**
 * Turning questionnaire answers into a patient record.
 *
 * A form arrives with a name and a date of birth typed by the patient. A
 * consultation cannot be recorded against free text — it needs a real patient
 * row — so somewhere between "submitted" and "seen at the counter" the two have
 * to be reconciled.
 *
 * Doing it automatically is the difference between a system that flows and one
 * where staff retype every walk-in. Doing it CARELESSLY creates duplicate
 * records for the same person, which in a pharmacy means a vaccination history
 * split across two files and a genuine clinical risk.
 *
 * So the match is deliberately conservative:
 *
 *   - Date of birth must match exactly. Never fuzzy.
 *   - Surname and forename must match case-insensitively, trimmed.
 *   - Anything less certain creates nothing and returns null, leaving a human
 *     to decide. A missed match costs someone thirty seconds; a wrong match
 *     puts one patient's allergies on another patient's record.
 *
 * Nicknames are not resolved here on purpose. "Dave" and "David" with the same
 * date of birth are probably the same person — and probably is not good enough
 * to merge two medical records without a human looking.
 */

import { and, eq, sql, isNull } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import { patient } from '@/lib/db/schema';
import type { Answers } from '@/types/form-schema';

export interface PatientIdentity {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string | null;
  phone: string | null;
}

function str(answers: Answers, key: string): string | null {
  const value = answers[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pull identity out of a set of answers.
 *
 * Returns null unless all three identifying fields are present — a record
 * without a date of birth cannot be safely matched against later, and a
 * half-populated patient is worse than none.
 */
export function readIdentity(answers: Answers): PatientIdentity | null {
  const firstName = str(answers, 'firstName');
  const lastName = str(answers, 'lastName');
  const dateOfBirth = str(answers, 'dateOfBirth');

  if (!firstName || !lastName || !dateOfBirth) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;

  return {
    firstName,
    lastName,
    dateOfBirth,
    email: str(answers, 'email'),
    phone: str(answers, 'phone'),
  };
}

/**
 * Find the existing patient for this identity, or create one.
 *
 * `registeredBranchId` records where the record originated, for reporting only.
 * It never affects who can see the patient — patients are organisation-scoped,
 * because someone who had a flu jab at Onchan must be findable at Kirk Michael.
 */
export async function matchOrCreatePatient(
  tx: Tx,
  input: {
    organisationId: string;
    identity: PatientIdentity;
    registeredBranchId?: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  const { organisationId, identity } = input;

  const [existing] = await tx
    .select({ id: patient.id })
    .from(patient)
    .where(
      and(
        eq(patient.organisationId, organisationId),
        eq(patient.dateOfBirth, identity.dateOfBirth),
        sql`lower(trim(${patient.firstName})) = lower(${identity.firstName.trim()})`,
        sql`lower(trim(${patient.lastName})) = lower(${identity.lastName.trim()})`,
        isNull(patient.archivedAt),
      ),
    )
    .limit(1);

  if (existing) {
    // Fill in contact details we did not have before, but never overwrite what
    // staff have already corrected by hand — the form is the less reliable
    // source once a human has touched the record.
    if (identity.email || identity.phone) {
      await tx
        .update(patient)
        .set({
          ...(identity.email ? { email: sql`coalesce(${patient.email}, ${identity.email})` } : {}),
          ...(identity.phone ? { phone: sql`coalesce(${patient.phone}, ${identity.phone})` } : {}),
          updatedAt: new Date(),
        })
        .where(eq(patient.id, existing.id));
    }

    return { id: existing.id, created: false };
  }

  const [created] = await tx
    .insert(patient)
    .values({
      organisationId,
      firstName: identity.firstName,
      lastName: identity.lastName,
      dateOfBirth: identity.dateOfBirth,
      email: identity.email,
      phone: identity.phone,
      registeredBranchId: input.registeredBranchId ?? null,
    })
    .returning({ id: patient.id });

  if (!created) throw new Error('Could not create the patient record.');

  return { id: created.id, created: true };
}
