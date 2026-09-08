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
 * Run here instead, two things improve. The real error reaches the server log,
 * where somebody can see it. And the PKCE verifier is written to a cookie by
 * the SSR client rather than to browser storage, which is the half of the
 * problem that lives in this codebase.
 *
 * The other half does not: an emailed link is opened wherever the person reads
 * their email, which is often not the browser that asked. The durable fix is a
 * link carrying a token hash instead of a code, and that is an email-template
 * setting in the Supabase dashboard. See docs/auth-email-links.md.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
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
    const supabase = await createSupabaseServerClient();

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
