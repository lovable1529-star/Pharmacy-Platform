# Setup — what you need to do

Everything here is a real service with a real account. Work through it in order;
each step depends on the one before. Budget about 30 minutes for the first run.

Anything marked **YOU** needs a human — an account, a card, a DNS record. Everything
else is a command.

---

## 1. Prerequisites

Node 20 or later. Check:

```bash
node --version
```

pnpm comes with Node via corepack — no global install needed. Every command below
uses `corepack pnpm` for that reason. If you'd rather have `pnpm` directly, run
`corepack enable pnpm` from an **administrator** terminal.

---

## 2. Install

```bash
cd "C:/Users/ADMIN/Desktop/Pharmacy Platform/platform"
```

```bash
corepack pnpm install
```

---

## 3. **YOU** — Create the Supabase project

1. Sign up at **https://supabase.com** (free tier is fine to start).
2. **New project**.
   - **Name**: `karsons-platform`
   - **Region**: **London (eu-west-2)** — this matters. Isle of Man data
     protection tracks UK GDPR, and this is special-category health data. Do not
     pick a US region; it is not a setting you want to change later.
   - **Database password**: generate a strong one and save it in your password
     manager. You will need it in the next step and it is not shown again.
3. Wait for provisioning (~2 minutes).

---

## 4. **YOU** — Fill in the environment file

```bash
cp .env.example .env.local
```

Now collect five values from the Supabase dashboard.

### Connection strings — Project Settings → Database → Connection string → URI

You need **two**, and the difference matters:

| Variable | Port | Used for |
|---|---|---|
| `DATABASE_URL` | **6543** | The running app. Transaction pooling. |
| `DIRECT_URL` | **5432** | Migrations and seeding. A real session. |

Copy the URI twice, change the port on one, and replace `[YOUR-PASSWORD]` with the
password from step 3 in both.

> **This is the single most common setup mistake.** If migrations fail, check that
> `DIRECT_URL` is on **5432**, not 6543. The migrate script now refuses to run on
> the wrong port and tells you so.

### API keys — Project Settings → API

- `NEXT_PUBLIC_SUPABASE_URL` — "Project URL"
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the `anon` `public` key
- `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` key

The service role key bypasses row-level security. It must never appear in
client-side code, and it must never be committed. `.env.local` is gitignored.

---

## 5. Create the tables

```bash
corepack pnpm db:migrate
```

This applies two migrations:

- **`0000_*.sql`** — 21 tables: the four-level tenancy, patients, services, form
  and ruleset versions, submissions, consultations, stock, audit.
- **`0001_row_level_security.sql`** — the safety net. Tenant isolation policies
  on every table, an append-only audit log that not even an owner can rewrite,
  triggers that refuse to delete clinical records, and triggers that refuse to
  edit a published form version.

Check it worked: Supabase dashboard → **Table Editor**. You should see 21 tables.

---

## 6. **YOU** — Create your staff login

Auth is magic-link only. There are no passwords in this system, which removes
password storage, resets and credential stuffing from the threat model entirely.

1. Supabase dashboard → **Authentication** → **Users** → **Add user** →
   **Create new user**.
2. Enter your email. Tick **Auto Confirm User**.
3. Create it, then click the new user and copy their **UID** (a UUID).

Add these three lines to `.env.local`:

```
SEED_ADMIN_EMAIL="you@example.com"
SEED_ADMIN_AUTH_ID="paste-the-UID-here"
SEED_ADMIN_NAME="Mukunda Measuria"
```

Then, so magic links actually work, go to **Authentication → URL Configuration** and
add both to **Redirect URLs**:

```
http://localhost:3100/auth/callback
https://your-production-domain/auth/callback
```

> Magic links failing silently is almost always a missing redirect URL. Add the
> localhost one now even though production doesn't exist yet.

---

## 7. Load the data

```bash
corepack pnpm db:seed
```

This inserts:

- **Karsons Pharmacy Group**, Karsons Pharmacy Limited, and both branches with
  their real addresses, phone numbers and inbox addresses
