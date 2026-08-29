/**
 * Applies the numbered SQL scripts in ./supabase, once each, in order.
 *
 * ── Why this points at supabase/ and not drizzle/ ────────────────────────
 *
 * There were two migration trees that disagreed. `drizzle/` stops at
 * 0004_users_and_roles and builds 26 tables; the schema now declares 44, and
 * `supabase/` is what actually built the live database. Its journal is broken
 * too — it lists an entry (`0001_high_reavers`) that has no matching file.
 *
 * So `pnpm db:migrate` used to apply a schema eighteen tables behind, and every
 * feature from the lifecycle spine onward would fail at runtime with errors
 * that pointed nowhere near the cause. Nothing invoked it automatically, which
 * is the only reason it never fired.
 *
 * `drizzle/` is left on disk, with a README saying why. Deleting it is a
 * separate decision.
 *
 * ── Why each file runs whole, outside a transaction ─────────────────────
 *
 * Half of these scripts open and close their own transaction with `begin;` and
 * `commit;`. Wrapping them in another one does not nest — the inner `commit`
 * ends the outer transaction early, so a later failure in the same file cannot
 * roll back and the ledger insert lands outside the work it is recording.
 *
 * They are therefore executed exactly as written, and the ledger row is
 * inserted afterwards. That leaves a millisecond window where a script has
 * applied but is unrecorded; if it happens the exact recovery statement is
 * printed rather than left to be worked out.
 *
 * ── The ledger is the point ─────────────────────────────────────────────
 *
 * `15_flu_form_v4.sql` publishes a new version of the flu questionnaire.
 * Running it twice publishes two, and the operating notes have to warn about it
 * because the SQL editor has no memory. Here, `_migration` remembers.
 *
 * On a database that was set up by hand, run with `--baseline` first: it
 * records every current file as applied without executing any of them.
 */

import './env.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase');

const baseline = process.argv.includes('--baseline');

const url = process.env.DIRECT_URL;

if (!url) {
  console.error(
    '\n  DIRECT_URL is not set.\n' +
    '  Copy .env.example to .env.local and fill it in from Supabase — see SETUP.md.\n',
  );
  process.exit(1);
}

if (url.includes(':6543')) {
  console.error(
    '\n  DIRECT_URL is pointing at port 6543 (the pooled connection).\n' +
    '  Migrations need the direct connection on port 5432.\n' +
    '  This is the single most common setup mistake — change the port and retry.\n',
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  // Zero-padded and numbered, so a plain sort is the intended order. 18 and 19
  // reference tables that 17 creates.
  .sort();

if (files.length === 0) {
  console.error(`\n  No .sql files found in ${migrationsDir}.\n`);
  process.exit(1);
}

try {
  await sql`
    create table if not exists _migration (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  if (baseline) {
    console.log(`\n  Baselining ${files.length} scripts — recording as applied, running none.\n`);
    for (const file of files) {
      const [existing] = await sql`select 1 from _migration where name = ${file}`;
      if (existing) {
        console.log(`  · ${file} — already recorded`);
        continue;
      }
      await sql`insert into _migration (name) values (${file})`;
      console.log(`  ✓ ${file} — recorded`);
    }
    console.log('\n  Baseline complete. `pnpm db:migrate` will now only apply new scripts.\n');
  } else {
    const pending = [];
    for (const file of files) {
      const [existing] = await sql`select 1 from _migration where name = ${file}`;
      if (!existing) pending.push(file);
    }

    if (pending.length === 0) {
      console.log('\n  Nothing to apply — every script is already recorded.\n');
    } else {
      console.log(`\n  Applying ${pending.length} script${pending.length === 1 ? '' : 's'}…\n`);

      for (const file of pending) {
        const contents = readFileSync(join(migrationsDir, file), 'utf8');

        // Run exactly as written. These files manage their own transactions —
        // see the note at the top of this file.
        await sql.unsafe(contents);

        try {
          await sql`insert into _migration (name) values (${file})`;
        } catch (recordError) {
          console.error(
            `\n  ${file} APPLIED but could not be recorded.\n` +
            '  Do not run it again until the ledger is corrected. Record it with:\n\n' +
            `      insert into _migration (name) values ('${file}');\n`,
          );
          throw recordError;
        }

        console.log(`  ✓ ${file}`);
      }

      console.log('\n  Done.\n');
    }
  }
} catch (error) {
  console.error('\n  Migration failed:\n', error);
  console.error(
    '\n  Nothing after the failing script was applied. Fix the cause and re-run —\n' +
    '  everything already recorded is skipped.\n',
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
