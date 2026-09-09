# Moving email to Resend

Supabase's built-in sender is capped at a handful of messages an hour on the
free tier, which is too few to test an invitation flow, let alone run a
pharmacy. Resend's free tier is 3,000 a month / 100 a day.

The system sends two quite different kinds of email, and they move separately.

| | Sent by | Moves to Resend how |
|---|---|---|
| **Staff invitations, password resets** | Supabase's servers | Supabase dashboard → custom SMTP |
| **GP surgery batches, patient notices** | Our own code (`src/lib/email/send.ts`) | `RESEND_API_KEY` in the environment |

Neither needs a code change. The application never sends an auth email itself —
Supabase does — so the only way to move those without rewriting the auth flow is
to hand Supabase Resend's SMTP credentials. That also keeps the invite and reset
mechanism exactly as it is, which is the part that finally works.

---

## 1. Verify a domain first

**Nothing else matters until this is done.** An unverified Resend account can
only deliver to the address that owns it. Invitations to anyone else fail, and
on the auth path they fail quietly.

Resend → **Domains** → **Add Domain**, then add the DNS records it gives you.

Which domain depends on which mail:

- **Staff invitations and resets** — any domain you control is fine. If
  `karsonspharmacy.co.uk` is not available yet, a domain of your own works for
  testing.
- **GP surgery mail — must be `karsonspharmacy.co.uk`.** All eleven surgeries
  are `@gov.im` government mailboxes. Government filters check that the sending
  domain matches the organisation and that SPF, DKIM and DMARC align; clinical
  mail about Karsons patients arriving from an unrelated domain is exactly the
  shape of a phishing attempt, and it will be rejected or silently dropped. A
  silent drop means a surgery never learns their patient was vaccinated and
  nothing bounces to say so. This one needs DNS access from Muka.

Do not point `EMAIL_FROM` at a personal domain and send GP mail from it.

## 2. Supabase → SMTP, for invitations and resets

Dashboard → **Project Settings → Authentication → SMTP Settings** → enable
custom SMTP:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` |
| Password | your Resend API key |
| Sender email | an address on the **verified** domain |
| Sender name | `Karsons Pharmacy` |

Then **Authentication → Rate Limits → "Rate limit for sending emails"**. This
stays at 30/hour even after custom SMTP is enabled, so raise it or you have
swapped one cap for another.

No email template changes are needed. See `auth-email-links.md` — the default
templates work, and the earlier claim that they had to be edited was wrong.

## 3. The environment, for GP and patient mail

`.env.local` for development, and Vercel → Settings → Environment Variables for
production:

```
RESEND_API_KEY=re_...
EMAIL_FROM=clinic@karsonspharmacy.co.uk
```

`EMAIL_FROM` must be on the verified domain. It defaults to
`clinic@karsonspharmacy.co.uk`, so if that domain is not verified yet, set this
explicitly to something that is — otherwise every send is refused.

A redeploy is required for Vercel to pick the variables up.

## 4. Check it, rather than hoping

```
pnpm check:email                    # configuration only, safe anywhere
pnpm check:email you@yourdomain.com # sends one real message
```

This is worth running because the failure it catches is invisible: a valid key
on a healthy account that still cannot send, because the from-domain was never
verified. Run it again after changing the domain, the key, or `EMAIL_FROM`.

Note it checks the **application's** path. Supabase SMTP is separate — prove
that one by using "Reset your password" on the sign-in screen.

## What happens when a send fails

Both paths now say so rather than claiming success. `describeSendFailure` in
`src/lib/auth/link-errors.ts` translates the failures into something a
pharmacist can act on, and deliberately returns nothing for anything it does not
recognise as ours — the forgot-password form must never become a way of
discovering which staff addresses are real.

One consequence worth knowing: Supabase creates an auth account *before* it
tries to email the invitation, so a failed send can leave a half-made account
behind. Inviting that person again then reports "already registered". They can
use "Reset your password" on the sign-in screen instead.
