/**
 * Where a patient goes when the online service is not right for them.
 *
 * The form stops anyone who says they would rather be seen in person. Stopping
 * them is correct — this service is remote and a pharmacist is not going to
 * examine them — but stopping them with no next step just loses the patient.
 * So the stop carries a link to the pharmacy's own face-to-face programme.
 *
 * The URL is configuration, not code. It is a different programme run by the
 * pharmacy at their own address and their own price, and it will move; a
 * hard-coded link would make every move a deployment. It lives in
 * `service_public_profile.f2f_referral_url` and falls back to a placeholder
 * page in this application until the client gives us theirs.
 */

/** The in-app placeholder, used until the pharmacy configures its own page. */
export function placeholderReferralUrl(serviceSlug: string): string {
  return `/in-person/${serviceSlug}`;
}

/**
 * Is this safe to render as a link a patient taps?
 *
 * Accepts our own relative fallback and absolute http(s) addresses, and
 * nothing else. The value is typed in by a member of staff and rendered as an
 * anchor in a patient's browser, so a `javascript:` URL saved here would run
 * there.
 */
export function isUsableReferralUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  // Our own pages. A single leading slash only — `//evil.example` is a
  // protocol-relative address pointing somewhere else entirely.
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//');

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The link to offer, or null to offer nothing.
 *
 * Null is a real answer: a service with no face-to-face alternative should say
 * nothing rather than send the patient somewhere invented. The placeholder is
 * used only where this application provides one.
 */
export function resolveReferralUrl(input: {
  configured: string | null | undefined;
  serviceSlug: string;
  /** False for a service with no in-person equivalent at all. */
  offerPlaceholder?: boolean;
}): string | null {
  const configured = input.configured?.trim() ?? '';

  if (configured.length > 0) {
    // A bad value configured is not a reason to silently send them to the
    // placeholder — that would hide the mistake from whoever typed it.
    return isUsableReferralUrl(configured) ? configured : null;
  }

  return input.offerPlaceholder === false
    ? null
    : placeholderReferralUrl(input.serviceSlug);
}

/** Does this link leave our application? Decides target and rel. */
export function isExternalReferral(url: string): boolean {
  return !url.startsWith('/');
}
