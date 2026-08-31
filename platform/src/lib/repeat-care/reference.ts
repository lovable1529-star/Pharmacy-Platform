/**
 * The Repeat Care ID a patient types at the gate.
 *
 * `/repeat/[slug]` matches on this plus the email we hold. An enrolment
 * without one is unreachable: the patient has nothing to enter, and the gate
 * refuses everybody — which is exactly what an automatically created enrolment
 * did, so a remote patient completed the whole journey and still could not
 * request a repeat.
 *
 * ── Why this shape ───────────────────────────────────────────────────────
 *
 * It is read aloud on the telephone and typed off a printed label, so it
 * avoids the characters people confuse: no O or 0, no I, 1 or L, no S or 5.
 * Grouped in fours because a run of eight characters is hard to read back.
 *
 * It is a convenience, not a secret. The gate needs the ID AND the email on
 * record, and tells a failed attempt nothing about which half was wrong.
 */

/** Deliberately excludes O/0, I/1/L, S/5, U/V. */
const ALPHABET = 'ABCDEFGHJKMNPQRTWXY2346789';

export const REPEAT_REFERENCE_PREFIX = 'RC';

/**
 * A new reference, e.g. `RC-4H7K-M2PQ`.
 *
 * `randomInt` is injectable so a test can assert the shape without asserting
 * the value.
 */
export function generateRepeatReference(
  randomInt: (max: number) => number = (max) => Math.floor(Math.random() * max),
): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)]!;
  const block = () => Array.from({ length: 4 }, pick).join('');
  return `${REPEAT_REFERENCE_PREFIX}-${block()}-${block()}`;
}

/**
 * Compare what somebody typed against what is stored.
 *
 * Case, spaces and dashes are not identity: a reference read over the
 * telephone comes back without the dashes about as often as with them, and
 * refusing it teaches people the system is broken.
 */
export function normaliseRepeatReference(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function repeatReferencesMatch(typed: string, stored: string | null): boolean {
  if (!stored) return false;
  return normaliseRepeatReference(typed) === normaliseRepeatReference(stored);
}
