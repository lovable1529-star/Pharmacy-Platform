/**
 * Generates standalone SQL scripts for the Supabase SQL Editor.
 *
 * The app can seed itself with `pnpm db:seed`, but running numbered scripts by
 * hand gives you a chance to read each one before it touches the database —
 * which is the right instinct for something that will hold patient data.
 *
 *   pnpm sql:export
 *
 * Writes ./supabase/01…06. Run them in order in the Supabase SQL Editor.
 *
 * IDs are derived deterministically from names, so the scripts cross-reference
 * each other correctly and are safe to re-run.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORGANISATION, COMPANIES, BRANCHES, CLINICIANS, GP_SURGERIES, PRODUCTS,
  DEFAULT_AVAILABILITY, syntheticPatients,
} from '../src/lib/seed/karsons';
import { buildFluVaccinationForm } from '../src/lib/services/flu-vaccination';
import {
  buildWeightManagementNewPatientForm, buildWeightManagementRepeatForm,
} from '../src/lib/services/weight-management';
import { GLP1_REPEAT_RULESET } from '../src/lib/rules/glp1-ruleset';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'supabase');
mkdirSync(outDir, { recursive: true });

/** Deterministic UUID from a namespace and key, so scripts stay re-runnable. */
function uuid(namespace: string, key: string): string {
  const hex = createHash('sha1').update(`karsons:${namespace}:${key}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Single-quote escaping for SQL literals. */
function lit(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  return `'${value.replace(/'/g, "''")}'`;
}

function json(value: unknown): string {
  return `${lit(JSON.stringify(value))}::jsonb`;
}

const header = (title: string, notes: string[]) =>
  [
    '-- ═══════════════════════════════════════════════════════════',
    `-- ${title}`,
    '-- Karsons Pharmacy platform',
    '-- ═══════════════════════════════════════════════════════════',
    ...notes.map((n) => `-- ${n}`),
    '',
  ].join('\n');

// ── IDs ──────────────────────────────────────────────────────
const ORG_ID = uuid('organisation', ORGANISATION.slug);
const companyId = (key: string) => uuid('company', key);
const branchId = (key: string) => uuid('branch', key);
const surgeryId = (name: string) => uuid('gp_surgery', name);
const productId = (key: string) => uuid('product', key);
const batchId = (key: string, batchNumber: string) => uuid('batch', `${key}:${batchNumber}`);
const serviceId = (slug: string) => uuid('service', slug);
const formVersionId = (slug: string) => uuid('form_version', `${slug}:1`);
const rulesetVersionId = (slug: string) => uuid('ruleset_version', `${slug}:1`);

// ── 01 · schema ──────────────────────────────────────────────
const migrations = readdirSync(join(root, 'drizzle')).filter((f) => f.endsWith('.sql')).sort();
const schemaFile = migrations.find((f) => f.startsWith('0000'));
const securityFile = migrations.find((f) => f.startsWith('0001'));

if (!schemaFile || !securityFile) {
  console.error('  Missing migrations. Run `pnpm db:generate` first.');
  process.exit(1);
}

const schemaSql = readFileSync(join(root, 'drizzle', schemaFile), 'utf8')
  .split('--> statement-breakpoint')
  .join('\n');

writeFileSync(
  join(outDir, '01_schema.sql'),
  header('01 · Tables', [
    'Creates the 21 tables: four-level tenancy, patients, services, form and',
    'ruleset versions, submissions, consultations, stock, and the audit log.',
    '',
    'Run this first. It is safe on an empty database and will fail loudly if',
    'objects already exist, rather than half-applying.',
  ]) + schemaSql + '\n',
);

// ── 02 · security ────────────────────────────────────────────
writeFileSync(
  join(outDir, '02_security.sql'),
  header('02 · Row-level security, audit protection and clinical guards', [
    'Tenant isolation on every table, an append-only audit log that not even an',
    'owner can rewrite, triggers refusing to delete clinical records, and',
    'triggers refusing to edit a published form version.',
    '',
    'Run this second, immediately after 01.',
  ]) + readFileSync(join(root, 'drizzle', securityFile), 'utf8'),
);

