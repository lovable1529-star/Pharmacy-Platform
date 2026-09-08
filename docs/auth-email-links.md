# Invitations and password resets

Fixed in code. **No Supabase dashboard changes are needed** — no custom email
templates, no custom SMTP, no cost.

An earlier version of this document said the email templates had to be rewritten
to emit `{{ .TokenHash }}`. That was wrong, and it was written before anyone had
looked at what Supabase actually sends. Ignore it if you saw it.

## What was wrong

Supabase does not put a token in the email link. It puts a link to **its own
verify endpoint**:

```
https://<project>.supabase.co/auth/v1/verify?token=…&type=invite&redirect_to=…
```

That endpoint checks the token itself, then redirects to `redirect_to`. Measured
against this project, for both an invitation and a recovery:

```
303 -> https://karsons.vercel.app/auth/callback?next=/reset-password
       #access_token=…&refresh_token=…&type=invite
```

**The session comes back in the URL fragment** — everything after the `#`.

A fragment is never sent to the server. The browser strips it before the request
leaves. So `/auth/callback`, which was a **server route**, received a bare
`?next=/reset-password` and nothing else. It correctly concluded the link had no
token and bounced to sign-in.

No amount of server code can read those tokens. The handler had to move to the
browser.

## The fix

`/auth/callback` is now a client page. It reads the fragment, calls
`setSession`, and moves on. It handles all three shapes a link can arrive in:

| Arrives as | Comes from | Handled with |
| --- | --- | --- |
| `#access_token` + `#refresh_token` | Supabase's verify endpoint — invitations and resets | `setSession` |
| `?code=` | a flow started in this browser | `exchangeCodeForSession`, where the PKCE verifier actually lives |
| `?token_hash=` + `?type=` | a link built from `{{ .TokenHash }}` | `verifyOtp` |

The third is kept so that changing the templates remains an option, not a
requirement.

`createBrowserClient` writes the session to **cookies**, so once it is set the
server sees it on the next request. That is what `@supabase/ssr` is for.

### Why it could not stay on the server

`@supabase/ssr` forces `flowType: "pkce"` on both its clients — the option is
applied *after* anything the caller passes, so it cannot be overridden. PKCE
needs a verifier that only the browser that *started* a flow has. An invitation
is started by an administrator on a different machine, so no such verifier
exists anywhere. Client-side handling sidesteps that entirely.

## URL configuration

**Authentication → URL Configuration.**

- **Site URL** — `https://karsons.vercel.app`, no trailing slash. This is the
  fallback Supabase redirects to when a `redirect_to` is not on the allow-list,
  so it is also where a misconfigured link quietly ends up.
- **Redirect URLs** — `https://karsons.vercel.app/**` covers the callback.

Add `http://localhost:3100/**` if you want the flow to work locally. Without it,
a localhost `redirect_to` is rejected and the user is silently sent to the Site
URL root instead — verified, that is exactly what happens.

## Verifying it

1. Invite somebody at an address you can read.
2. Open the link **in a different browser** from the one you sent it from. That
   was the case that failed.
3. It should show "Signing you in…" briefly, then land on the password form.
4. Repeat for Forgot password, requesting on a desktop and opening on a phone.

If it fails, the message on screen is now plain English rather than Supabase's
developer text. The browser console carries the underlying reason.

## Still worth doing, separately

Supabase's built-in email sender is rate-limited to a handful of messages an
hour and is not intended for production. With a tester and real staff about to
use this, that limit will be reached.

This project already sends through **Resend** (GP notifications, patient email)
from `clinic@karsonspharmacy.co.uk`, so the account and the verified domain
already exist. Pointing Supabase's SMTP at the same Resend key is a
dashboard-only change with no new cost:

```
Host      smtp.resend.com
Port      587
Username  resend
Password  <the existing RESEND_API_KEY>
Sender    clinic@karsonspharmacy.co.uk
```

Confirm those against Resend's own SMTP page. This is about deliverability, not
about the bug above — invitations work without it.

## What else changed

- Supabase's developer-facing errors are translated before reaching a screen. A
  pharmacist was shown "use `@supabase/ssr` on both the server and client"; a
  test now asserts no branch can produce a message naming a library.
- The reset request runs on the server, so a genuine failure reaches a log
  instead of being swallowed by the rule that hides whether an account exists.
  That rule is unchanged.
- Failed invitations are logged, so "I never got it" can be told apart from "it
  never sent".
- The tokens are stripped from the address bar once used, so they are not left
  in browser history.
