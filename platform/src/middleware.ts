import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session refresh.
 *
 * Supabase access tokens are short-lived. Without this running on every request,
 * the refresh token is never exchanged and the cookie quietly goes stale —
 * which shows up as being bounced back to sign-in immediately after signing in,
 * with no error to explain it.
 *
 * The awkward part is that a refreshed cookie has to be written onto the
 * RESPONSE. Writing it via the `cookies()` helper alone is not enough, because
 * the response object is what actually reaches the browser. That is why the
 * response is rebuilt inside `setAll` rather than created once up front.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Nothing to refresh if auth is not configured — let the request through so
  // the page can render its own "not configured" message.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not remove. Calling getUser() is what triggers the refresh.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. The auth callback is
     * deliberately included — it needs the same cookie handling.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
