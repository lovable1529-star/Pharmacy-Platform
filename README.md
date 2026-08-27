# Karsons Pharmacy Platform

Multi-site pharmacy operations platform for the Karsons Pharmacy Group, Isle of Man.

## Repository layout

Everything lives in **`platform/`**. Paths below are relative to it.

## What it does

Patients book appointments and complete clinical questionnaires online. Pharmacy
staff review submissions against a decision engine, record outcomes, manage
stock and audit the lot. Services and their questionnaires are configurable by
the pharmacy — new services do not require a code change.

- **Tenancy** — Organisation → Company → Branch → Resource, so Onchan and Kirk
  Michael are separate operating companies under one group.
- **Form engine** — schema-driven, versioned, immutable once published, so a
  consultation always renders under the exact questions the patient answered.
- **Decision engine** — pure GREEN / AMBER / RED triage. GREEN auto-approves.
- **Audit** — hash-chained append-only log; tampering breaks the chain.
- **Access control** — invite-only, password auth, DB-backed permission grid
  (11 modules × 6 actions) with branch and date-scoped role assignments.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 ·
Drizzle ORM + postgres.js · Supabase (Postgres, Auth, Storage, RLS) · Vitest ·
deployed on Vercel.

Drizzle is used rather than Prisma deliberately: Prisma connects as the service
role and would bypass Row Level Security, which is the main safety net over
patient data.

## Running it

```bash
cd platform
pnpm install
cp .env.example .env.local   # then fill in your own values
pnpm dev                     # http://localhost:3100
```

Database setup, Supabase dashboard configuration and the SQL run order are in
[`platform/SETUP.md`](platform/SETUP.md). The numbered scripts in
`platform/supabase/` are run in order, 01 through 08.

```bash
cd platform && node node_modules/vitest/vitest.mjs run
```

## Security

`.env.local` is git-ignored and must stay that way. It holds the Supabase
service-role key, which bypasses Row Level Security completely — leaking it is a
full patient-data breach. Never commit real values to `.env.example`.
