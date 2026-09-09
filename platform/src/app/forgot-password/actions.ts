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
 * ── Why this does not use the @supabase/ssr client ──────────────────────
 *
 * It did, and that was a bug: the reset link only worked in the browser that
 * asked for it. Opening it anywhere else gave "that link could not be opened on
 * this device", which is not something an emailed link should ever say.
 *
 * `@supabase/ssr` forces `flowType: 'pkce'` and will not let it be overridden.
 * PKCE makes the client generate a secret verifier, keep it, and send only a
 * challenge; Supabase then answers the link with a `?code=` that is worthless
 * without the verifier. The verifier lives in one browser. People read email on
 * their phone.
 *
 * A plain `@supabase/supabase-js` client defaults to `flowType: 'implicit'`, so
 * no challenge is registered, and Supabase answers the link the same way it
 * answers an invitation — with the session in the URL fragment, which any
 * browser can complete. Invitations already worked for exactly this reason.
 *
 * No session is being established here, so this client needs no cookie storage
 * at all. It sends one email and is discarded.
 */

import { createClient } from '@supabase/supabase-js';
import { resolveAppUrl } from '@/lib/app-url';
import { describeSendFailure } from '@/lib/auth/link-errors';

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

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      console.error('[forgot-password] Supabase is not configured.');
      return { ok: true };
    }

    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${resolveAppUrl()}/auth/callback?next=/reset-password`,
    });

    if (error) {
      console.error('[forgot-password] reset request failed:', error.message);

      /*
       * Two kinds of failure arrive down this one path, and until now both were
       * swallowed.
       *
       * One is anything touching the account — that stays hidden, because
       * saying "no account with that email" turns this form into a way of
       * discovering which staff addresses are real.
       *
       * The other is our own sender giving up. On the free tier Supabase allows
       * a small number of messages an hour and then sends nothing, while this
       * screen still said "check your email". Somebody waits for a link that
       * was never going to arrive, asks again, and pushes the limit further
       * out. Reporting that costs no secret: it is a fact about our mail
       * service, not about their account.
       *
       * `describeSendFailure` returns null for anything it does not recognise
       * as ours, so an unfamiliar message keeps the old silent behaviour rather
       * than risking a leak on a guess.
       */
      const failure = describeSendFailure(error.message, error.status);
      if (failure) return { ok: true, sendFailed: failure.message };
    }
  } catch (error) {
    console.error('[forgot-password] reset request threw:', error);
  }

  return { ok: true };
}
