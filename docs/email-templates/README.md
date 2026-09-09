# Auth email templates

Supabase's servers render the invitation and password-reset emails, not this
application, so these cannot be styled from code. They are kept here so the
wording is reviewable and diffable, and so nobody has to reconstruct them from
a dashboard field later.

Built on the structure the client supplied (`forgot-password.html`), with
Northwind's teal replaced by the Karsons purple `#5B3A8E`.

## Pasting them in

Supabase dashboard → **Authentication → Emails → Templates**. Switch to the
source view and replace the whole body.

| File | Supabase template | Used by |
|---|---|---|
| `supabase-reset-password.html` | Reset password | "Forgot password?" on the sign-in screen |
| `supabase-invite.html` | Invite user | Users → Invite someone |
| `supabase-magic-link.html` | Magic Link | not currently used |
| `supabase-email-change.html` | Change Email Address | staff changing their address |

Subjects:

| Template | Subject |
|---|---|
| Reset password | `Reset your Karsons Pharmacy password` |
| Invite user | `You have been invited to Karsons Pharmacy` |
| Magic Link | `Your Karsons Pharmacy sign-in link` |
| Change Email Address | `Confirm your new email address` |

**Confirm signup** is deliberately left alone — there is no public sign-up.

## Editing them

`{{ .ConfirmationURL }}` appears **twice** in each file: on the button and as
plain text below it. Keep both. Corporate mail filters rewrite or strip
buttons, and a template carrying only the button silently strands anyone whose
client does that. `{{ .Email }}` fills in the recipient.

Three constraints worth respecting:

- **Tables and inline styles only.** Outlook renders through Word, which has
  neither flexbox nor grid.
- **No external images or web fonts.** Both are blocked by default in most
  clients, and a mostly-image email scores worse with spam filters.
- **The expiry wording says "shortly", not a number.** Supabase's link lifetime
  is a dashboard setting (Authentication → Providers → Email), so a hard-coded
  "15 minutes" becomes a lie the moment somebody changes it. Put a real figure
  in only if you also fix the setting.

## Two changes from the supplied file

- The outermost table is `width="100%"` rather than `600px`. A fixed-width
  outer table left-aligns the whole email in several desktop clients instead of
  centring it.
- A plain-text link block was added under the button, for the reason above.
