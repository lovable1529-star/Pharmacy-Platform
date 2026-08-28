/**
 * Deciding whether two people are the same person.
 *
 * Name and date of birth alone are not enough. On an island of 84,000 with a
 * small pool of surnames, two real people sharing both is uncommon but not
 * rare — and merging them gives one vaccination history to two patients, which
 * is a clinical incident rather than a data-quality annoyance.
 *
 * So the check escalates, exactly as the pharmacy asked for it:
 *
 *   1. Name and date of birth must match. Nothing proceeds without this.
 *   2. Then phone.
 *   3. Then email.
 *
 * A DIFFERENCE in any comparable identifier disqualifies the match. A MISSING
 * identifier does not — "we never asked for their phone number" is not evidence
 * that this is a different person, and treating it as such would create a
 * duplicate every time somebody declines to give one.
 *
 * That asymmetry is the whole design. Contradiction is evidence; absence is not.
 *
 * Pure and separate from the database so the rule can be tested exhaustively —
 * it is the kind of logic that is easy to get subtly wrong and expensive to
 * discover wrong.
 */

export interface Identifiers {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone?: string | null;
  email?: string | null;
}

export type MatchVerdict =
  /** Same person: everything comparable agreed. */
  | { same: true; confirmedBy: ('phone' | 'email')[] }
  /** Different people: a comparable identifier contradicted. */
  | { same: false; reason: 'phone-differs' | 'email-differs' | 'name-or-dob-differs' };

/**
 * Phone numbers are compared on digits alone.
 *
 * The same number is written +44 7700 900123, 07700900123 and (07700) 900123 by
 * three different people, and a pharmacy will see all three. Comparing raw
 * strings would treat one patient as three.
 *
 * The last nine digits are used, so a number stored nationally (07700900123)
 * matches the same number stored internationally (+447700900123).
 */
export function normalisePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-9);
}

export function normaliseEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Are these the same person?
 *
 * `candidate` is an existing record; `incoming` is what has just been submitted.
 */
export function isSamePatient(
  candidate: Identifiers,
  incoming: Identifiers,
): MatchVerdict {
  if (
    !sameName(candidate.firstName, incoming.firstName) ||
    !sameName(candidate.lastName, incoming.lastName) ||
    candidate.dateOfBirth !== incoming.dateOfBirth
  ) {
    return { same: false, reason: 'name-or-dob-differs' };
  }

  const confirmedBy: ('phone' | 'email')[] = [];

  const candidatePhone = normalisePhone(candidate.phone);
  const incomingPhone = normalisePhone(incoming.phone);

  if (candidatePhone && incomingPhone) {
    if (candidatePhone !== incomingPhone) {
      return { same: false, reason: 'phone-differs' };
    }
    confirmedBy.push('phone');
  }

  const candidateEmail = normaliseEmail(candidate.email);
  const incomingEmail = normaliseEmail(incoming.email);

  if (candidateEmail && incomingEmail) {
    if (candidateEmail !== incomingEmail) {
      return { same: false, reason: 'email-differs' };
    }
    confirmedBy.push('email');
  }

  return { same: true, confirmedBy };
}

/**
 * Pick the record this submission belongs to, out of everyone sharing the name
 * and date of birth.
 *
 * Candidates confirmed by more identifiers win, so where one record matches on
 * phone and email and another only shares a name, the stronger evidence
 * decides rather than whichever row Postgres happened to return first.
 */
export function chooseMatch<T extends Identifiers & { id: string }>(
  candidates: readonly T[],
  incoming: Identifiers,
): { match: T; confirmedBy: ('phone' | 'email')[] } | null {
  let best: { match: T; confirmedBy: ('phone' | 'email')[] } | null = null;

  for (const candidate of candidates) {
    const verdict = isSamePatient(candidate, incoming);
    if (!verdict.same) continue;

    if (!best || verdict.confirmedBy.length > best.confirmedBy.length) {
      best = { match: candidate, confirmedBy: verdict.confirmedBy };
    }
  }

  return best;
}
