/**
 * Splitting a booked name into a first and last name.
 *
 * Booking asks for one name field, because asking a patient to fill two boxes
 * to book a flu jab loses more bookings than it gains data. The patient record
 * needs both halves, so the split happens here.
 *
 * Deliberately naive in one direction only: everything before the LAST space is
 * the first name, everything after it is the surname. "Mary Jane Watson" gives
 * "Mary Jane" and "Watson", which is right far more often than splitting on the
 * first space would be. Compound surnames — "van der Berg" — come out wrong, and
 * that is accepted: a receptionist can correct a surname on the patient record,
 * and the alternative is a booking form with more fields than a patient will
 * fill in on a phone.
 *
 * A single word becomes the surname, not the first name. "Give me the patient
 * called Khan" is how somebody is looked for at a counter.
 */

export interface SplitName {
  firstName: string;
  lastName: string;
}

export function splitName(full: string): SplitName | null {
  const cleaned = full.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;

  const lastSpace = cleaned.lastIndexOf(' ');

  if (lastSpace === -1) {
    // One word. Recording it as the surname makes them findable the way
    // somebody is actually asked for.
    return { firstName: '—', lastName: cleaned };
  }

  const firstName = cleaned.slice(0, lastSpace).trim();
  const lastName = cleaned.slice(lastSpace + 1).trim();

  if (!firstName || !lastName) return null;
  return { firstName, lastName };
}

/** `1974-03-05`, and nothing else. */
export function isIsoDate(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // A date of birth in the future is a typo, not a patient.
  return parsed.getTime() <= Date.now();
}
