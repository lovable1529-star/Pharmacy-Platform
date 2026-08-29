/**
 * Reading and checking a date of birth.
 *
 * Kept apart from the input component so the rules can be tested without a
 * browser, and because "is this a real date" is a question the server should be
 * able to ask with the same answer the field gave.
 */

export interface DateParts {
  day: string;
  month: string;
  year: string;
}

export const EMPTY_PARTS: DateParts = { day: '', month: '', year: '' };

/** Nobody has lived to 121. Anything beyond it is a mistyped year. */
export const MAX_AGE = 120;

/** Splits an ISO `YYYY-MM-DD`. Anything else gives empty parts. */
export function splitIsoDate(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return EMPTY_PARTS;
  return { year: match[1]!, month: match[2]!, day: match[3]! };
}

/**
 * A real calendar date, or null.
 *
 * The round trip through `Date` is what catches 31 February. The constructor
 * accepts it and hands back 3 March, so comparing the components back out is
 * the only way to know it was never a date. Silently correcting a date of birth
 * on a clinical record is worse than refusing it.
 */
export function toDate(parts: DateParts): Date | null {
  const { day, month, year } = parts;
  if (day.length === 0 || month.length === 0 || year.length !== 4) return null;

  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y
    || date.getUTCMonth() !== m - 1
    || date.getUTCDate() !== d
  ) return null;

  return date;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Whole years, counted the way a person counts them. */
export function ageOn(birth: Date, asOf: Date): number {
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    asOf.getUTCMonth() < birth.getUTCMonth()
    || (asOf.getUTCMonth() === birth.getUTCMonth() && asOf.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Why this date of birth cannot be accepted, or null.
 *
 * Returns null while the date is still incomplete: somebody halfway through
 * typing has not made a mistake yet, and a field that turns red on the first
 * keystroke teaches people to ignore it.
 */
export function dateOfBirthProblem(parts: DateParts, asOf: Date = new Date()): string | null {
  const complete = parts.day !== '' && parts.month !== '' && parts.year.length === 4;
  if (!complete) return null;

  const date = toDate(parts);
  if (date === null) return 'That date does not exist — check the day and month.';
  if (date.getTime() > asOf.getTime()) return 'A date of birth cannot be in the future.';
  if (ageOn(date, asOf) > MAX_AGE) return `That would make the patient over ${MAX_AGE} — check the year.`;
  return null;
}

/** The ISO value to store, or an empty string. Half a date is not a date. */
export function toStoredDate(parts: DateParts, asOf: Date = new Date()): string {
  if (dateOfBirthProblem(parts, asOf) !== null) return '';
  const date = toDate(parts);
  return date === null ? '' : toIsoDate(date);
}

/**
 * A whole date pasted in, in the formats that actually turn up.
 *
 * Staff paste from a spreadsheet, an email, or our own CSV export. Returns null
 * when the text is not a date, so the paste falls through to normal behaviour.
 */
export function parsePastedDate(text: string): DateParts | null {
  const trimmed = text.trim();

  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (iso) {
    return {
      year: iso[1]!,
      month: iso[2]!.padStart(2, '0'),
      day: iso[3]!.padStart(2, '0'),
    };
  }

  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(trimmed);
  if (dmy) {
    return {
      day: dmy[1]!.padStart(2, '0'),
      month: dmy[2]!.padStart(2, '0'),
      year: dmy[3]!,
    };
  }

  return null;
}

/**
 * Whether a part-typed segment is already the whole answer.
 *
 * Two digits always are. One digit only is when it cannot be extended: no day
 * runs 4x, and no month runs 2x, so a 4 in the day box means the 4th and a 2 in
 * the month box means February.
 *
 * A 2 in the DAY box deliberately is not — 2, 25 and 29 are all real days, and
 * treating a lone digit as finished is what made the field jump to the next box
 * and pad "2" to "02" while somebody was still typing 25.
 */
export function segmentComplete(key: keyof DateParts, digits: string): boolean {
  if (key === 'year') return digits.length === 4;
  if (digits.length >= 2) return true;
  if (digits.length !== 1) return false;
  if (key === 'day') return Number(digits) >= 4;
  return Number(digits) >= 2;
}
