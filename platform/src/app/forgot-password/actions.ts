'use server';

/**
 * Asking for a password reset.
 *
 * Moved off the browser deliberately.
 *
 * It used to call `resetPasswordForEmail` from a browser client and swallow
 * every error, on the reasoning that saying "no account with that email" turns
 * the form into a way of discovering which staff addresses are real. That
 * reasoning is right and is kept — but swallowing everything also hid a genuine
 * failure for as long as it existed: the reset link came back saying the code
 * verifier could not be found, and the screen that requested it had cheerfully
 * said "check your email".
 *
 * Run here instead, the real error reaches the server log where somebody can
 * see it, and the anon key never has to be trusted to do this from a page.
 *
 * How the mail is actually sent, and why it uses a plain Supabase client
 * rather than the SSR one, is explained in lib/auth/recovery.ts.
 */

import { sendRecoveryEmail } from '@/lib/auth/recovery';

export interface ResetRequestResult {
  /**
   * Always true when the request was well-formed.
   *
   * Whether the address exists is deliberately not reflected here. The caller
   * shows the same "check your email" either way.
   */
  ok: boolean;
  /** Only set for something the person can fix, like a malformed address. */
  error?: string;
  /**
   * Set when the email demonstrably never left — a rate limit, or a mailer
   * that refused it.
   *
   * Separate from `error` because the request itself was fine. The caller must
   * not show "check your email" when this is present; that is the whole point
   * of it existing.
   */
  sendFailed?: string;
}

export async function requestPasswordReset(rawEmail: string): Promise<ResetRequestResult> {
  const email = rawEmail.trim();

  // Loose on purpose. A strict grammar rejects addresses that genuinely work,
  // and this one is only being checked to catch an obvious slip.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'That does not look like an email address.' };
  }

  /*
   * Two kinds of failure arrive down this one path, and both used to be
   * swallowed.
   *
   * One is anything touching the account — that stays hidden, because saying
   * "no account with that email" turns this form into a way of discovering
   * which staff addresses are real.
   *
   * The other is our own sender giving up. On the free tier Supabase allows a
   * small number of messages an hour and then sends nothing, while this screen
   * still said "check your email". Somebody waits for a link that was never
   * going to arrive, asks again, and pushes the limit further out. Reporting
   * that costs no secret: it is a fact about our mail service, not about their
   * account.
   *
   * `sendRecoveryEmail` reports a failure only when it recognises one as ours,
   * so an unfamiliar message keeps the old silent behaviour rather than risking
   * a leak on a guess.
   */
  const { failure } = await sendRecoveryEmail(email);
  if (failure) return { ok: true, sendFailed: failure.message };

  return { ok: true };
}
