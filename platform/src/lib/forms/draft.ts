/**
 * Resume tokens for patient questionnaires.
 *
 * A patient filling in a health form has no account. Requiring registration
 * before a flu jab questionnaire is how you lose the patient, so the link in
 * their confirmation email has to be the credential.
 *
 * That makes the token security-critical rather than cosmetic:
 *
 *   - 32 bytes from a CSPRNG. Never sequential, never derived from the
 *     appointment reference. The reference (ONC-3JBX4) is printed on emails and
 *     read out over the phone; if it also unlocked the form, every receipt
 *     would be a key to someone's medical answers.
 *   - Scoped to exactly one submission. Holding it lets you finish that form.
 *     It does not let you enumerate patients, reach another submission, or read
 *     anything clinical.
 *   - Expiring, so a forwarded or archived email stops working.
 *
 * base64url rather than hex: same entropy, shorter link, and no characters that
 * mail clients mangle when they auto-link a URL.
 */

import { randomBytes } from 'node:crypto';

/** How long a patient has to finish a form before the link stops working. */
export const RESUME_WINDOW_DAYS = 30;

export function generateResumeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function resumeExpiry(from: Date = new Date()): Date {
  const expires = new Date(from);
  expires.setDate(expires.getDate() + RESUME_WINDOW_DAYS);
  return expires;
}

/**
 * Tokens are compared with a length check first and a constant-time compare
 * after. Postgres already does the lookup, so this guards the places where we
 * compare in application code.
 */
export function tokensMatch(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
}

/** The link a patient follows to start or finish their questionnaire. */
export function buildFormUrl(
  appUrl: string,
  serviceSlug: string,
  token: string,
): string {
  return `${appUrl.replace(/\/$/, '')}/f/${serviceSlug}?s=${encodeURIComponent(token)}`;
}
