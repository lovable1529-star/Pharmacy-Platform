/**
 * Patient search and duplicate detection.
 *
 * The client's clearest complaint about the Zoho attempt was *"it's unclear
 * where the pharmacist needs to go."* The answer is: a search box. Everything
 * starts by finding a patient.
 *
 * A pharmacist types whatever they have — a surname, a date of birth, a partial
 * first name, sometimes all three in one box. This module ranks candidates from
 * a single free-text query rather than making them choose a field first.
 *
 * Database-side filtering uses Postgres trigram similarity to narrow the set.
 * This module scores and orders what comes back. Keeping the ranking here — in
 * pure, tested code — means it behaves identically in tests, in the UI and in
 * the duplicate detector.
 */

export interface PatientRecord {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  postcode?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ScoredPatient<T extends PatientRecord = PatientRecord> {
  patient: T;
  score: number;
  /** Which parts of the query matched, for highlighting in the UI. */
  matched: string[];
}

export interface ParsedQuery {
  /** Tokens that look like name fragments. */
  nameTokens: string[];
  /** A date of birth, if one could be recognised. */
  dateOfBirth: Date | null;
  /** Digits that look like a phone number. */
  phoneDigits: string | null;
  postcode: string | null;
}

const DATE_PATTERNS: RegExp[] = [
  /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/, // 05/03/1974
  /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/, // 05/03/74
  /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/, // 1974-03-05
];

/** Isle of Man postcodes are IM1–IM9, in standard UK format. */
const POSTCODE_PATTERN = /^(IM\d)\s?(\d[A-Z]{2})?$/i;

function parseDateToken(token: string): Date | null {
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(token);
    if (!match) continue;

    let day: number, month: number, year: number;

    if (pattern === DATE_PATTERNS[2]) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);

      // Two-digit years: a patient is far more likely born in 1974 than 2074.
      if (year < 100) {
        const currentTwoDigit = new Date().getFullYear() % 100;
        year += year <= currentTwoDigit ? 2000 : 1900;
      }
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(Date.UTC(year, month - 1, day));
    // Reject impossible dates that Date silently rolls over, e.g. 31 February.
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
  }
  return null;
}

/**
 * Matches a postcode anywhere in the query, including the space.
 * A postcode is two tokens ("IM3 1AR"), so it must be lifted out before the
 * query is split on whitespace — otherwise "1AR" ends up treated as a name.
 */
const FULL_POSTCODE_PATTERN = /\b(IM\d)\s?(\d[A-Z]{2})\b/i;

export function parseQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    nameTokens: [],
    dateOfBirth: null,
    phoneDigits: null,
    postcode: null,
  };

  let remaining = query.trim();

  const postcodeMatch = FULL_POSTCODE_PATTERN.exec(remaining);
  if (postcodeMatch) {
    result.postcode = `${postcodeMatch[1]}${postcodeMatch[2]}`.toUpperCase();
    remaining = remaining.replace(postcodeMatch[0], ' ');
  }

  const tokens = remaining.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const date = parseDateToken(token);
    if (date) {
      result.dateOfBirth = date;
      continue;
    }

    // An outward code on its own, e.g. someone typing just "IM3".
    if (!result.postcode && POSTCODE_PATTERN.test(token)) {
      result.postcode = token.toUpperCase().replace(/\s/g, '');
      continue;
    }

    const digits = token.replace(/\D/g, '');
    if (digits.length >= 6 && digits.length === token.replace(/[\s()+-]/g, '').length) {
      result.phoneDigits = digits;
      continue;
    }

    result.nameTokens.push(token.toLowerCase());
  }

  return result;
}

/** Normalised Levenshtein similarity, 0–1. Tolerates typos and misheard names. */
export function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const distance = levenshtein(s1, s2);
  return 1 - distance / Math.max(s1.length, s2.length);
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost,
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Scores a candidate against a parsed query.
 *
 * Date of birth is weighted heavily — it is the strongest disambiguator in a
 * small population where surnames repeat constantly. On the Isle of Man,
 * "Kelly" and "Quayle" are everywhere; a date of birth is nearly unique.
 *
 * A prefix match on a name scores well because pharmacists type the first few
 * letters and stop.
 */
