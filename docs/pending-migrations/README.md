# Pending migrations — run sheet

Scripts `21` and `22` are staged **here**, outside `platform/supabase/`, on
purpose. Read the hazard below before moving them.

---

## The hazard

`_migration` does not exist on the live database. It was built by hand through
the Supabase SQL editor, so nothing has ever been recorded as applied.

`pnpm db:migrate --baseline` records **every `.sql` file it finds in
`platform/supabase/` at that moment** and runs none of them.

So if 21 and 22 are sitting in that folder when the baseline runs, they are
marked as applied **without ever executing**. The ledger then claims success
over a database with no `clinical_contact_event`, no `prescription_fulfilment`
and no `service.booking_mode`, and the first symptom is a runtime error
pointing nowhere near the cause.

That is the only irreversible mistake available here. Everything else is
recoverable.

---

## Which database?

The two procedures differ. Pick the one that matches.

### A · A fresh or staging database (nothing applied yet)

Simplest, and the safest place to rehearse. No baseline is involved — the
ledger is created by the first run and every script executes in order.

```bash
mv docs/pending-migrations/2*.sql platform/supabase/
cd platform
pnpm db:migrate
```

That applies `01` through `22` in sequence and records each one.

### B · The existing live database (01–20 already applied by hand)

Scripts `01`–`20` are **not** all idempotent. `15_flu_form_v4.sql` publishes a
new version of the flu questionnaire every time it runs, so re-running the set
would leave two published flu forms with no obvious sign which one patients are
being given.

Baseline first, while only `01`–`20` are in the folder:

```bash
cd platform
pnpm db:migrate --baseline
```

That writes no schema. It records the twenty existing scripts as already
applied. Then, and only then:

```bash
# back up the database first
mv ../docs/pending-migrations/2*.sql supabase/
pnpm db:migrate
```

This applies exactly two scripts.

---

## Verify

Both scripts end with a `select` that counts what they created. Every column
should come back `1`:

```
submission_assignment | payment_confirmation | contact_log | fulfilment | gp_rx_link
booking_mode | public_profile | resources | acknowledgements
```

Then, from the application side:

```bash
cd platform
pnpm test          # 686 passing
pnpm typecheck
```

`tests/pending-schema.test.ts` asserts the Drizzle schema matches these two
scripts, and that neither has crept into `platform/supabase/` before the
baseline. **Once they are legitimately moved across, that second assertion will
fail** — delete it at that point; it has done its job.

---

## What changed in script 22, and why

The two `update public.service` statements originally matched on `slug` alone.
`service_slug_idx` is unique on `(organisation_id, slug)`, so a second tenant
may hold its own `flu-vaccination` and an unscoped update would reconfigure
theirs too. Harmless with one organisation today; the point is that every
mutation in this codebase carries a tenant predicate, and a migration that
quietly does not is the one that gets copied.

Note also that 22 **renames** `weight-management-first` to *Weight Management —
New Patient*, in place. The slug and id are preserved, so links, history and
existing submissions all survive; the display name changes as soon as it runs.

---

## After the scripts, before testing the chain

Nothing in the weight-management journey has ever run against real data —
`rule_evaluation` has zero rows. The fastest way to find what the tests cannot
see is to put one patient all the way through:

1. Complete the new-patient form at `/f/weight-management-first`, choosing
   **Continue online**.
2. Find them in **Weight Management → New patients**. Record a verification
   call; confirm identity.
3. Approve, entering medicine, strength, quantity and directions.
4. **Payments → Payment received**, tick and confirm. A prescription number is
   allocated here.
5. **Prescriptions** → record the batch and expiry, then mark ready, then
   collected or dispatched.
6. Check the patient now has a repeat care enrolment, and that
   `/repeat/weight-management-repeat` lets them in.

Step 6 is the join that did not exist before. If it works, the chain is whole.