// ── 03 · reference data ──────────────────────────────────────
const ref: string[] = [
  header('03 · Reference data', [
    "Karsons' real data: both branches, all six pharmacists with their GPhC",
    'numbers, all eleven GP surgeries with their @gov.im prescription mailboxes,',
    'the flu vaccines with real batch numbers, and opening stock.',
    '',
    'None of this is personal data. Re-running is safe — every insert is',
    'idempotent on its primary key.',
  ]),
  'begin;',
  '',
  '-- Organisation ────────────────────────────────────────────',
  `insert into organisation (id, name, slug) values`,
  `  (${lit(ORG_ID)}, ${lit(ORGANISATION.name)}, ${lit(ORGANISATION.slug)})`,
  '  on conflict (id) do nothing;',
  '',
  '-- Companies ───────────────────────────────────────────────',
  '-- NOTE: gphc_number is null because the client has not supplied it. The',
  '-- number in the previous build was taken from an Ashcroft screenshot and is',
  '-- not his. It prints on prescriptions, so it must be correct before go-live.',
  'insert into company (id, organisation_id, name, trading_name, gphc_number, town, postcode) values',
  COMPANIES.map((c) =>
    `  (${lit(companyId(c.key))}, ${lit(ORG_ID)}, ${lit(c.name)}, ${lit(c.tradingName)}, ${lit(c.gphcNumber)}, ${lit(c.town)}, ${lit(c.postcode)})`,
  ).join(',\n'),
  'on conflict (id) do nothing;',
  '',
  '-- Branches ────────────────────────────────────────────────',
  '-- NOTE: Kirk Michael currently uses a personal Gmail address. Clinical mail',
  '-- cannot go out from it — this needs an address on the pharmacy domain.',
  'insert into branch (id, organisation_id, company_id, name, code, address_line1, town, postcode, phone, inbox_email) values',
  BRANCHES.map((b) =>
    `  (${lit(branchId(b.key))}, ${lit(ORG_ID)}, ${lit(companyId(b.companyKey))}, ${lit(b.name)}, ${lit(b.code)}, ${lit(b.addressLine1)}, ${lit(b.town)}, ${lit(b.postcode)}, ${lit(b.phone)}, ${lit(b.inboxEmail)})`,
  ).join(',\n'),
  'on conflict (id) do nothing;',
  '',
  '-- Pharmacists ─────────────────────────────────────────────',
  '-- Selecting a pharmacist auto-fills their GPhC number on the record.',
  'insert into clinician (id, organisation_id, full_name, gphc_number) values',
  CLINICIANS.map((c) =>
    `  (${lit(uuid('clinician', c.gphcNumber))}, ${lit(ORG_ID)}, ${lit(c.fullName)}, ${lit(c.gphcNumber)})`,
  ).join(',\n'),
  'on conflict (id) do nothing;',
  '',
  '-- GP surgeries ────────────────────────────────────────────',
  '-- The mailbox rides along hidden with the selection and is what the',
  '-- end-of-day notification is addressed to.',
  'insert into gp_surgery (id, organisation_id, name, email) values',
  GP_SURGERIES.map((g) =>
    `  (${lit(surgeryId(g.name))}, ${lit(ORG_ID)}, ${lit(g.name)}, ${lit(g.email)})`,
  ).join(',\n'),
  'on conflict (id) do nothing;',
  '',
  '-- Products ────────────────────────────────────────────────',
  'insert into product (id, organisation_id, name, category, allergens) values',
  PRODUCTS.map((p) =>
    `  (${lit(productId(p.key))}, ${lit(ORG_ID)}, ${lit(p.name)}, ${lit(p.category)}, ${json(p.allergens)})`,
  ).join(',\n'),
  'on conflict (id) do nothing;',
  '',
];

const batchRows: string[] = [];
const stockRows: string[] = [];
const movementRows: string[] = [];

