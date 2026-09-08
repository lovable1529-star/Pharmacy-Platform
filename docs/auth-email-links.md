# Invitations and password resets — the Supabase side

Both flows failed with the same error on the sign-in screen:

> PKCE code verifier not found in storage. This can happen if the auth flow was
> initiated in a different browser or device, or if the storage was cleared. For
> SSR frameworks (Next.js, SvelteKit, etc.), use `@supabase/ssr` on both the
> server and client to store the code verifier in cookies.

## What is actually wrong

The emailed links carry a **PKCE `code`**. Exchanging a `code` requires a
**code verifier** that was generated and stored when the flow *started*. That
works for a login the user began in the browser they are sitting at. It does not
work for either of these:

**An invitation.** The person being invited never started anything — an
administrator did, on a different machine. There is no verifier anywhere in the
world that matches. This flow cannot work with a `code` link, at all, ever.

**A password reset opened on another device.** The verifier is written by the
browser that asked. People read email on their phone and request the reset on a
desktop, or the email client opens links in its own embedded browser. The
verifier is not there, and the exchange fails.

So this is not a bug that a retry fixes. The link shape is wrong for email.

## The fix: send a token hash, not a code

`verifyOtp` needs no verifier. It works from any device, any browser, at any
time until the link expires — which is what an emailed link has to do.

The application already handles this shape: `/auth/callback` accepts
`token_hash` and `type` and calls `verifyOtp` with them. **Nothing in the code
needs changing.** What needs changing is what Supabase puts in the email.

### 1 · Email templates

Supabase dashboard → **Authentication → Email Templates**.

For **Reset Password**, replace the link with:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">
  Reset password
</a>
```

For **Invite user**:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/reset-password">
  Accept your invitation
</a>
```

For **Magic Link**, if it is used:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink">
  Sign in
</a>
```

The important part is `{{ .TokenHash }}` in place of `{{ .ConfirmationURL }}`.
`.ConfirmationURL` is what produces the `code` link.

### 2 · URL configuration

Supabase dashboard → **Authentication → URL Configuration**.

- **Site URL** — the application's address. This is what `{{ .SiteURL }}`
  expands to, so if it is wrong every link in every email is wrong.
- **Redirect URLs** — must include the callback for every environment:

```
http://localhost:3100/auth/callback
https://<the production domain>/auth/callback
```

A redirect that is not on this list is rejected, and the user is bounced to
sign-in with an error that does not say why.

### 3 · Check the sender

Supabase's built-in SMTP is rate-limited and is not meant for production. If
invitations arrive slowly, arrive in spam, or stop arrying after a handful,
that is the cause rather than anything in this application. **Authentication →
Emails → SMTP Settings** is where a real sender is configured.

## Verifying it worked

1. Invite a colleague to an address you can read.
2. Look at the link in the email before clicking it. It must contain
   `token_hash=` and **not** `code=`.
3. Open it in a **different browser** from the one you sent it from — that is
   the case that used to fail.
4. It should land on `/reset-password` with a password form, not on sign-in
   with an error.
5. Repeat for **Forgot password**, requesting on a desktop and opening on a
   phone.

If it still fails, the server log now carries the real reason — the application
prints it at `[auth/callback] exchange failed:` along with the link type. The
message shown to the person is deliberately not that text.

## What changed in the application

Nothing that alters the flow — the template change above is the fix. What
changed is what happens when it goes wrong:

- Supabase's developer-facing errors are translated before they reach a screen.
  A pharmacist should never be told to install `@supabase/ssr`.
- The password reset is requested from the server rather than the browser, so
  the real failure reaches a log instead of being swallowed by the
  don't-reveal-whether-the-account-exists rule. That rule is unchanged: the
  person still sees the same message either way.
- A failed invitation is logged, so "I never got it" can be distinguished from
  "it never sent".
- `invite` is now handled explicitly as a link type rather than being cast past
  a list that did not include it.
