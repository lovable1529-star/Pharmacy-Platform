/**
 * Patient search.
 *
 * The client's clearest complaint about every previous attempt was "it's
 * unclear where the pharmacist needs to go." The answer is a search box, so
 * this needs to behave the way a pharmacist expects rather than the way a
 * database does.
 *
 * That means one box that accepts whatever they type — a name, a name and a
 * date of birth, a postcode, a phone number — figures out which is which, and
 * tolerates misspelling. Pure functions, no I/O, so every scoring rule is
 * testable.
 */

export interface PatientRecord {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  postcode?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ScoredPatient<T extends PatientRecord = PatientRecord> {
  patient: T;
  score: number;
  /** Which parts of the query matched — shown as badges on the result. */
  matchedOn: string[];
}

export interface ParsedQuery {
  nameTokens: string[];
  dateOfBirth?: string;
  postcode?: string;
  phone?: string;
}

const DATE_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  // 05/03/1974, 5-3-1974, 05.03.1974
  [/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/, (m) => `${m[3]}-${pad(m[2]!)}-${pad(m[1]!)}`],
  // 1974-03-05
  [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (m) => `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`],
];

function pad(value: string): string {
  return value.padStart(2, '0');
}

/** Isle of Man postcodes are IM1–IM9 followed by a digit and two letters. */
const POSTCODE_RE = /^IM\d\s?\d?[A-Z]{0,2}$/i;
const PHONE_RE = /^[\d\s()+-]{6,}$/;

export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { nameTokens: [] };
  const raw = query.trim();
  if (!raw) return parsed;

  // A postcode may legitimately contain a space, so try the whole string first.
  if (POSTCODE_RE.test(raw)) {
    parsed.postcode = raw.replace(/\s+/g, '').toUpperCase();
    return parsed;
  }

  for (const token of raw.split(/\s+/)) {
    let matchedDate = false;
    for (const [pattern, build] of DATE_PATTERNS) {
      const m = token.match(pattern);
      if (m) {
        parsed.dateOfBirth = build(m);
        matchedDate = true;
        break;
      }
    }
    if (matchedDate) continue;

    if (POSTCODE_RE.test(token)) {
      parsed.postcode = token.replace(/\s+/g, '').toUpperCase();
      continue;
    }
    if (PHONE_RE.test(token) && token.replace(/\D/g, '').length >= 6) {
      parsed.phone = token.replace(/\D/g, '');
      continue;
    }
    parsed.nameTokens.push(token.toLowerCase());
  }

  return parsed;
}

/**
 * Similarity between two strings, 0..1.
 *
 * Normalised Levenshtein. Deliberately tolerant — a pharmacist typing a Manx
 * surname they have heard but not read should still find the patient. "Kermodee"
 * must find "Kermode".
 */
export function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  if (s1 === s2) return 1;
  if (!s1.length || !s2.length) return 0;

  const rows = s1.length + 1;
  const cols = s2.length + 1;
  const dist: number[] = new Array(rows * cols).fill(0);

  for (let i = 0; i < rows; i += 1) dist[i * cols] = i;
  for (let j = 0; j < cols; j += 1) dist[j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dist[i * cols + j] = Math.min(
        dist[(i - 1) * cols + j]! + 1,
        dist[i * cols + (j - 1)]! + 1,
        dist[(i - 1) * cols + (j - 1)]! + cost,
      );
    }
  }

  const distance = dist[rows * cols - 1]!;
  return 1 - distance / Math.max(s1.length, s2.length);
}

const EXACT_NAME = 40;
const PREFIX_NAME = 30;
const FUZZY_NAME = 22;
const DOB_MATCH = 60;
const POSTCODE_MATCH = 35;
const PHONE_MATCH = 45;
const FUZZY_THRESHOLD = 0.72;

export function scorePatient<T extends PatientRecord>(
  patient: T,
  parsed: ParsedQuery,
): ScoredPatient<T> {
  let score = 0;
  const matchedOn: string[] = [];

  for (const token of parsed.nameTokens) {
    const candidates = [patient.firstName, patient.lastName];
    let best = 0;
    let bestLabel = '';

    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      if (lower === token) {
        if (EXACT_NAME > best) { best = EXACT_NAME; bestLabel = 'name'; }
      } else if (lower.startsWith(token)) {
        if (PREFIX_NAME > best) { best = PREFIX_NAME; bestLabel = 'name'; }
      } else {
        const sim = similarity(lower, token);
        if (sim >= FUZZY_THRESHOLD) {
          const value = Math.round(FUZZY_NAME * sim);
          if (value > best) { best = value; bestLabel = 'similar name'; }
        }
      }
    }

    if (best > 0) {
      score += best;
      if (!matchedOn.includes(bestLabel)) matchedOn.push(bestLabel);
    }
  }

  if (parsed.dateOfBirth && patient.dateOfBirth === parsed.dateOfBirth) {
    score += DOB_MATCH;
    matchedOn.push('date of birth');
  }

  if (parsed.postcode && patient.postcode) {
    const normalised = patient.postcode.replace(/\s+/g, '').toUpperCase();
    if (normalised.startsWith(parsed.postcode)) {
      score += POSTCODE_MATCH;
      matchedOn.push('postcode');
    }
  }

  if (parsed.phone && patient.phone) {
    if (patient.phone.replace(/\D/g, '').includes(parsed.phone)) {
      score += PHONE_MATCH;
      matchedOn.push('phone');
    }
  }

  return { patient, score, matchedOn };
}

/**
 * Minimum characters before a query is sent. Firing on one or two characters
 * matches most of the database, helps nobody, and on usage-billed hosting it is
 * a line on an invoice.
 */
export const SEARCH_MIN_LENGTH = 3;

export function shouldSearch(query: string): boolean {
  return query.trim().length >= SEARCH_MIN_LENGTH;
}

export function searchPatients<T extends PatientRecord>(
  patients: T[],
  query: string,
  limit = 8,
): ScoredPatient<T>[] {
  if (!shouldSearch(query)) return [];

  const parsed = parseQuery(query);
  if (!parsed.nameTokens.length && !parsed.dateOfBirth && !parsed.postcode && !parsed.phone) {
    return [];
  }

  return patients
    .map((p) => scorePatient(p, parsed))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.patient.lastName.localeCompare(b.patient.lastName))
    .slice(0, limit);
}

export function ageInYears(dateOfBirth: string, asOf = new Date()): number {
  const dob = new Date(dateOfBirth);
  let age = asOf.getFullYear() - dob.getFullYear();
  const monthDelta = asOf.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < dob.getDate())) age -= 1;
  return age;
}
