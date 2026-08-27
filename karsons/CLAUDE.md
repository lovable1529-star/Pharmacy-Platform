# CLAUDE.md — Karsons Pharmacy Platform

Read this before writing any code. It is the source of truth for architecture,
conventions and the non-negotiable rules of this codebase.

---

## What this is

A multi-company clinical services platform for a pharmacy group on the Isle of Man.
It handles vaccination services, GLP-1 weight management repeat prescribing, and any
other clinical service the client configures himself.

**The core insight:** every clinical service is the same object underneath —

> patient intake → clinician review → clinical action recorded → notification → immutable audit record

We build that engine once. Flu vaccination is a *configuration* of it, not a bespoke build.
If you find yourself hard-coding anything specific to flu vaccines, stop — it belongs in
configuration.

---

## Non-negotiable rules

These exist for legal and regulatory reasons. Do not work around them.

### 1. Never delete clinical data

No `DELETE` on any clinical table. Ever.

- Records are **versioned** — an edit creates a new version, the old one is retained
- Soft-delete via `archivedAt` where removal is genuinely needed
- Issued prescriptions are **immutable** — corrections are a new document referencing the original

### 2. Every mutation writes an audit event

Use `writeAudit()` from `src/lib/audit`. No exceptions. The audit log is append-only and
hash-chained — each entry includes the hash of the previous entry so tampering is detectable.

### 3. A pharmacist confirms every supply

There is **no fully autonomous approval path**. The decision engine triages and surfaces;
a human always confirms, even if it is one tap on a pre-filled screen.

This is a regulatory decision, not a product preference. Software that autonomously
recommends dose changes can be classified as a medical device (UK MDR / IMDRF Rule 11),
which would require third-party conformity assessment. Keeping a human in the loop avoids
that entire regime.

**Consequence for UI copy:** clinician screens say *"Meets criteria for increase — confirm?"*
never *"Increase to 5mg"*. Patients see **status only**, never a dose recommendation.

### 4. Patient data is organisation-scoped

Patients belong to the Organisation, not a Company or Branch. A patient attending either
branch must be found instantly. Every access is logged with the accessing company/branch.

### 5. No real patient data in non-production environments

Seed and test data is synthetic only. Reference data (pharmacists, GP surgeries, vaccine
batches) is real because it is not personal data.

---

## Tenancy model

```
Organisation          Karsons Pharmacy Group
  └── Company         A pharmacy business — own GPhC reg, own contracts
        └── Branch    Onchan, Kirk Michael — a physical site
              └── Resource   Consultation room, clinician, tablet
```

Users belong to the Organisation and hold **scoped role assignments**. A locum may be granted
Kirk Michael only, for a date range. Configuration cascades: org default → company override →
branch override.

Every query touching tenant data **must** filter by the caller's scope. Use the helpers in
`src/lib/auth/scope.ts`. Never query a tenant table without a scope filter.

---

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 15, App Router, Server Actions |
| Language | TypeScript, `strict: true` |
| Database | PostgreSQL via Supabase (London / eu-west-2) |
| ORM | Prisma |
| Auth | Supabase Auth — magic link, no passwords |
| UI | Tailwind + shadcn/ui + Radix |
| Forms | React Hook Form + Zod, driven by our own schema |
| PDF | `@react-pdf/renderer` — **never Puppeteer**, Chromium does not fit in a serverless function |
| Email | Resend |
| Jobs | Vercel Cron |
| Tests | Vitest (unit), Playwright (e2e), axe-core (a11y) |

---

## The two structures that carry the product

Get these right and everything else is scaffolding.

### Form schema (`src/types/form-schema.ts`)

JSONB emitted by the Service Designer, rendered by the form runtime. Versioned — a
submission is permanently bound to the schema version it was completed against, so a
form edited next year does not change what a patient answered last year.

### Rule tree (`src/types/rule-schema.ts`)

JSONB emitted by the rule builder, evaluated by `src/lib/rules/engine.ts`. Also versioned.
Every evaluation stores a full trace: which rules fired, in what order, and why.

Both are plain data. The engines that consume them are pure functions with no I/O —
this is what makes them testable and what makes the rule simulator possible.

---

## Directory ownership

When running parallel agents, respect these boundaries. Do not edit outside your lane.

| Path | Owner |
|---|---|
| `prisma/schema.prisma` | **Schema owner only.** Request changes, do not edit directly |
| `src/components/form-builder/**` | Lane A — Service Designer |
| `src/lib/rules/**`, `src/components/rule-builder/**` | Lane A — Decision engine |
| `src/app/(staff)/patients/**`, `consultations/**` | Lane B — Clinical |
| `src/lib/pdf/**`, `src/lib/email/**` | Lane C — Output |
| `src/components/ui/**` | Lane C — Design system |

Concurrent edits to `schema.prisma` will cost hours. Batch them through one owner.

---

## Conventions

**Naming** — tables `snake_case`, TypeScript `camelCase`, components `PascalCase`,
Prisma models `PascalCase` singular (`Patient`, not `Patients`).

**Server Actions** — every one starts with `requireScope()`, ends with `writeAudit()`.
Validate input with Zod at the boundary. Never trust a client-supplied `organisationId`.

**Errors** — user-facing messages say what happened and how to fix it. Never expose stack
traces or database errors to a patient-facing surface.

**Dates** — store UTC, render in `Europe/Isle_of_Man`. Use the helpers in `src/lib/dates.ts`.

**Money** — integer pence. Never floats.

**Measurements** — store SI (kg, cm). Convert at the UI boundary via `src/lib/units`.
The client's patients think in stones and inches; the database does not.

**Accessibility** — every interactive element keyboard-reachable with a visible focus ring.
Patients with disabilities use these forms and this is a legal exposure, not a nice-to-have.

---

## Testing

Required for every module:

- **Pure logic** (rules engine, form evaluation, unit conversion) — exhaustive unit tests
- **Server actions** — scope enforcement and audit writing must be tested
- **Critical paths** — e2e for: complete a consultation, build and publish a service,
  submit a repeat request

Run `pnpm test` before every merge to `main`.

The rules engine tests double as **executable clinical documentation**. When the client
says "an increase needs three weeks on the current dose", there is a test asserting exactly
that. Keep them readable — a pharmacist should be able to follow them.

---

## Documentation

Every module carries `docs/modules/<module>.md` covering: purpose, data model, key flows,
integration points, and gotchas. Update it in the same commit as the code.

Client-facing guides live in `docs/client-guides/` and are written for pharmacy staff,
not developers. No jargon.

---

## Things that have already bitten us

- **Prisma connection exhaustion** — `DATABASE_URL` uses the pooled port `6543`,
  `DIRECT_URL` uses `5432`. Migrations need the direct one.
- **Magic links failing silently** — Supabase Auth redirect URLs must include both the
  production and localhost callbacks.
- **GP email rejection** — every GP is a `@gov.im` government mailbox. Without aligned
  SPF, DKIM *and* DMARC, clinical mail is silently dropped. DMARC is not configured
  automatically by Resend; add it manually.
- **PDF generation on serverless** — `@react-pdf/renderer` only.
