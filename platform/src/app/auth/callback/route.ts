import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Magic-link landing.
 *
 * Two things here are easy to get wrong, and both produce the same symptom —
 * an endless bounce back to sign-in with no error:
 *
 * 1. The session cookie must be written onto the REDIRECT RESPONSE. Setting it
 *    through the `cookies()` helper and then returning a fresh
 *    `NextResponse.redirect()` throws the cookie away, so the next request
 *    arrives unauthenticated.
 *
 * 2. Supabase sends one of two shapes depending on the email template: a PKCE
 *    `code`, or a `token_hash` plus `type`. Handling only one of them means the
 *    link silently fails for anybody whose project uses the other.
 *
 * Anything that does go wrong is reported back with a readable reason rather
 * than a bare redirect, because "it just loops" is miserable to debug.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  let next = searchParams.get('next') ?? '/';

  // A recovery or invitation link must land on the page where a password is
  // chosen, not on the dashboard — otherwise an invited colleague ends up
  // signed in with no password and no way to get back next time.
  if (type === 'recovery' || type === 'invite') next = '/reset-password';

  // Supabase reports its own failures here — an expired or reused link, mostly.
  const providerError = searchParams.get('error_description') ?? searchParams.get('error');
  if (providerError) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent(providerError)}`,
    );
  }

  if (!code && !tokenHash) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent(
        'That link is missing its sign-in token. Request a new one.',
      )}`,
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent('Supabase is not configured.')}`,
    );
  }

  // Build the response first so auth cookies can be written straight onto it.
  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: (type as 'magiclink' | 'email' | 'signup' | 'recovery') ?? 'magiclink',
      });

  if (error) {
    console.error('[auth/callback] exchange failed:', error.message);
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent(error.message)}`,
    );
  }

  return response;
}
