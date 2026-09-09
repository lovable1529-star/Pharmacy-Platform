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
      /*
       * Logged, not shown. A failure here is almost always configuration —
       * a missing redirect allow-list entry, or SMTP not set up — and the
       * person at the keyboard can do nothing about it. What they must not be
       * told is whether the address matched an account.
       */
      console.error('[forgot-password] reset request failed:', error.message);
    }
  } catch (error) {
    console.error('[forgot-password] reset request threw:', error);
  }

  return { ok: true };
}
