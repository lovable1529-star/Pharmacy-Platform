'use client';

/**
 * Where every emailed link lands.
 *
 * This was a server route, and that was the bug behind "invitations and
 * password resets don't work". The evidence, taken from the real project rather
 * than reasoned about: Supabase's `/auth/v1/verify` endpoint answers a link with
 *
 *   303 -> /auth/callback?next=/reset-password#access_token=…&refresh_token=…
 *
 * The session comes back in the URL **fragment**. A fragment is never sent to
 * the server — the browser strips it before the request leaves. So a server
 * route sees a bare `?next=` and nothing else, and there is no arrangement of
 * server code that can read those tokens. It has to be done here.
 *
 * Three shapes arrive at this path, and all three are handled:
 *
 *   #access_token + #refresh_token   an admin-generated invite, or any link
 *                                    Supabase verified at its own endpoint
 *   ?code=                           a browser-initiated flow (forgot password).
 *                                    The PKCE verifier lives in this browser,
 *                                    which is the other reason this belongs
 *                                    client-side: the server never had it
 *   ?token_hash= + ?type=            a link built from {{ .TokenHash }}, if the
 *                                    email templates are ever changed to emit
 *                                    one. Kept so that remains an option
 *
 * `createBrowserClient` writes the session to cookies rather than to browser
 * storage, so once it is set here every server-rendered page sees it on the
 * next request. That is the whole reason this project uses `@supabase/ssr`.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { asEmailOtpType, describeLinkFailure, landingFor } from '@/lib/auth/link-errors';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Signing you in…');

  // Effects run twice in development. Exchanging a one-time token twice turns a
  // working link into "already used", so this is guarded rather than relying on
  // the exchange being idempotent — it is not.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const fail = (raw: string | null | undefined) => {
      const { message: readable } = describeLinkFailure(raw);
      router.replace(`/sign-in?error=${encodeURIComponent(readable)}`);
    };

    if (!url || !anonKey) { fail('Supabase is not configured.'); return; }

    /*
     * Read straight off `window.location` rather than through
     * `useSearchParams`.
     *
     * The hook forces the page into a Suspense boundary — the production build
     * refuses to prerender without one — and buys nothing here, because the
     * fragment has to come from `window.location` regardless and none of this
     * runs on the server.
     */
    const params = new URLSearchParams(window.location.search);

    // Supabase reports its own refusals in the query string — an expired or
    // reused link, mostly.
    const providerError = params.get('error_description') ?? params.get('error');
    if (providerError) { fail(providerError); return; }

    const supabase = createBrowserClient(url, anonKey);
    const next = landingFor(params.get('type'), params.get('next'));

    void (async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');

      // The fragment carries its own type, and it is the accurate one — the
      // query string may not have been given one at all.
      const type = hash.get('type') ?? params.get('type');

      const code = params.get('code');
      const tokenHash = params.get('token_hash');

      try {
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) { fail(error.message); return; }
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) { fail(error.message); return; }
        } else if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: asEmailOtpType(params.get('type')),
          });
          if (error) { fail(error.message); return; }
        } else {
          fail('That link is missing its sign-in token. Request a new one.');
          return;
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : null);
        return;
      }

      setMessage('Signed in. Taking you through…');

      /*
       * The fragment is stripped from the address bar before moving on, so the
       * tokens are not left sitting in browser history or copied out of the URL
       * bar by somebody sharing a link.
       */
      window.history.replaceState(null, '', window.location.pathname);

      // The type from the fragment wins, because an invitation and a recovery
      // both have to reach the page where a password is chosen.
      router.replace(landingFor(type, params.get('next')) || next);
    })();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className="flex items-center gap-2.5 text-[14.5px] text-ink-soft">
        <Loader2 size={16} className="animate-spin text-brand-600" />
        {message}
      </div>
    </div>
  );
}
