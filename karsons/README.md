# Karsons Pharmacy Platform

A multi-company clinical services platform for a pharmacy group on the Isle of
Man. Runs vaccination services, GLP-1 weight management repeat prescribing, and
any other clinical service the client configures himself.

> **Read `CLAUDE.md` before writing code.** It holds the architecture, the
> conventions, and the non-negotiable rules — several of which exist for
> regulatory rather than technical reasons.

---

## The core idea

Every clinical service is the same object underneath:

```
patient intake → clinician review → clinical action → notification → audit record
```

We build that engine once. Flu vaccination is a *configuration* of it, not a
bespoke build. `src/lib/forms/services/flu-vaccine.ts` is the proof — the entire
service is one data structure, and no flu-specific logic exists anywhere else.

This is the capability Zoho could not deliver, and the reason this platform
exists.

---

## Status

**265 tests passing** across twelve suites, in under three seconds.

| Layer | Files | Tests |
|---|---|---|
| Database schema — all 12 modules | `prisma/schema.prisma` | — |
| Decision engine | `src/lib/rules/engine.ts` | 21 |
| GLP-1 clinical ruleset | `src/lib/rules/glp1-ruleset.ts` | 35 |
| Rule simulator | `src/lib/rules/simulator.ts` | 11 |
| Form schema + runtime | `src/lib/forms/`, `src/types/` | 19 |
| Scoped RBAC | `src/lib/auth/scope.ts` | 20 |
| Server action wrapper | `src/lib/actions.ts` | 7 |
| Audit log (hash-chained) | `src/lib/audit/` | 13 |
| Patient search + duplicates | `src/lib/patients/search.ts` | 29 |
| Clinical safety checks | `src/lib/clinical/safety.ts` | 23 |
| Inventory, expiry, recall | `src/lib/inventory/stock.ts` | 20 |
| Scheduling + walk-in queue | `src/lib/scheduling/slots.ts` | 18 |
| GP batching + delivery | `src/lib/communications/batching.ts` | 19 |
| Unit conversion + BMI | `src/lib/units/` | 13 |
| Performance + cost controls | `src/lib/performance/` | 17 |

**UI** — app shell with tenancy switching, search-first clinical workspace, form
renderer, Service Designer with live preview, safety panel, triage display,
prescription PDF.

---

## Setup

```bash
pnpm install
cp .env.example .env.local          # fill in from your Supabase project
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Full instructions, including DNS and email deliverability, are in
`docs/deployment/runbook.md`.

**If migration fails**, `DIRECT_URL` is almost certainly on port `6543`.
Migrations need `5432`. This is the most common setup error.

---

## Commands

```bash
pnpm dev              # development server
pnpm test             # run all tests
pnpm test:watch       # watch mode
pnpm typecheck        # TypeScript, no emit
pnpm docs             # build the HTML documentation site
pnpm verify           # typecheck + test + docs — run before merging
pnpm db:migrate       # apply migrations
pnpm db:seed          # reference data + 200 synthetic patients
```

---

## Documentation

Markdown in `docs/` is the source of truth. `pnpm docs` renders it to a styled
HTML site in `docs-site/` — that is what goes to the client.

| Section | Contents |
|---|---|
| **Architecture** | How the system fits together and why |
| **Modules** | Decision engine · Service Designer · Audit · Authorisation · Clinical safety · Performance |
| **Deployment** | Step-by-step runbook, hosting and cost |
| **For pharmacy staff** | Building services · Pharmacist guide · Administrator guide · Daily operations |

The client-facing guides are written for pharmacy teams, not developers. Keep
them jargon-free.

---

## Non-negotiable rules

1. **Never delete clinical data.** Version it or archive it.
2. **Every mutation writes an audit event.** Enforced structurally by
   `src/lib/actions.ts`, not left to convention.
3. **A pharmacist confirms every supply.** No autonomous approval path — this is
   what keeps the product outside medical device regulation. See
   `docs/modules/decision-engine.md`.
4. **Patients are organisation-scoped.** Findable at any branch, which is also
   what makes cross-branch safety checks possible.
5. **No real patient data outside production.** Seed data is synthetic; only
   reference data is real.

---

## Testing

```bash
pnpm test
```

The clinical tests in `tests/glp1-clinical.test.ts` are written to be readable by
a pharmacist. Each `describe` block maps to a table in the client's decision
matrix, so the rules can be checked line by line against his specification. When
a clinical rule changes, the test diff shows exactly what changed clinically.

`tests/performance.test.ts` asserts that a realistic Karsons workload stays
within entry-tier hosting allowances — so a change that makes the application
dramatically more expensive fails CI rather than surfacing on an invoice.

---

## Before real patient data

The system runs. It is not yet lawfully processing special category health data.
Still required:

- Data Protection Impact Assessment
- Penetration test and remediation
- WCAG 2.2 AA accessibility audit
- Signed DPAs from Supabase, Vercel, Resend and Stripe
- Medical device regulatory opinion
- Clinical hazard log and a named Clinical Safety Officer
- Backup restore tested end to end

---

## Known placeholders

Two things need replacing with the client's real data before any demo:

- **GPhC registration numbers** in `prisma/seed.ts` — correctly formatted but
  invented
- **GP surgery email addresses** — the right `@gov.im` format, but not the real
  addresses

Both are flagged in the seed file. Seeing his own pharmacists and surgeries in
the dropdowns is a large part of the demo's effect.
