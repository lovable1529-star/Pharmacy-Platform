# Pending migrations — deliberately NOT in `platform/supabase/`

These two scripts are staged here, outside the directory `scripts/migrate.mjs`
reads, and they must stay here until the migration ledger has been baselined.

## Why

`_migration` does not exist yet — this database was built by hand through the
Supabase SQL editor, so nothing has ever been recorded as applied.

`pnpm db:migrate --baseline` records **every `.sql` file it finds in
`platform/supabase/` at that moment** and runs none of them. If 21 and 22 are
sitting in that folder when the baseline runs, they are marked as applied
without ever executing. The ledger would then claim success over a database
with no `clinical_contact_event`, no `prescription_fulfilment` and no
`service.booking_mode`, and the first symptom would be runtime errors pointing
nowhere near the cause.

## The order

```bash
# 1. While only 01–20 are in platform/supabase/
pnpm db:migrate --baseline

# 2. Then move these two across
mv docs/pending-migrations/2*.sql platform/supabase/

# 3. And apply just them
pnpm db:migrate
```

Take a database backup before step 3.

## Before running 22

Its `update public.service ... where slug in (...)` carries no
`organisation_id` predicate. Harmless while one organisation exists, but every
mutation in the application scopes to a tenant and an unscoped migration is the
pattern that gets copied. Add the predicate before applying.

Note also that 22 renames `weight-management-first` to
**Weight Management — New Patient** in place. The slug and id are preserved, so
links and history survive; the display name changes as soon as it runs.