for (const p of PRODUCTS) {
  for (const b of p.batches) {
    const bId = batchId(p.key, b.batchNumber);
    batchRows.push(
      `  (${lit(bId)}, ${lit(ORG_ID)}, ${lit(productId(p.key))}, ${lit(b.batchNumber)}, ${lit(b.expiryDate)})`,
    );
    for (const [key, qty] of [['onchan', b.onchan], ['kirk-michael', b.kirkMichael]] as const) {
      stockRows.push(
        `  (${lit(uuid('stock_level', `${bId}:${key}`))}, ${lit(ORG_ID)}, ${lit(branchId(key))}, ${lit(bId)}, ${qty})`,
      );
      movementRows.push(
        `  (${lit(uuid('stock_movement', `${bId}:${key}:opening`))}, ${lit(ORG_ID)}, ${lit(branchId(key))}, ${lit(bId)}, 'RECEIPT', ${qty}, 'Opening stock')`,
      );
    }
  }
}

if (batchRows.length) {
  ref.push(
    '-- Batches ─────────────────────────────────────────────────',
    'insert into batch (id, organisation_id, product_id, batch_number, expiry_date) values',
    batchRows.join(',\n'),
    'on conflict (id) do nothing;',
    '',
    '-- Opening stock ───────────────────────────────────────────',
    '-- Stock is a ledger. The opening balance is a movement like any other, so',
    '-- the cached level can always be reconciled against the movements.',
    'insert into stock_level (id, organisation_id, branch_id, batch_id, quantity) values',
    stockRows.join(',\n'),
    'on conflict (id) do nothing;',
    '',
    'insert into stock_movement (id, organisation_id, branch_id, batch_id, kind, quantity, reason) values',
    movementRows.join(',\n'),
    'on conflict (id) do nothing;',
    '',
  );
}

ref.push('commit;', '');
writeFileSync(join(outDir, '03_reference_data.sql'), ref.join('\n'));

// ── 04 · services and forms ──────────────────────────────────
const surgeryList = GP_SURGERIES.map((g) => ({
  id: surgeryId(g.name), name: g.name, email: g.email,
}));
const branchList = BRANCHES.map((b) => ({ id: branchId(b.key), name: b.name }));

const services = [
  {
    slug: 'flu-vaccination',
    name: 'Flu Vaccination',
    kind: 'VACCINATION',
    description: 'Seasonal influenza vaccination for adults.',
    priceMinor: 2000,
    form: buildFluVaccinationForm(surgeryList),
    ruleset: null as unknown,
  },
  {
    slug: 'weight-management-first',
    name: 'Weight Management — New Patient',
    kind: 'CONSULTATION',
    description: 'Full intake and clinical screening. Seen in person by a pharmacist.',
    priceMinor: null,
    form: buildWeightManagementNewPatientForm(branchList),
    ruleset: null as unknown,
  },
  {
    slug: 'weight-management-repeat',
    name: 'Weight Management — Repeat Request',
    kind: 'REPEAT_SUPPLY',
    description: 'Follow-up check-in for patients enrolled in Repeat Care.',
    priceMinor: null,
    form: buildWeightManagementRepeatForm(branchList),
    ruleset: GLP1_REPEAT_RULESET,
  },
];

const svc: string[] = [
  header('04 · Services, forms and clinical rules', [
    'Three services, each with its form published as version 1, plus the GLP-1',
    'decision matrix as a published ruleset.',
    '',
    'Everything here is CONFIGURATION. The client edits any of it in the Service',
    'Designer; publishing an edit creates version 2 and leaves version 1 — and',
    'everything answered against it — untouched.',
  ]),
  'begin;',
  '',
];

for (const s of services) {
  const sid = serviceId(s.slug);
  const fid = formVersionId(s.slug);
  const steps = s.form.steps.length;
  const questions = s.form.steps.reduce((n, st) => n + st.fields.length, 0);

  svc.push(
    `-- ${s.name} — ${steps} steps, ${questions} top-level questions`,
    `insert into service (id, organisation_id, name, slug, kind, description, price_minor, branch_ids) values`,
    `  (${lit(sid)}, ${lit(ORG_ID)}, ${lit(s.name)}, ${lit(s.slug)}, ${lit(s.kind)}, ${lit(s.description)}, ${s.priceMinor ?? 'null'}, '[]'::jsonb)`,
    'on conflict (id) do nothing;',
    '',
    'insert into form_version (id, organisation_id, service_id, version, schema, published_at) values',
    `  (${lit(fid)}, ${lit(ORG_ID)}, ${lit(sid)}, 1, ${json(s.form)}, now())`,
    'on conflict (id) do nothing;',
    '',
    `update service set published_form_version_id = ${lit(fid)} where id = ${lit(sid)};`,
    '',
  );

  if (s.ruleset) {
    const rid = rulesetVersionId(s.slug);
    const ruleCount = (s.ruleset as { rules: unknown[] }).rules.length;
    svc.push(
      `-- ${ruleCount} clinical rules, from the client's decision matrix`,
      'insert into ruleset_version (id, organisation_id, service_id, version, definition, published_at) values',
      `  (${lit(rid)}, ${lit(ORG_ID)}, ${lit(sid)}, 1, ${json(s.ruleset)}, now())`,
      'on conflict (id) do nothing;',
      '',
      `update service set published_ruleset_version_id = ${lit(rid)} where id = ${lit(sid)};`,
      '',
    );
  }
}

