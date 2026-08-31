/**
 * Who may start a repeat request.
 *
 * §4.1 and §4.2. Patients cannot enrol themselves — a pharmacist authorises
 * them after the normal clinical pathway, and the scope of work is explicit
 * about why: an initial consultation and a first follow-up come first, and only
 * a patient who is stable and suitable is added. The gate exists so that a
 * repeat request is never the first time anyone has looked at someone.
 *
 * Two facts must match an ACTIVE enrolment before the form opens: the Repeat
 * Care ID and the email address. One alone is not enough. An ID is short,
 * printed on paperwork, and guessable; an email is widely known. Requiring both
 * turns a guess into a guess at a pair.
 *
 * Everything failing returns the same outcome and the same message. Telling an
 * unrecognised caller which half they got right would make the gate a lookup
 * tool for finding valid Repeat Care IDs.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import { repeatEnrolment, patient } from '@/lib/db/schema';
import { normaliseRepeatReference } from '@/lib/repeat-care/reference';

export type AccessOutcome =
  | { allowed: true; enrolmentId: string; patientId: string; serviceId: string }
  | { allowed: false; reason: 'NOT_MATCHED' | 'NOT_ACTIVE' };

export interface AccessAttempt {
  organisationId: string;
  serviceId: string;
  repeatCareId: string;
  email: string;
}

/** What a patient is told, whatever actually went wrong. */
/*
 * One message for every failure, and it points at the right door.
 *
 * It used to say "book an appointment", which is now wrong twice over: this
 * service is remote, and somebody without an active enrolment needs the
 * new-patient pathway rather than a booking. Still deliberately identical for
 * every cause of failure — telling an unrecognised caller which half they got
 * right would turn the gate into a tool for finding valid IDs.
 */
export const ACCESS_DENIED_MESSAGE =
  'We could not match those details to an active repeat care record. ' +
  'If you are new to us, or it has been a while, please start with the new patient form ' +
  'and a pharmacist will be in touch.';

/** Trim and case-fold, because neither is a meaningful difference here. */
function normalise(value: string): string {
  return value.trim().toLowerCase();
}

export function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

/**
 * Check a Repeat Care ID and email against the enrolments.
 *
 * A PAUSED or STOPPED enrolment is reported separately from no match at all,
 * because the two are different operationally — one is a patient the pharmacy
 * has deliberately taken off the pathway — but callers should still show the
 * same message to the patient.
 */
export async function checkRepeatCareAccess(
  tx: Tx,
  attempt: AccessAttempt,
): Promise<AccessOutcome> {
  if (isBlank(attempt.repeatCareId) || isBlank(attempt.email)) {
    return { allowed: false, reason: 'NOT_MATCHED' };
  }

  const reference = attempt.repeatCareId.trim();
  const email = normalise(attempt.email);

  const [row] = await tx
    .select({
      id: repeatEnrolment.id,
      status: repeatEnrolment.status,
      patientId: repeatEnrolment.patientId,
      serviceId: repeatEnrolment.serviceId,
    })
    .from(repeatEnrolment)
    .innerJoin(patient, eq(patient.id, repeatEnrolment.patientId))
    .where(
      and(
        eq(repeatEnrolment.organisationId, attempt.organisationId),
        eq(repeatEnrolment.serviceId, attempt.serviceId),
        // Case and padding are not identity. Compared in SQL so the index and
        // the comparison agree rather than filtering in application code.
        /*
         * Dashes and spaces are not identity. A reference read over the
         * telephone comes back without its dashes about as often as with them,
         * and refusing that teaches people the system is broken.
         */
        sql`upper(replace(replace(trim(${repeatEnrolment.externalRef}), '-', ''), ' ', ''))
            = ${normaliseRepeatReference(reference)}`,
        sql`lower(trim(${patient.email})) = ${email}`,
      ),
    )
    .limit(1);

  if (!row) return { allowed: false, reason: 'NOT_MATCHED' };
  if (row.status !== 'ACTIVE') return { allowed: false, reason: 'NOT_ACTIVE' };

  return {
    allowed: true,
    enrolmentId: row.id,
    patientId: row.patientId,
    serviceId: row.serviceId,
  };
}
