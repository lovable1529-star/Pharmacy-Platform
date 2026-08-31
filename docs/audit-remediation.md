# Audit remediation — tracking

Working through the Codex production-readiness audit (28 August 2026).
Payments are **out of scope** by instruction.

Each finding was checked against the code before being accepted. An audit read
from a zip can be wrong about a live codebase, and three findings below were.
Status is one of: **confirmed**, **partly true**, **already done**, **not true**.

---

## Order of work

Ranked by real harm, not by the audit's own numbering.

| # | Finding | Verified | Status |
|---|---------|----------|--------|
| 1 | GP "notified" has two sources of truth; nightly batch races | confirmed — worse than reported | **done** |
| 2 | `dayBounds()` uses server-local midnight | confirmed | **done** |
| 3 | Review queue ordered after limiting | confirmed | **done** — reports cap still open |
| 4 | Prescription number derived from UUID digits | confirmed — collides | **done** — needs `14_prescription_numbers.sql` |
| 5 | Export permissions never enforced | confirmed | **done** |
| 6 | Cross-tenant object scoping on mutations | partly true — needs a sweep | ☐ |
| 7 | Duplicate `getStaffContext()` per navigation | confirmed | **done** |
| 8 | Patient duplicate race under concurrency | confirmed — a constraint was the wrong tool | **done** — advisory lock, see below |
| 9 | Inventory: adjustment / transfer / reconcile missing | confirmed | ☐ |
| 10 | Client-side pagination on large tables | confirmed | ☐ |
| 11 | Settings loads every tab's data | **measured — not slow** | **closed, no change** |
| 12 | RLS vs direct DB connection | confirmed — needs negative tests, not a code change | ☐ |
| 13 | Migration trees inconsistent (`drizzle/` vs `supabase/`) | confirmed | ☐ |
| 14 | Walk-in / patient-centric start consultation | partly true | ☐ |

---

## 1 — GP notification: two sources of truth, and a race

**Worse than the audit reported, and the divergence is mine.**

`api/cron/gp-batch` marks a consultation as notified by writing `notifiedAt`
into the `clinical_data` JSONB blob. The Communications screen, added later,
reads and writes the `consultation.gp_notified_at` **column** from migration 11.

So the nightly batch's sends are invisible to the manual screen's "hide already
sent" filter. A practice gets the record twice: once from the batch, once from
whoever sends by hand the next morning.

Separately, the batch selects, then sends, then marks — two overlapping runs
both select the same rows and both send.

**Fix:** one column as the source of truth, and claim rows atomically before
sending, the way `drainOutbox` already does.

## 2 — Business day is the server's midnight, not the pharmacy's

`lib/queries/notifications.ts` `dayBounds()` calls `setHours(0,0,0,0)`, which
uses the runtime zone. On Vercel that is UTC; on this machine it is UTC+5:30.
`app/book/actions.ts:138` does the same.

This is the same class of bug as the slot generator, which was fixed earlier —
these two were missed.

**Impact:** Today, the daily summary and date-filtered reports include the wrong
consultations either side of midnight.

## 3 — Silent truncation

- `queries/clinical.ts` `.limit(1000)` — a 90-day report with 2,500
  consultations silently reports on 1,000 and presents it as complete.
- `queries/reviews.ts` `.limit(100)` — the review queue caps before the
  worst-first ordering is meaningful, so a RED can sit outside the window.

**Fix:** order in the database before limiting, aggregate rather than fetch for
reports, and say so on screen where a cap remains.

## 4 — Prescription number is not unique

```ts
parseInt(row.consultationId.replace(/\D/g, '').slice(0, 6) || '1', 10) % 1000000
```

Digits pulled out of a UUID, truncated to six, then modulo. Two consultations
whose ids happen to start with the same digits produce the same prescription
number. The code comments admit it is a placeholder.

**Fix:** a real per-branch, per-year sequence with a unique constraint.

## 5 — Export permissions exist but are never checked

`patients:export`, `consultations:export` and `reports:export` are in the
permission vocabulary and appear in no code path outside it. `DataTable` shows
the CSV button whenever `exportName` is set.

Five tables export: audit trail, consultations, inventory, patients, reports.
A receptionist who can view patients can export all of them.

**Fix:** gate the button on the permission AND move the export server-side, so
hiding the button is not the only control.

## 6 — Cross-tenant object scoping

Needs a sweep of every mutation for `WHERE id = ?` without an
`organisation_id` predicate. Some were fixed already; the rest is unaudited.

## 7 — Duplicate context resolution

`getStaffContext()` ran once for the staff layout and again for the page it
rendered. Each pass was a Supabase `auth.getUser()` round-trip plus three
queries, so every navigation paid for authorisation twice before touching the
page's own data.

Memoised with React's `cache()` at three levels — session user, actor, and the
context itself. Request-scoped and no wider: an authorisation decision that
outlived its request would keep answering after a role was revoked.

**Verified in production**, because dev mode renders twice and made the fix look
like it had not worked:

    dev:         getStaffContext x2, getActor x2, getSessionUser x2
    production:  getStaffContext x1, getActor x1, getSessionUser x1

Three navigations produced three executions — cached within a request, never
across them.

## 11 — Settings: measured, and it is not the problem

Closed without a change. The seven queries run in `Promise.all`, so they cost
roughly the slowest one rather than the sum. Median server time over three
passes in production:

    /settings       335ms
    /consultations  337ms
    /patients       236ms
    /               242ms

Settings is indistinguishable from every other page. Lazy-loading the tabs
would be real work for no measurable gain, so it stays on the list as a
scale-up item rather than a fix.

## The finding that actually matters for speed

Same pages, same machine, same database:

    next dev     2400-2800ms
    next start    236-337ms

Roughly ten times. Anything demonstrated from the dev server will feel sluggish
no matter what is optimised, because dev compiles on demand and renders twice.
Demo from a production build.

## 12 — RLS and the direct connection

Confirmed and correctly described. The app connects with `DATABASE_URL` as the
owning role, which bypasses RLS entirely — so RLS is defence-in-depth against
direct Supabase API access, not the app's gate. The app's gate is the `action()`
wrapper.

This is a real risk but not a code change: it needs negative tests proving
tenant isolation holds in the application layer, and the design writing down.

---

## Corrections to the audit

Three claims did not hold up:

- **Seed uses `role: 'OWNER'` (F-006).** No such representation exists in
  `lib/seed/karsons.ts`. The seed was updated when the role tables landed.
- **Waste workflow entirely missing (F-014).** A `WASTE` movement is written by
  the batch-recall path. Adjustment, transfer and reconciliation are genuinely
  missing; waste is partial rather than absent.
- **Command palette inert (F-022).** Already addressed — it is explicitly
  non-interactive and hidden from screen readers, so it cannot be discovered by
  tabbing. Recorded in `docs/open-items.html`.

---

## 8 — Patient duplicate race, revisited

Closed 31 August 2026, but **not** the way the audit proposed.

The audit called for a unique constraint. That would have been wrong.
 deliberately creates a second record when two people
share a name and a date of birth but contradict on contact details — they are a
real pair of people, and a constraint on name and date of birth would refuse
the second of them. A constraint on email cannot help either: email is
optional, and Postgres treats nulls as distinct.

The race is instead serialised with a transaction-scoped advisory lock keyed on
the identity, the same mechanism  uses to stop concurrent writes
forking the hash chain. The second request waits, reads the candidates the
first has committed, and matches rather than inserting.

Urgency changed on the way: this was theoretical while only staff created
patients at a counter, and stopped being theoretical when the public
new-patient form began creating them automatically.