svc.push('commit;', '');
writeFileSync(join(outDir, '04_services.sql'), svc.join('\n'));

// ── 05 · synthetic patients ──────────────────────────────────
const patients = syntheticPatients(200);
const pat: string[] = [
  header('05 · Synthetic patients', [
    `${patients.length} generated patients so search, duplicate detection and the`,
    'clinical screens have something to work with.',
    '',
    'SYNTHETIC ONLY. No real patient data exists outside production, ever.',
    'Skip this script entirely in a production environment.',
  ]),
  'begin;',
  '',
  'insert into patient (id, organisation_id, first_name, last_name, date_of_birth, gender, email, phone, address_line1, town, postcode, gp_surgery_id, registered_branch_id) values',
  patients.map((p, i) => {
    const sid = surgeryList[p.gpSurgeryIndex]?.id ?? null;
    return `  (${lit(uuid('patient', String(i)))}, ${lit(ORG_ID)}, ${lit(p.firstName)}, ${lit(p.lastName)}, ${lit(p.dateOfBirth)}, ${lit(p.gender)}, ${lit(p.email)}, ${lit(p.phone)}, ${lit(p.addressLine1)}, ${lit(p.town)}, ${lit(p.postcode)}, ${lit(sid)}, ${lit(branchId(p.registeredBranchKey))})`;
  }).join(',\n'),
  'on conflict (id) do nothing;',
  '',
  'commit;',
  '',
];
writeFileSync(join(outDir, '05_patients.sql'), pat.join('\n'));

// ── 06 · staff account ───────────────────────────────────────
writeFileSync(
  join(outDir, '06_staff_account.sql'),
  header('06 · Your staff account', [
    'Run this LAST, and edit the two values first.',
    '',
    'Before running it:',
    '  1. Supabase → Authentication → Users → Add user → Create new user',
    '  2. Enter your email and tick "Auto Confirm User"',
    '  3. Open the new user and copy their UID',
    '',
    'Then replace the placeholders below.',
    '',
    'Without this, signing in succeeds but every query returns nothing — the',
    'row-level security policies key off app_user, so a session with no matching',
    'row can see nothing at all. That is the intended behaviour, but it looks',
    'like a bug the first time you meet it.',
  ]) + [
    '-- ─────────────────────────────────────────────────────────',
    "-- EDIT THESE TWO LINES",
    '-- ─────────────────────────────────────────────────────────',
    '',
    'do $$',
    'declare',
    "  v_auth_id  uuid := 'PASTE-THE-SUPABASE-AUTH-UID-HERE';",
    "  v_email    text := 'you@example.com';",
    "  v_name     text := 'Mukunda Measuria';",
    `  v_org      uuid := '${ORG_ID}';`,
    'begin',
    '  insert into app_user (id, organisation_id, full_name, email)',
    '  values (v_auth_id, v_org, v_name, v_email)',
    '  on conflict (id) do update set full_name = excluded.full_name;',
    '',
    '  -- OWNER across the whole organisation: null company and null branch means',
    '  -- organisation-wide. A locum would get a specific branch and a valid_to date.',
    '  insert into role_assignment (id, organisation_id, user_id, role, company_id, branch_id)',
    '  values (gen_random_uuid(), v_org, v_auth_id, \'OWNER\', null, null)',
    '  on conflict do nothing;',
    'end $$;',
    '',
    '-- Check it worked — this should return one row with your name.',
    'select u.full_name, u.email, r.role, r.company_id, r.branch_id',
    'from app_user u',
    'join role_assignment r on r.user_id = u.id;',
    '',
  ].join('\n'),
);

