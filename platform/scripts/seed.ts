/**
 * Seeds a Supabase database with Karsons' real reference data.
 *
 * Reference data (branches, pharmacists, GP surgeries, vaccines, batches) is
 * REAL — it is not personal data, and seeing his own pharmacists in the
 * dropdowns is a large part of what makes the system feel like his.
 *
 * Patients are synthetic and deterministic. No real patient data exists outside
 * production, ever.
 *
 * Safe to re-run: it detects an existing organisation and stops rather than
 * duplicating. Pass --reset to wipe and rebuild (development only).
 *
 *   pnpm db:seed
 *   pnpm db:seed -- --reset
 */

import './env.mjs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as s from '../src/lib/db/schema';
import {
  ORGANISATION, COMPANIES, BRANCHES, CLINICIANS, GP_SURGERIES, PRODUCTS,
  syntheticPatients,
} from '../src/lib/seed/karsons';
import { buildFluVaccinationForm } from '../src/lib/services/flu-vaccination';
import {
  buildWeightManagementNewPatientForm,
  buildWeightManagementRepeatForm,
} from '../src/lib/services/weight-management';
import type { FormSchema } from '../src/types/form-schema';

const RESET = process.argv.includes('--reset');

const url = process.env.DIRECT_URL;
if (!url) {
  console.error(
    '\n  DIRECT_URL is not set.\n' +
    '  Copy .env.example to .env.local and fill it in from your Supabase project.\n' +
    '  Migrations and seeding need the DIRECT connection on port 5432, not the pooled 6543.\n',
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const db = drizzle(sql, { schema: s });

function step(message: string) {
  process.stdout.write(`  ${message}\n`);
}

async function main() {
  step('Connecting…');

  const existing = await db
    .select({ id: s.organisation.id })
    .from(s.organisation)
    .where(eq(s.organisation.slug, ORGANISATION.slug))
    .limit(1);

  if (existing.length && !RESET) {
    step('Organisation already seeded. Pass --reset to wipe and rebuild.');
    await sql.end();
    return;
  }

  if (existing.length && RESET) {
    step('Resetting — deleting existing data…');
    // Order matters: children before parents. Triggers block deleting clinical
    // rows, so drop them for the duration of a development reset.
    await sql.unsafe(`
      set session_replication_role = replica;
      truncate table
        audit_event, review_event, rule_evaluation, consultation, submission,
        ruleset_version, form_version, service, allergy, patient,
        stock_movement, stock_level, batch, product, clinician, gp_surgery,
        role_assignment, app_user, branch, company, organisation
      restart identity cascade;
      set session_replication_role = default;
    `);
  }

  // ── Tenancy ────────────────────────────────────────────────
  step('Creating organisation, company and branches…');

  const [org] = await db
    .insert(s.organisation)
    .values({ name: ORGANISATION.name, slug: ORGANISATION.slug })
    .returning();
  if (!org) throw new Error('Failed to create organisation.');

  const companyIds = new Map<string, string>();
  for (const c of COMPANIES) {
    const [row] = await db
      .insert(s.company)
      .values({
        organisationId: org.id,
        name: c.name,
        tradingName: c.tradingName,
        gphcNumber: c.gphcNumber,
        town: c.town,
        postcode: c.postcode,
      })
      .returning();
    if (row) companyIds.set(c.key, row.id);
  }

  const branchIds = new Map<string, string>();
  for (const b of BRANCHES) {
    const companyId = companyIds.get(b.companyKey);
    if (!companyId) continue;
    const [row] = await db
      .insert(s.branch)
      .values({
        organisationId: org.id,
        companyId,
        name: b.name,
        code: b.code,
        addressLine1: b.addressLine1,
        town: b.town,
        postcode: b.postcode,
        phone: b.phone,
        inboxEmail: b.inboxEmail,
      })
      .returning();
    if (row) branchIds.set(b.key, row.id);
  }

  // ── Reference data ─────────────────────────────────────────
  step(`Adding ${CLINICIANS.length} pharmacists and ${GP_SURGERIES.length} GP surgeries…`);

  await db.insert(s.clinician).values(
    CLINICIANS.map((c) => ({
      organisationId: org.id,
      fullName: c.fullName,
      gphcNumber: c.gphcNumber,
    })),
  );

  const surgeryRows = await db
    .insert(s.gpSurgery)
    .values(GP_SURGERIES.map((g) => ({ organisationId: org.id, name: g.name, email: g.email })))
    .returning();

  step('Adding vaccines, batches and opening stock…');

  for (const p of PRODUCTS) {
    const [productRow] = await db
      .insert(s.product)
      .values({
        organisationId: org.id,
        name: p.name,
        category: p.category,
        allergens: p.allergens,
      })
      .returning();
    if (!productRow) continue;

    for (const b of p.batches) {
      const [batchRow] = await db
        .insert(s.batch)
        .values({
          organisationId: org.id,
          productId: productRow.id,
          batchNumber: b.batchNumber,
          expiryDate: b.expiryDate,
        })
        .returning();
      if (!batchRow) continue;

      for (const [branchKey, quantity] of [
        ['onchan', b.onchan],
        ['kirk-michael', b.kirkMichael],
      ] as const) {
        const branchId = branchIds.get(branchKey);
        if (!branchId) continue;

        await db.insert(s.stockLevel).values({
          organisationId: org.id,
          branchId,
          batchId: batchRow.id,
          quantity,
        });

        // Stock is a ledger. The opening balance is a movement like any other,
        // so the cached level can always be reconciled against the movements.
        await db.insert(s.stockMovement).values({
          organisationId: org.id,
          branchId,
          batchId: batchRow.id,
          kind: 'RECEIPT',
          quantity,
          reason: 'Opening stock',
        });
      }
    }
  }

  // ── Services ───────────────────────────────────────────────
  //
  // Each service is created with its form published as version 1. Everything
  // below is configuration — the client edits any of it in the Service Designer,
  // and publishing an edit creates version 2 without touching what patients have
  // already answered against version 1.

  const branchList = BRANCHES.flatMap((b) => {
    const id = branchIds.get(b.key);
    return id ? [{ id, name: b.name }] : [];
  });

  const surgeryList = surgeryRows.map((r) => ({ id: r.id, name: r.name, email: r.email }));

  async function publishService(input: {
    name: string;
    slug: string;
    kind: 'VACCINATION' | 'REPEAT_SUPPLY' | 'CONSULTATION';
    description: string;
    priceMinor: number | null;
    form: FormSchema;
  }) {
    const [row] = await db
      .insert(s.service)
      .values({
        organisationId: org!.id,
        name: input.name,
        slug: input.slug,
        kind: input.kind,
        description: input.description,
        priceMinor: input.priceMinor,
        branchIds: [],
      })
      .returning();
    if (!row) throw new Error(`Failed to create the ${input.name} service.`);

    const [version] = await db
      .insert(s.formVersion)
      .values({
        organisationId: org!.id,
        serviceId: row.id,
        version: 1,
        schema: input.form as unknown as Record<string, unknown>,
        publishedAt: new Date(),
      })
      .returning();

    if (version) {
      await db
        .update(s.service)
        .set({ publishedFormVersionId: version.id })
        .where(eq(s.service.id, row.id));
    }

    const questions = input.form.steps.reduce((n, st) => n + st.fields.length, 0);
    step(`  · ${input.name} — ${input.form.steps.length} steps, ${questions} top-level questions`);
    return row;
  }

  step('Publishing services…');

  await publishService({
    name: 'Flu Vaccination',
    slug: 'flu-vaccination',
    kind: 'VACCINATION',
    description: 'Seasonal influenza vaccination for adults.',
    priceMinor: 2000,
    form: buildFluVaccinationForm(surgeryList),
  });

  await publishService({
    name: 'Weight Management — New Patient',
    slug: 'weight-management-first',
    kind: 'CONSULTATION',
    description: 'Full intake and clinical screening. Seen in person by a pharmacist.',
    priceMinor: null,
    form: buildWeightManagementNewPatientForm(branchList),
  });

  await publishService({
    name: 'Weight Management — Repeat Request',
    slug: 'weight-management-repeat',
    kind: 'REPEAT_SUPPLY',
    description: 'Follow-up check-in for patients enrolled in Repeat Care.',
    priceMinor: null,
    form: buildWeightManagementRepeatForm(branchList),
  });

  // ── Patients ───────────────────────────────────────────────
  const patients = syntheticPatients(200);
  step(`Adding ${patients.length} synthetic patients…`);

  await db.insert(s.patient).values(
    patients.map((p) => ({
      organisationId: org.id,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      gender: p.gender,
      email: p.email,
      phone: p.phone,
      addressLine1: p.addressLine1,
      town: p.town,
      postcode: p.postcode,
      gpSurgeryId: surgeryRows[p.gpSurgeryIndex]?.id ?? null,
      registeredBranchId: branchIds.get(p.registeredBranchKey) ?? null,
    })),
  );

  // ── Staff account ──────────────────────────────────────────
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminAuthId = process.env.SEED_ADMIN_AUTH_ID;

  if (adminEmail && adminAuthId) {
    step(`Linking staff account for ${adminEmail}…`);
    await db.insert(s.appUser).values({
      id: adminAuthId,
      organisationId: org.id,
      fullName: process.env.SEED_ADMIN_NAME ?? 'Mukunda Measuria',
      email: adminEmail,
    });
    await db.insert(s.roleAssignment).values({
      organisationId: org.id,
      userId: adminAuthId,
      role: 'OWNER',
      companyId: null,
      branchId: null,
    });
  } else {
    step('No SEED_ADMIN_AUTH_ID set — skipping the staff account. See SETUP.md step 6.');
  }

  step('');
  step('Done.');
  step(`  Organisation  ${org.name}`);
  step(`  Branches      ${BRANCHES.map((b) => b.name).join(', ')}`);
  step(`  Pharmacists   ${CLINICIANS.length}`);
  step(`  GP surgeries  ${GP_SURGERIES.length}`);
  step(`  Patients      ${patients.length} (synthetic)`);
  step('');

  await sql.end();
}

main().catch(async (error) => {
  console.error('\nSeed failed:\n', error);
  await sql.end();
  process.exit(1);
});
