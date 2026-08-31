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
 * The rule itself lives in ./matching, kept pure so it can be tested
 * exhaustively: name and date of birth, then phone, then email, with a
 * contradiction in any comparable identifier meaning two different people.
 *
 * Nicknames are not resolved here on purpose. "Dave" and "David" with the same
 * date of birth are probably the same person — and probably is not good enough
 * to merge two medical records without a human looking.
 */

import { and, eq, sql, isNull } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import { patient } from '@/lib/db/schema';
import type { Answers } from '@/types/form-schema';
import { chooseMatch } from './matching';

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
/**
 * The key two submissions must agree on to queue behind each other.
 *
 * Normalised exactly as the candidate query normalises: trimmed and lowered.
 * If they disagreed, "Eleanor" and "eleanor " would take different locks,
 * both would find no candidate, and the race this exists to prevent would come
 * quietly back.
 *
 * The organisation is included so two tenants holding a patient with the same
 * name and birthday never wait on each other.
 */
export function identityLockKey(
  organisationId: string,
  identity: Pick<PatientIdentity, 'firstName' | 'lastName' | 'dateOfBirth'>,
): string {
  return [
    organisationId,
    identity.firstName.trim().toLowerCase(),
    identity.lastName.trim().toLowerCase(),
    identity.dateOfBirth,
  ].join('|');
}

export async function matchOrCreatePatient(
  tx: Tx,
  input: {
    organisationId: string;
    identity: PatientIdentity;
    registeredBranchId?: string | null;
  },
): Promise<{ id: string; created: boolean; confirmedBy: ('phone' | 'email')[] }> {
  const { organisationId, identity } = input;

  /*
   * Serialise everybody claiming to be the same person.
   *
   * Matching reads the candidates, decides, and then inserts if none of them
   * fit. Two requests running that at once both read an empty list and both
   * insert, leaving one patient with two records — and every later lookup
   * silently picking whichever comes back first.
   *
   * That was a theoretical race while only staff created patients, one at a
   * time, at a counter. It stopped being theoretical when the public form
   * began creating them: a patient who double-taps submit, or whose browser
   * retries a slow request, is two concurrent submissions for one person.
   *
   * A UNIQUE constraint would be the usual answer and is the wrong one here.
   * The code below deliberately creates a second record when two people share
   * a name and a birthday but contradict on contact details — that is a real
   * pair of people, not a duplicate — and a constraint on name and date of
   * birth would refuse the second of them. One on the email cannot help
   * either, because email is optional and Postgres treats nulls as distinct.
   *
   * An advisory lock keyed on the identity itself lets the second request wait
   * rather than race: by the time it reads the candidates, the first has
   * committed and it matches instead of inserting. It is held for the
   * transaction only, it is per-identity rather than per-organisation so
   * unrelated patients do not queue behind each other, and it works across
   * application instances because the lock lives in the database.
   *
   * The same pattern the audit chain uses, for the same reason.
   */
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${identityLockKey(organisationId, identity)}))`,
  );

  // Everyone who shares the name and date of birth — not just the first.
  // Taking `limit(1)` here was the bug: where two people genuinely shared both,
  // whichever row Postgres returned first silently absorbed the other.
  const candidates = await tx
    .select({
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      phone: patient.phone,
      email: patient.email,
    })
    .from(patient)
    .where(
      and(
        eq(patient.organisationId, organisationId),
        eq(patient.dateOfBirth, identity.dateOfBirth),
        sql`lower(trim(${patient.firstName})) = lower(${identity.firstName.trim()})`,
        sql`lower(trim(${patient.lastName})) = lower(${identity.lastName.trim()})`,
        isNull(patient.archivedAt),
      ),
    );

  const chosen = chooseMatch(candidates, identity);

  if (chosen) {
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
        .where(eq(patient.id, chosen.match.id));
    }

    return { id: chosen.match.id, created: false, confirmedBy: chosen.confirmedBy };
  }

  // Candidates existed but every one of them contradicted on phone or email.
  // These are different people who happen to share a name and a birthday, and
  // creating a second record is the correct outcome rather than a failure.
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

  return { id: created.id, created: true, confirmedBy: [] };
}