// ── 07 · scheduling ──────────────────────────────────────────
const schedulingSchema = migrations.find((f) => f.startsWith('0002'));
const schedulingSecurity = migrations.find((f) => f.startsWith('0003'));

if (schedulingSchema && schedulingSecurity) {
  writeFileSync(
    join(outDir, '07_scheduling.sql'),
    header('07 · Appointments and opening hours', [
      'Adds the two scheduling tables and their security policies.',
      '',
      'Run this AFTER 01 and 02. If you have already run 03, re-run 03 afterwards',
      'as well — it now seeds default opening hours, and those rows need these',
      'tables to exist first.',
      '',
      'Availability is stored as recurring windows rather than materialised slots,',
      'so changing opening hours never means regenerating a table.',
    ]) +
      readFileSync(join(root, 'drizzle', schedulingSchema), 'utf8')
        .split('--> statement-breakpoint')
        .join('\n') +
      '\n\n' +
      readFileSync(join(root, 'drizzle', schedulingSecurity), 'utf8') +
      '\n\n' +
      [
        '-- Default opening hours ───────────────────────────────────',
        '-- Monday to Friday all day, Saturday mornings. A null service_id means the',
        '-- window is open to every service — his GLP-1 document requires repeat-care',
        '-- appointments to share the vaccination calendar.',
        '--',
        '-- These are a starting point the client changes in Settings, not a guess he',
        '-- is stuck with. Slots are generated from these on demand, so editing hours',
        '-- never means regenerating anything.',
        'insert into availability (id, organisation_id, branch_id, service_id, weekday, start_minute, end_minute, slot_minutes, capacity) values',
        BRANCHES.flatMap((b) =>
          DEFAULT_AVAILABILITY.map(
            (w) =>
              `  (${lit(uuid('availability', `${b.key}:${w.weekday}`))}, ${lit(ORG_ID)}, ${lit(branchId(b.key))}, null, ${w.weekday}, ${w.startMinute}, ${w.endMinute}, ${w.slotMinutes}, ${w.capacity})`,
          ),
        ).join(',\n'),
        'on conflict (id) do nothing;',
        '',
      ].join('\n'),
  );
}

// ── 08 · users, roles and invite-only access ─────────────────
const rbacFile = migrations.find((f) => f.startsWith('0004'));

if (rbacFile) {
  writeFileSync(
    join(outDir, '08_users_and_roles.sql'),
    header('08 · Users, roles and invite-only access', [
      'Replaces the six hardcoded roles with an editable MODULE x ACTION grid,',
      'and closes the public sign-up door at the database.',
      '',
      'Run this AFTER 01, 02 and 03 — it needs an organisation to exist, and it',
      'migrates any existing role assignments onto the new roles.',
      '',
      'What it creates:',
      '  · role and role_permission tables, with the module list constrained',
      '  · disabled_at / disabled_by / disabled_reason on app_user',
      '  · has_perm(module, action, branch) - checks the grid, the branch scope',
      '    AND the assignment dates, and returns nothing for a disabled user',
      '  · a trigger that REJECTS public sign-up; only a marked invitation, or',
      '    the very first account when no administrator exists yet, gets through',
      '  · deferred guards keeping at least one active administrator',
      '  · Admin and Viewer as protected system roles, plus Pharmacist,',
      '    Technician and Reception as editable starting points',
      '',
      'IMPORTANT: also turn OFF email signup in the Supabase dashboard',
      '(Authentication > Providers > Email). The trigger is the backstop; the',
      'dashboard setting is the front door.',
    ]) + readFileSync(join(root, 'drizzle', rbacFile), 'utf8'),
  );
}

// ── Summary ──────────────────────────────────────────────────
const files = readdirSync(outDir).filter((f) => f.endsWith('.sql')).sort();
console.log('\n  Supabase scripts written to ./supabase\n');
for (const f of files) {
  const bytes = readFileSync(join(outDir, f), 'utf8').length;
  console.log(`    ${f.padEnd(26)} ${(bytes / 1024).toFixed(1)} KB`);
}
console.log('\n  Run them in order in the Supabase SQL Editor.\n');
