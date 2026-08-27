/**
 * Applies every SQL file in ./drizzle in order, inside a transaction each.
 *
 * Uses DIRECT_URL (port 5432). The pooled connection on 6543 runs in
 * transaction-pooling mode and cannot execute the DDL, advisory locks and
 * function definitions these migrations contain — the failure is confusing, so
 * this refuses the wrong port outright rather than half-applying a migration.
 */

import './env.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'drizzle');

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
  .sort();

if (files.length === 0) {
  console.error('  No migrations found. Run `pnpm db:generate` first.');
  process.exit(1);
}

console.log(`\n  Applying ${files.length} migration${files.length === 1 ? '' : 's'}…\n`);

try {
  await sql`
    create table if not exists _migration (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  for (const file of files) {
    const already = await sql`select 1 from _migration where name = ${file}`;
    if (already.length) {
      console.log(`  · ${file} — already applied`);
      continue;
    }

    const contents = readFileSync(join(migrationsDir, file), 'utf8');

    // Drizzle separates statements with its own marker; other files are run whole
    // so that DO blocks and function bodies survive intact.
    const statements = contents.includes('--> statement-breakpoint')
      ? contents.split('--> statement-breakpoint')
      : [contents];

    await sql.begin(async (tx) => {
      for (const statement of statements) {
        const trimmed = statement.trim();
        if (trimmed) await tx.unsafe(trimmed);
      }
      await tx`insert into _migration (name) values (${file})`;
    });

    console.log(`  ✓ ${file}`);
  }

  console.log('\n  Migrations complete.\n');
} catch (error) {
  console.error('\n  Migration failed:\n', error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
