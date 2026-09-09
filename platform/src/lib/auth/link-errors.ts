/**
 * What a member of staff is told when an emailed link does not work.
 *
 * Supabase's messages are written for the developer integrating it. One of them
 * reached a pharmacist's screen verbatim:
 *
 *   "PKCE code verifier not found in storage. This can happen if the auth flow
 *    was initiated in a different browser or device, or if the storage was
 *    cleared. For SSR frameworks (Next.js, SvelteKit, etc.), use @supabase/ssr
 *    on both the server and client to store the code verifier in cookies."
 *
 * Nothing in that tells the person holding the email what to do next, and the
 * second half is an instruction to somebody who is not them.
 *
 * So every message shown on the sign-in screen is translated here. Each one
 * says what happened and what to do about it, and never mentions a library.
 *
 * Pure, so the wording can be tested without an auth server.
 */

export interface LinkFailure {
  /** Shown to the person holding the link. */
  message: string;
  /** True when requesting a fresh link is the fix. */
  retryable: boolean;
}

const GENERIC: LinkFailure = {
  message:
    'That link did not work. Ask an administrator to send you a new one.',
  retryable: true,
};

/**
 * Translate whatever the auth service said.
 *
 * Matched on substrings rather than codes because Supabase does not give these
 * stable identifiers, and an unrecognised message must still produce something
 * a person can act on rather than falling through to the raw text.
 */
export function describeLinkFailure(raw: string | null | undefined): LinkFailure {
  const text = (raw ?? '').toLowerCase();

  if (text.length === 0) return GENERIC;

  /*
   * The one that started this. A recovery or invitation link opened on a
   * different device from the one that asked for it — or, for an invitation,
   * on a device that never asked for anything at all, because an administrator
   * sent it.
   */
  if (text.includes('code verifier') || text.includes('pkce')) {
    return {
      message:
        'That link could not be opened on this device. Open it on the same '
        + 'device and browser you requested it from, or ask for a new one to be '
        + 'sent.',
      retryable: true,
    };
  }

  if (text.includes('expired') || text.includes('otp_expired')) {
    return {
      message: 'That link has expired. Request a new one — they are short-lived on purpose.',
      retryable: true,
    };
  }

  if (text.includes('already been used') || text.includes('already used')) {
    return {
      message:
        'That link has already been used. If you did not use it, tell an '
        + 'administrator before requesting another.',
      retryable: true,
    };
  }

  if (text.includes('invalid') && (text.includes('token') || text.includes('code'))) {
    return {
      message:
        'That link is not valid. It may have been broken across two lines by an '
        + 'email program — try copying the whole address into the browser.',
      retryable: true,
    };
  }

  if (text.includes('user not found')) {
    return {
      message: 'That account no longer exists. Speak to an administrator.',
      retryable: false,
    };
  }

  if (text.includes('rate') && text.includes('limit')) {
    return {
      message: 'Too many attempts just now. Wait a few minutes and try again.',
      retryable: true,
    };
  }

  return GENERIC;
}

/**
 * The OTP types an emailed link can carry.
 *
 * `invite` was missing from the type this was cast to, which compiled because
 * it was a cast rather than a check. It mattered less than it looks — the
 * string was passed through unaltered — but a list that is wrong is a list
 * somebody will trust.
 */
export const EMAIL_OTP_TYPES = [
  'signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email',
] as const;

export type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

/** Narrow whatever arrived in the query string, defaulting safely. */
export function asEmailOtpType(raw: string | null | undefined): EmailOtpType {
  const found = EMAIL_OTP_TYPES.find((t) => t === raw);
  return found ?? 'magiclink';
}

/**
 * Where a link should land once it has been exchanged.
 *
 * A recovery or invitation must reach the page where a password is chosen. An
 * invited colleague dropped on the dashboard is signed in with no password and
 * no way back in tomorrow.
 */
export function landingFor(type: string | null | undefined, requested: string | null): string {
  if (type === 'recovery' || type === 'invite') return '/reset-password';
  return requested && requested.startsWith('/') && !requested.startsWith('//')
    ? requested
    : '/';
}

/* ── Emails that never left ──────────────────────────────────────────────── */

export interface SendFailure {
  /** Shown to whoever pressed the button. */
  message: string;
  /** True when waiting and trying again is the answer. */
  transient: boolean;
}

/**
 * Why an email did not go out — where that can be said safely.
 *
 * The forgot-password screen deliberately reports the same thing whether or not
 * the address belongs to an account, because a form that says "no account with
 * that email" is a way of discovering which staff addresses are real. That
 * property is worth keeping.
 *
 * But it was hiding a different thing as well. On Supabase's free tier the
 * built-in sender allows a handful of messages an hour, and once that is
 * reached nothing is sent — while the screen still says "check your email".
 * Somebody then waits for a link that was never going to arrive.
 *
 * A send failure says nothing about whether the account exists, so it is safe
 * to report, and this is what distinguishes the two. Only failures recognised
 * as OUR problem are described; anything unrecognised returns null and the
 * caller keeps its generic success. Erring that way costs a clearer message and
 * protects the property that matters.
 */
export function describeSendFailure(
  raw: string | null | undefined,
  status?: number | null,
): SendFailure | null {
  const text = (raw ?? '').toLowerCase();

  // 429 is unambiguous whatever the wording says.
  if (status === 429 || text.includes('rate limit') || text.includes('over_email_send')) {
    return {
      message:
        'We could not send the email just now — too many have gone out in the '
        + 'last hour. Wait a few minutes and try again.',
      transient: true,
    };
  }

  /*
   * Supabase's wording when it is enforcing a per-address cooling-off period.
   * Distinct from the hourly cap, and worth its own message because the wait is
   * usually seconds rather than minutes.
   */
  if (text.includes('for security purposes') && text.includes('after')) {
    return {
      message:
        'One was sent moments ago. Wait a short while before asking for another.',
      transient: true,
    };
  }

  if (text.includes('error sending') || text.includes('smtp') || text.includes('mailer')) {
    return {
      message:
        'The email could not be sent. This is a problem at our end rather than '
        + 'with your account — tell an administrator.',
      transient: false,
    };
  }

  if (status === 500 || status === 502 || status === 503) {
    return {
      message: 'The email service is not responding. Try again shortly.',
      transient: true,
    };
  }

  // Unrecognised: say nothing, so the caller keeps its generic success.
  return null;
}