- **All 6 pharmacists** with their real GPhC registration numbers
- **All 11 GP surgeries** with their real `@gov.im` prescription mailboxes
- **Both flu vaccines** with real batch numbers and expiry dates, plus opening
  stock at each branch recorded as ledger movements
- **The Flu Vaccination service**, with its form published as version 1
- **200 synthetic patients** — deterministic, so everyone sees the same data
- **Your staff account**, as OWNER across the whole organisation

Re-running is safe: it detects existing data and stops. `corepack pnpm db:seed -- --reset`
wipes and rebuilds (development only).

---

## 8. Run it

```bash
corepack pnpm dev
```

Open **http://localhost:3100**.

---

## Later — not needed to run locally

### **YOU** — Email (Resend)

Needed before any GP notification can send.

1. Sign up at **https://resend.com**, add the domain `karsonspharmacy.co.uk`.
2. Resend gives you SPF and DKIM records. **YOU** — add them to the domain's DNS.
3. **Add a DMARC record by hand.** Resend does not create one:

   ```
   Type: TXT   Name: _dmarc   Value: v=DMARC1; p=none; rua=mailto:dmarc@karsonspharmacy.co.uk
   ```

> All 11 surgeries are `@gov.im` government mailboxes. Without SPF, DKIM **and**
> DMARC aligned, they reject or silently drop clinical mail — no bounce, no error,
> the practice simply never learns their patient was vaccinated. Do not skip DMARC.

Also worth raising with the client: **Kirk Michael currently uses
`villagepharmacykm@gmail.com`.** Clinical mail cannot go out from a personal
Gmail. That branch needs an address on the pharmacy domain.

### **YOU** — Payments (Stripe)

Only needed for the GLP-1 GREEN auto-payment path.

1. **https://stripe.com** → create an account, stay in **test mode**.
2. Developers → API keys → copy the secret and publishable keys into `.env.local`.
3. **Confirm Stripe accepts an Isle of Man entity.** IoM is a Crown dependency,
   not part of the UK, and this is worth checking before the flow is built.

### Deploying to Vercel

1. Push to a Git repository.
2. **https://vercel.com** → New Project → import it.
3. **Root directory**: `platform`
4. **Region**: **London (lhr1)** — Settings → Functions.
5. Add every variable from `.env.local` under Settings → Environment Variables,
   with `NEXT_PUBLIC_APP_URL` set to the production URL.
6. Add the production callback to Supabase → Authentication → URL Configuration.

---

## Commands

```bash
corepack pnpm dev          # development server on :3100
corepack pnpm typecheck    # TypeScript, no emit
corepack pnpm test         # unit tests
corepack pnpm db:generate  # regenerate SQL after a schema change
corepack pnpm db:migrate   # apply migrations
corepack pnpm db:seed      # load reference data
corepack pnpm db:studio    # browse the database
```

If `corepack pnpm test` fails complaining that `pnpm` is not recognised, that is
pnpm's pre-run dependency check shelling out to a binary that isn't on PATH. Run
the tool directly instead:

```bash
node node_modules/vitest/vitest.mjs run
```

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Migration fails with a syntax or permission error | `DIRECT_URL` is on port 6543. It must be 5432. |
| `prepared statement "s1" already exists` | The app is using the direct connection. `DATABASE_URL` must be 6543. |
| Magic link does nothing | Redirect URL not added in Supabase → Authentication → URL Configuration. |
| `No staff account exists for …` | You signed in with an email that has no `app_user` row. Re-run the seed with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_AUTH_ID` set. |
| Queries return zero rows while signed in | RLS is working and `app_user` has no row for your auth UID — same fix as above. |
| `DATABASE_URL is not set` | `.env.local` missing or not loaded. It is gitignored by design. |

---

## Still outstanding from the client

Two things block a real clinic, and neither is a coding task:

1. **The flu form PDF.** He said to match his paper form exactly and linked it —
   the link now 404s. The questions in `src/lib/services/flu-vaccination.ts` are
   his stated list from the briefs, but the wording should be checked against the
   real form.
2. **The GPhC premises registration number** for the company. The one in the old
   build was taken from an Ashcroft screenshot and is not his.