export function scorePatient<T extends PatientRecord>(
  patient: T,
  query: ParsedQuery,
): ScoredPatient<T> {
  let score = 0;
  const matched: string[] = [];

  if (query.dateOfBirth && sameDay(patient.dateOfBirth, query.dateOfBirth)) {
    score += 100;
    matched.push('dateOfBirth');
  }

  const first = patient.firstName.toLowerCase();
  const last = patient.lastName.toLowerCase();

  for (const token of query.nameTokens) {
    const candidates: [string, string][] = [[first, 'firstName'], [last, 'lastName']];
    let best = 0;
    let bestField = '';

    for (const [value, field] of candidates) {
      let tokenScore = 0;

      if (value === token) tokenScore = 50;
      else if (value.startsWith(token)) tokenScore = 40;
      else if (value.includes(token)) tokenScore = 25;
      else {
        // Fuzzy match, for typos and misheard names. Scored high enough that a
        // close misspelling still clears `minScore` — a pharmacist typing
        // "Kermodee" must still find Kermode.
        const sim = similarity(value, token);
        if (sim >= 0.75) tokenScore = Math.round(sim * 30);
      }

      if (tokenScore > best) {
        best = tokenScore;
        bestField = field;
      }
    }

    if (best > 0) {
      score += best;
      if (bestField && !matched.includes(bestField)) matched.push(bestField);
    }
  }

  if (query.phoneDigits && patient.phone) {
    const patientDigits = patient.phone.replace(/\D/g, '');
    if (patientDigits.endsWith(query.phoneDigits) || query.phoneDigits.endsWith(patientDigits)) {
      score += 60;
      matched.push('phone');
    }
  }

  if (query.postcode && patient.postcode) {
    const normalised = patient.postcode.toUpperCase().replace(/\s/g, '');
    if (normalised.startsWith(query.postcode)) {
      score += 20;
      matched.push('postcode');
    }
  }

  return { patient, score, matched };
}

export function searchPatients<T extends PatientRecord>(
  candidates: T[],
  rawQuery: string,
  options: { limit?: number; minScore?: number } = {},
): ScoredPatient<T>[] {
  const { limit = 25, minScore = 20 } = options;
  const query = parseQuery(rawQuery);

  if (query.nameTokens.length === 0 && !query.dateOfBirth && !query.phoneDigits) {
    return [];
  }

  return candidates
    .map((patient) => scorePatient(patient, query))
    .filter((result) => result.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.patient.lastName.localeCompare(b.patient.lastName);
    })
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────
// Duplicate detection
// ─────────────────────────────────────────────────────────────

export interface DuplicateCandidate<T extends PatientRecord> {
  patient: T;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

/**
 * Finds possible duplicates of a patient about to be created.
 *
 * Called before creating a new record so the pharmacist is warned rather than
 * silently producing a second record for someone already in the system.
 * Duplicates are a real clinical risk: half the allergy history in one record,
 * half in the other.
 *
 * This suggests. It never merges automatically — merging is destructive in
 * effect even though we retain both, and it needs a human.
 */
export function findDuplicates<T extends PatientRecord>(
  incoming: Omit<PatientRecord, 'id'>,
  existing: T[],
): DuplicateCandidate<T>[] {
  const results: DuplicateCandidate<T>[] = [];

  for (const candidate of existing) {
    const reasons: string[] = [];

    const sameDob = sameDay(candidate.dateOfBirth, incoming.dateOfBirth);
    const lastNameSim = similarity(candidate.lastName, incoming.lastName);
    const firstNameSim = similarity(candidate.firstName, incoming.firstName);

    if (sameDob) reasons.push('Same date of birth');
    if (lastNameSim === 1) reasons.push('Same last name');
    else if (lastNameSim >= 0.8) reasons.push('Similar last name');
    if (firstNameSim === 1) reasons.push('Same first name');
    else if (firstNameSim >= 0.8) reasons.push('Similar first name');

    if (incoming.phone && candidate.phone) {
      const a = incoming.phone.replace(/\D/g, '');
      const b = candidate.phone.replace(/\D/g, '');
      if (a && a === b) reasons.push('Same phone number');
    }

    if (incoming.email && candidate.email &&
        incoming.email.toLowerCase() === candidate.email.toLowerCase()) {
      reasons.push('Same email address');
    }

    let confidence: 'high' | 'medium' | 'low' | null = null;

    if (sameDob && lastNameSim >= 0.8 && firstNameSim >= 0.8) {
      confidence = 'high';
    } else if (sameDob && lastNameSim >= 0.8) {
      confidence = 'medium';
    } else if (reasons.includes('Same phone number') || reasons.includes('Same email address')) {
      confidence = 'medium';
    } else if (sameDob && (firstNameSim >= 0.8 || lastNameSim >= 0.8)) {
      confidence = 'low';
    }

    if (confidence) results.push({ patient: candidate, confidence, reasons });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return results.sort((a, b) => order[a.confidence] - order[b.confidence]);
}

/** Age in whole years, for display and for the decision engine's `derived.age`. */
export function ageInYears(dateOfBirth: Date, asOf = new Date()): number {
  let age = asOf.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - dateOfBirth.getUTCMonth();

  if (monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age;
}
