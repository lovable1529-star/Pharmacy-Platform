# Deployment Runbook

Step by step, in order. About 40 minutes end to end.

> **Before you start:** do this once on a throwaway Supabase project to prove the
> pipeline works, *before* you need it. Discovering a broken deploy at hour 60 of
> a 3-day sprint is how sprints fail.

---

## Prerequisites

- Node 20 or later, and pnpm
- A GitHub repository containing this codebase
- Accounts on Supabase, Vercel and Resend (all have free tiers)
- A domain you control, with access to its DNS

---

## Step 1 — Supabase

1. Go to **supabase.com** → sign in → **New project**
2. Name: `karsons-production` (or `karsons-staging`)
3. **Region: London (eu-west-2)**

   Not the default. This is a data residency requirement, and it cannot be
   changed after the project is created — a wrong region means starting over.

4. Generate a database password and **save it to your password manager now**. It
   is not shown again.
5. Wait about two minutes for provisioning.

### Collect the credentials

**Settings → API**

| Copy | Into |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` |

> The `service_role` key bypasses all row-level security. It is server-only.
> Never put it in a variable prefixed `NEXT_PUBLIC_`.

**Settings → Database → Connection string → URI**

| Copy | Port | Into |
|---|---|---|
| Transaction pooler | `6543` | `DATABASE_URL` |
| Session / direct | `5432` | `DIRECT_URL` |

Both are needed. Prisma uses the pooled connection for the application and the
direct connection for migrations.

### Create the storage bucket

**Storage → New bucket**

- Name: `documents`
- **Untick "Public bucket"** — these are prescriptions and ID photos

---

## Step 2 — Local setup and migration

```bash
git clone <your-repo> karsons
cd karsons
pnpm install

cp .env.example .env.local
# paste the values from Step 1

pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:3000`.

**If migration fails**, `DIRECT_URL` is almost certainly pointing at port `6543`.
Migrations need `5432`. This is the single most common setup error.

---

## Step 3 — Resend and email deliverability

Every GP is a `@gov.im` government mailbox. Government mail servers are strict.
Without correctly aligned SPF, DKIM **and** DMARC, clinical notifications are
silently dropped — not bounced, dropped. Nobody finds out until a surgery
complains.

1. **resend.com** → sign up → **Domains → Add Domain**
2. Enter your sending domain
3. Add every DNS record Resend shows you:
   - `MX` record for the bounce subdomain
   - `TXT` record for **SPF**
   - `TXT` record for **DKIM**
4. Click **Verify**. DNS propagation takes 5–30 minutes.
5. **API Keys → Create API Key** → copy into `RESEND_API_KEY`

### Add DMARC manually

Resend does not prompt for this. Add a `TXT` record:

| Field | Value |
|---|---|
| Name | `_dmarc` |
| Value | `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain` |

Start with `p=none` (monitor only). Move to `p=quarantine` once you have several
weeks of clean reports.

### Prove it before go-live

Send a test to a real `@gov.im` address and confirm receipt with the surgery.
Do not assume. This is the highest-risk integration in the system.

---

## Step 4 — Stripe (optional for a demo)

1. **dashboard.stripe.com** → keep **Test mode** on
2. **Developers → API keys** → copy both keys
3. **Developers → Webhooks → Add endpoint**
   - URL: `https://<your-vercel-url>/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `payment_intent.succeeded`
4. Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET`

---

## Step 5 — Vercel

1. **vercel.com** → **Add New → Project** → import the repository
2. Framework preset: **Next.js** (detected automatically)
3. **Environment Variables** → add every variable from `.env.example`
4. **Deploy**
5. Once live, set `NEXT_PUBLIC_APP_URL` to the real URL and **redeploy**
6. **Settings → Domains** → add your custom domain

### Function region

**Settings → Functions → Region: London (lhr1)**

Two reasons: data residency, and latency. A function in Washington querying a
database in London adds ~80ms to every single query — which shows up as both a
slower app and a larger Vercel bill.

---

## Step 6 — Scheduled jobs

`vercel.json` is already in the repository:

```json
{
  "crons": [
    { "path": "/api/cron/gp-batch",           "schedule": "0 18 * * *" },
    { "path": "/api/cron/reminders",          "schedule": "0 9 * * *" },
    { "path": "/api/cron/daily-summary",      "schedule": "30 18 * * *" },
    { "path": "/api/cron/verify-audit-chain", "schedule": "0 2 * * *" }
  ]
}
```

Generate a secret and add it as `CRON_SECRET`:

```bash
openssl rand -hex 32
```

Every cron route must verify this from the `Authorization` header. Without it,
anyone who guesses the URL can trigger your GP mailout.

> Cron schedules are UTC. The Isle of Man observes BST from late March to late
> October, so an 18:00 UTC batch sends at 19:00 local in summer. Set the schedule
> to the hour you want in winter and accept the shift, or run hourly and check
> local time inside the handler.

---

## Step 7 — Supabase Auth redirects

**Authentication → URL Configuration**

- **Site URL:** your Vercel production URL
- **Redirect URLs:** add both
  - `https://<your-url>/auth/callback`
  - `http://localhost:3000/auth/callback`

Magic links fail **silently** if this is missed — the email arrives, the link
does nothing, and there is no error anywhere.

---

## Step 8 — Smoke test

Work through this list on the deployed URL, not locally.

- [ ] Magic link login works
- [ ] Branch switcher changes the data shown
- [ ] Patient search returns seeded patients
- [ ] A service can be built and published in the Designer
- [ ] That form can be completed as a patient, on a phone
- [ ] A consultation runs through to submission
- [ ] Stock decrements after the consultation
- [ ] A PDF generates and downloads
- [ ] A real email arrives in a real inbox
- [ ] Triggering `/api/cron/gp-batch` manually sends the batch
- [ ] The audit trail shows every action just taken

---

## Cost expectations

For a realistic Karsons workload — two branches, ~40 consultations a day, 8 staff:

| Service | Tier | Notes |
|---|---|---|
| Vercel | Pro | Needed for cron jobs and the London region |
| Supabase | Pro | Needed for daily backups and no project pausing |
| Resend | Free → Pro | Free tier covers early volume comfortably |
| Stripe | Per transaction | No standing fee |

Run `estimateMonthlyUsage()` against the real workload before committing to a
tier. The test suite asserts a Karsons-scale workload stays within entry-tier
allowances, so a change that makes the app dramatically more expensive fails CI
rather than surfacing on an invoice.

---

## Before real patient data

The deployment above gives a working system. It does **not** give a system
lawfully processing special category health data. Still required:

- Data Protection Impact Assessment
- Penetration test and remediation
- WCAG 2.2 AA accessibility audit
- Signed DPAs from Supabase, Vercel, Resend and Stripe
- Medical device regulatory opinion
- Clinical hazard log and a named Clinical Safety Officer
- Backup restore tested end to end, not just configured

Until those are done, seed and demo with synthetic data only.

---

## Rollback

Vercel keeps every deployment. **Deployments → [previous] → Promote to
Production** reverts the application in seconds.

Database migrations do not roll back automatically. Take a snapshot before any
migration that drops or alters a column:

**Supabase → Database → Backups → Create backup**

---

## Common problems

| Symptom | Cause |
|---|---|
| Migration hangs or errors | `DIRECT_URL` on port `6543` instead of `5432` |
| "Too many connections" | Application using the direct URL instead of pooled |
| Magic link does nothing | Redirect URL missing from Supabase Auth config |
| PDFs fail in production only | Puppeteer somewhere — must be `@react-pdf/renderer` |
| GP emails never arrive | SPF, DKIM or DMARC not aligned |
| Cron jobs never run | Not on Vercel Pro, or `CRON_SECRET` mismatch |
| Slow queries everywhere | Vercel functions not in the London region |
