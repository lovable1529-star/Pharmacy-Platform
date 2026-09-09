import 'server-only';

/**
 * Emailing somebody a link to set a password.
 *
 * Two places need this — the forgot-password form, where a person asks for it
 * themselves, and the Users screen, where an administrator sends one on their
 * behalf. They differ in what may be said afterwards, not in how the mail is
 * sent, so the sending lives here once and the two callers decide what to show.
 *
 * ── Why a plain client, not @supabase/ssr ────────────────────────────────
 *
 * This was a real bug: the reset link only worked in the browser that asked for
 * it. Opening it anywhere else gave "that link could not be opened on this
 * device", which is not something an emailed link should ever say.
 *
 * `@supabase/ssr` forces `flowType: 'pkce'` and will not let it be overridden.
 * PKCE has the client keep a secret verifier and send only a challenge, so
 * Supabase answers with a `?code=` that is worthless without the verifier — and
 * the verifier lives in one browser. People read email on their phone.
 *
 * A plain `@supabase/supabase-js` client defaults to `flowType: 'implicit'`, so
 * no challenge is registered and Supabase puts the session in the URL fragment,
 * which any browser can complete.
 *
 * No session is established here, so this client needs no cookie storage at
 * all. It sends one email and is discarded.
 */

import { createClient } from '@supabase/supabase-js';
import { resolveAppUrl } from '@/lib/app-url';
import { describeSendFailure, type SendFailure } from '@/lib/auth/link-errors';

export interface RecoveryOutcome {
  /** False only when we know the message did not go out. */
  sent: boolean;
  /**
   * Set when the failure is one we recognise as ours — a rate limit, an
   * unverified sending domain, a mailer that refused it.
   *
   * Null covers both "it worked" and "it failed in a way that might say
   * something about the account", which is why `sent` is reported separately.
   */
  failure: SendFailure | null;
}

/**
 * Ask Supabase to email a password link.
 *
 * Never throws. A caller that is mid-way through something more important
 * should not have to guard this.
 */
export async function sendRecoveryEmail(email: string): Promise<RecoveryOutcome> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      console.error('[recovery] Supabase is not configured.');
      return { sent: false, failure: null };
    }

    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${resolveAppUrl()}/auth/callback?next=/reset-password`,
    });

    if (error) {
      console.error('[recovery] send failed:', error.message);
      return { sent: false, failure: describeSendFailure(error.message, error.status) };
    }

    return { sent: true, failure: null };
  } catch (error) {
    console.error('[recovery] send threw:', error);
    return { sent: false, failure: null };
  }
}
