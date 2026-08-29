# Superseded — do not run these

This directory is the original Drizzle migration tree. It is kept for history
and is **no longer the source of truth**. `../supabase/` is.

## Why

It stops at `0004_users_and_roles`. Between then and now the schema gained the
lifecycle spine, masters, vaccination, prescriptions, documents and inventory
transactions:

| | Tables |
| --- | --- |
| Built by this directory | 26 |
| Declared in `src/lib/db/schema.ts` | 44 |

Applying this tree to a fresh database produces a schema **eighteen tables
behind**. Nothing errors at deploy time — it fails later, at runtime, with
missing-relation errors that point nowhere near the cause.

`meta/_journal.json` is inconsistent with the directory as well: it lists an
entry `0001_high_reavers` for which no file exists.

## What to use instead

```bash
pnpm db:migrate            # applies pending scripts from ../supabase, once each
pnpm db:migrate --baseline # database already set up by hand? record, run nothing
```

`scripts/migrate.mjs` now reads `../supabase` and keeps a `_migration` ledger.
That ledger matters: `15_flu_form_v4.sql` publishes a new version of the flu
questionnaire, and running it twice publishes two. The Supabase SQL editor has
no memory of what you have already run; this does.

## The two commands to be careful with

`db:generate` and `db:push` still call `drizzle-kit`, which diffs
`src/lib/db/schema.ts` against **this** tree and its broken journal.

- `db:generate` would emit a migration containing the eighteen tables it thinks
  are missing.
- `db:push` applies a diff straight to whatever database `DIRECT_URL` points
  at, and it is willing to drop things.

Neither is part of the deployment path. Do not reach for them without first
deciding what happens to this directory.

## If you want this tidied properly

Two options, both a deliberate decision rather than a cleanup:

1. **Delete this directory** and the `db:generate` / `db:push` scripts, making
   `supabase/` unambiguously the only tree.
2. **Regenerate it** from the current schema and adopt Drizzle migrations
   properly, retiring the numbered scripts.

Doing neither is fine — this file exists so the state is understood rather than
discovered.
