/**
 * The Drizzle schema must describe what migrations 21 and 22 actually create.
 *
 * Those scripts are deliberately not applied yet — the client is running every
 * SQL script in one pass once the code is finished. That means the code is
 * being written weeks ahead of the database it targets, with nothing to catch
 * a mismatch: no query fails, no type complains, and the first symptom is a
 * runtime error on a live system.
 *
 * So the SQL is the source of truth and this compares the schema against it.
 * It is a source-level guard, like the tenant-isolation test, because proving
 * it behaviourally needs the database we have not migrated yet.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PENDING = join(__dirname, '..', '..', 'docs', 'pending-migrations');
const SCHEMA = readFileSync(join(__dirname, '..', 'src', 'lib', 'db', 'schema.ts'), 'utf8');

function pendingSql(): string {
  return readdirSync(PENDING)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(PENDING, f), 'utf8'))
    .join('\n');
}

const SQL = pendingSql();

/** `create table if not exists public.foo (` → `foo` */
function createdTables(sql: string): string[] {
  const found = [...sql.matchAll(/create table if not exists public\.(\w+)/gi)];
  return found.map((m) => m[1]!);
}

/** `alter table public.foo add column if not exists bar` → `foo.bar` */
function addedColumns(sql: string): string[] {
  const found = [
    ...sql.matchAll(/alter table public\.(\w+)\s+add column if not exists (\w+)/gi),
  ];
  return found.map((m) => `${m[1]}.${m[2]}`);
}

/** snake_case → camelCase, which is how Drizzle names the property. */
function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

describe('the two pending migrations are readable', () => {
  it('finds both scripts', () => {
    const files = readdirSync(PENDING).filter((f) => f.endsWith('.sql'));
    expect(files).toHaveLength(2);
    expect(files.join(' ')).toMatch(/21_/);
    expect(files.join(' ')).toMatch(/22_/);
  });

  /*
   * The whole point of staging them outside `platform/supabase/`. If they ever
   * appear there before the ledger is baselined, `--baseline` records them as
   * applied without running them.
   */
  it('are NOT sitting in the directory the migration runner reads', () => {
    const live = readdirSync(join(__dirname, '..', 'supabase'));
    expect(live.some((f) => f.startsWith('21_') || f.startsWith('22_'))).toBe(false);
  });
});

describe('every table the scripts create exists in the Drizzle schema', () => {
  const tables = createdTables(SQL);

  it('found the tables to check', () => {
    expect(tables.length).toBeGreaterThanOrEqual(4);
  });

  it.each(createdTables(SQL))('%s', (table) => {
    // Drizzle declares it as pgTable('snake_name', …), so the SQL name itself
    // must appear — matching on the camelCase export alone would pass even if
    // the table were pointed at the wrong physical name.
    expect(SCHEMA).toContain(`pgTable('${table}'`);
  });
});

describe('every column the scripts add exists in the Drizzle schema', () => {
  const columns = addedColumns(SQL);

  it('found the columns to check', () => {
    expect(columns.length).toBeGreaterThanOrEqual(6);
  });

  it.each(addedColumns(SQL))('%s', (qualified) => {
    const column = qualified.split('.')[1]!;
    expect(SCHEMA).toContain(`'${column}'`);
    // And declared under a property name Drizzle would generate, so a column
    // mapped to the wrong property is caught too.
    expect(SCHEMA).toMatch(new RegExp(`\\b${camel(column)}\\s*:`));
  });
});

describe('enum values the scripts add', () => {
  /*
   * `alter type … add value 'MANUAL'` is easy to apply in SQL and forget in
   * TypeScript, and the failure is silent: the column accepts it, the union
   * type does not.
   */
  it('MANUAL is a payment provider in the schema', () => {
    expect(SQL).toMatch(/add value if not exists 'MANUAL'/i);

    // The enum block itself, not a window of N characters after the name — a
    // distance-based match breaks the moment somebody writes a comment inside
    // the declaration, which is exactly what happened the first time.
    const block = /paymentProviderEnum\s*=\s*pgEnum\([\s\S]*?\]\);/.exec(SCHEMA);
    expect(block, 'paymentProviderEnum not found in schema.ts').not.toBeNull();
    expect(block![0]).toContain("'MANUAL'");
  });
});

describe('the service booking mode', () => {
  it('is declared, since both Weight Management journeys depend on NONE', () => {
    expect(SQL).toMatch(/add column if not exists booking_mode/i);
    expect(SCHEMA).toContain("bookingMode: text('booking_mode')");
  });
});
