'use server';

/**
 * Ending a session.
 *
 * There was no way to do this. On a shared dispensary workstation that is not a
 * missing convenience — the next person to touch the keyboard inherits the last
 * pharmacist's access, including the ability to authorise a supply in their
 * name. Closing the tab does not help: the session cookie survives it.
 *
 * Done on the server because that is the only place the cookie can actually be
 * cleared. `@supabase/ssr` writes the session to cookies, and a server
 * component cannot set them — but a server action can, which is why this is one.
 *
 * `scope: 'local'` signs out this browser and leaves other devices alone.
 * Supabase defaults to `global`, which would also end the same person's session
 * on their phone; pressing "sign out" on the shop computer should not do that,
 * and somebody who needs every session ended has lost a device — a different
 * problem, wanting a deliberate act rather than a side effect of this button.
 */

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function signOut(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });

    if (error) {
      /*
       * Logged, then carried on regardless.
       *
       * A sign-out that fails must still get the person off the screen. The
       * likeliest failure is a session Supabase has already expired, in which
       * case there is nothing to revoke and refusing to move would strand
       * somebody on a page they can no longer use.
       */
      console.error('[sign-out] revoke failed, redirecting anyway:', error.message);
    }
  } catch (error) {
    console.error('[sign-out] threw, redirecting anyway:', error);
  }

  // Outside the try: redirect() signals by throwing, and catching it here would
  // swallow the navigation and leave the user staring at the same page.
  redirect('/sign-in');
}
