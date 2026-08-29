/**
 * Every database mutation must be scoped to the caller's organisation.
 *
 * §16.1: "Changing an appointment ID in the URL must never expose another
 * patient's data." The application — not Row Level Security — is the gate,
 * because the app connects as the owning role and RLS is bypassed on that
 * connection. RLS is defence-in-depth against direct Supabase API access.
 *
 * So the guarantee rests on every `update` and `delete` carrying an
 * organisation predicate. Five handlers were missing one: `arrive`, `noShow`
 * and `cancel` on appointments, `update` on a patient, and archiving an
 * availability window. Each took an id from the client and acted on it. A
 * single-tenant deployment hid the consequence.
 *
 * This is a source-level guard rather than a behavioural test, deliberately.
 * The predicate lives in SQL, so proving it behaviourally needs a live database
 * holding two organisations — worth having, and tracked separately. What this
 * catches is the regression: a new handler written without the predicate, which
 * is exactly how the five got there.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const SRC = join(__dirname, '..', 'src');

/**
 * Handlers that legitimately act across organisations.
 *
 * One entry, checked by hand: the nightly GP batch is a system job that
 * processes every organisation and is reachable only with CRON_SECRET. It takes
 * no id from a user.
 */
const ALLOWED = ['src/app/api/cron/gp-batch/route.ts'];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(full);
  }
  return found;
}

function relative(path: string): string {
  return path.slice(path.indexOf(`src${sep}`)).split(sep).join('/');
}

/**
 * The table names a file imports from the schema.
 *
 * This is what makes the check precise. `.delete(key)` on a Map and
 * `.delete(availability)` on a table are the same three tokens to a regular
 * expression — and the first version of this test duly flagged three React
 * components for deleting entries from local state. Only a name imported from
 * the schema can be a table, so only those are considered.
 */
function importedTables(source: string): Set<string> {
  const names = new Set<string>();
  const pattern = /import\s*\{([^}]+)\}\s*from\s*'@\/lib\/db\/schema'/g;
  for (const match of source.matchAll(pattern)) {
    for (const raw of (match[1] ?? '').split(',')) {
      const name = raw.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0];
      if (name) names.add(name.trim());
    }
  }
  return names;
}

interface Offender {
  file: string;
  mutations: string[];
}

function unscopedMutations(): Offender[] {
  const offenders: Offender[] = [];

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    const tables = importedTables(source);
    if (tables.size === 0) continue;

    const rel = relative(file);
    if (ALLOWED.includes(rel)) continue;

    /*
     * Split on the handler boundary rather than examining each mutation in
     * isolation. Read-then-write inside one handler is the safe pattern and by
     * far the commonest here: the row is fetched with an organisation
     * predicate, checked, and only then written. Judging the update statement
     * alone would flag roughly fifty of sixty call sites, all of them fine.
     */
    for (const block of source.split(/(?=\.handler\(async)/)) {
      const mutations = [...block.matchAll(/\.(update|delete)\((\w+)\)/g)]
        .filter((m) => tables.has(m[2] ?? ''))
        .map((m) => `.${m[1]}(${m[2]})`);

      if (mutations.length === 0) continue;
      if (block.includes('organisationId')) continue;
      offenders.push({ file: rel, mutations });
    }
  }

  return offenders;
}

describe('tenant isolation', () => {
  it('scopes every database mutation to an organisation', () => {
    const offenders = unscopedMutations();

    // Named in the failure, because "expected 3 to be 0" sends the next person
    // hunting through sixty call sites for the three that matter.
    const report = offenders
      .map((o) => `  ${o.file} — ${o.mutations.join(', ')}`)
      .join('\n');

    expect(report, `Mutations with no organisation predicate:\n${report}`).toBe('');
  });

  it('still finds the mutations it is meant to be checking', () => {
    // A guard on the guard. If the codebase is restructured so the pattern
    // stops matching, the test above starts passing for the wrong reason —
    // silently, and exactly when it is most needed.
    let counted = 0;
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      const tables = importedTables(source);
      if (tables.size === 0) continue;
      counted += [...source.matchAll(/\.(update|delete)\((\w+)\)/g)]
        .filter((m) => tables.has(m[2] ?? '')).length;
    }

    expect(counted).toBeGreaterThan(40);
  });
});
