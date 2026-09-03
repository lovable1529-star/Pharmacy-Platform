/**
 * The settings a service carries that are not questions.
 *
 * Two things live here, and they are separate on purpose.
 *
 * The PRICE is operational. Until now it could only be set when a service was
 * created, which meant the two weight-management services had no price at all
 * and a prescription raised from them stranded at PENDING_PAYMENT forever —
 * there was nothing to charge, so nothing ever settled it. Making it editable
 * is what stops that being a database job.
 *
 * The PUBLIC PROFILE is presentation. A brand name, colours and support
 * details the patient sees on the form, so the weight-management journey can
 * look like its own clinic while Karsons remains the pharmacy that dispenses
 * it. Deliberately does NOT touch the prescriber or the legal identity: a
 * white label over who actually supplied a medicine would be a lie in a place
 * where lying matters.
 *
 * Pure. Both halves return every fault at once rather than the first, so
 * somebody who has got two things wrong is told both.
 */

/** Pounds as typed, to pence as stored. Null clears the price. */
export function parsePrice(input: string): number | null {
  const trimmed = input.trim().replace(/^£/, '').replace(/,/g, '');
  if (trimmed.length === 0) return null;

  const pounds = Number(trimmed);
  if (!Number.isFinite(pounds)) return Number.NaN;

  // Rounded rather than truncated: 19.999 typed by accident is £20.00, not
  // £19.99, and half a penny cannot be charged either way.
  return Math.round(pounds * 100);
}

export function priceProblems(priceMinor: number | null): string[] {
  const problems: string[] = [];

  if (priceMinor === null) return problems;

  if (!Number.isFinite(priceMinor) || Number.isNaN(priceMinor)) {
    problems.push('That is not an amount. Enter a number of pounds, like 190 or 190.00.');
    return problems;
  }

  if (!Number.isInteger(priceMinor)) {
    problems.push('A price cannot be a fraction of a penny.');
  }

  if (priceMinor < 0) {
    problems.push('A price cannot be negative.');
  }

  /*
   * A ceiling, because the field takes pounds and stores pence and a missing
   * decimal point is the mistake that actually happens. £100,000 for a pen is
   * not a real price and is worth refusing rather than charging.
   */
  if (priceMinor > 1_000_000) {
    problems.push('That is over £10,000. Check the decimal point.');
  }

  return problems;
}

export interface PublicProfileDraft {
  publicBrandName: string;
  primaryColour: string;
  secondaryColour: string;
  supportEmail: string;
  supportPhone: string;
  privacyUrl: string;
  termsUrl: string;
  fulfilmentName: string;
}

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function urlProblem(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }

  if (!parsed) return `The ${label} is not a web address. It should start with https://`;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `The ${label} must be a web address starting with https://`;
  }

  return null;
}

export function publicProfileProblems(draft: PublicProfileDraft): string[] {
  const problems: string[] = [];

  if (draft.publicBrandName.trim().length > 60) {
    problems.push('The brand name is too long to sit in a page header. Keep it under 60 characters.');
  }

  for (const [value, label] of [
    [draft.primaryColour, 'primary colour'],
    [draft.secondaryColour, 'secondary colour'],
  ] as const) {
    if (value.trim().length > 0 && !HEX_COLOUR.test(value.trim())) {
      problems.push(`The ${label} must be a hex code like #5B3FA8.`);
    }
  }

  const email = draft.supportEmail.trim();
  // Deliberately loose. The strict grammar rejects addresses that genuinely
  // work, and this one is displayed to patients rather than delivered to.
  if (email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    problems.push('That support email does not look like an address.');
  }

  const privacy = urlProblem(draft.privacyUrl, 'privacy policy link');
  if (privacy) problems.push(privacy);

  const terms = urlProblem(draft.termsUrl, 'terms link');
  if (terms) problems.push(terms);

  return problems;
}

/**
 * Is there anything here worth showing a patient?
 *
 * A profile of empty strings should be stored as nulls and treated as absent,
 * so the public form falls back to the pharmacy's own name rather than
 * rendering a blank brand where a heading should be.
 */
export function profileIsEmpty(draft: PublicProfileDraft): boolean {
  return Object.values(draft).every((v) => v.trim().length === 0);
}

/** Empty strings to null, so "not set" is one value in the database. */
export function normaliseProfile(draft: PublicProfileDraft): Record<keyof PublicProfileDraft, string | null> {
  const out = {} as Record<keyof PublicProfileDraft, string | null>;
  for (const [key, value] of Object.entries(draft) as [keyof PublicProfileDraft, string][]) {
    out[key] = value.trim() || null;
  }
  return out;
}
