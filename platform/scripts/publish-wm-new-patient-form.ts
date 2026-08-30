/**
 * Publish the remote new-patient Weight Management questionnaire.
 *
 * The database is still serving version 1: six steps, no identity questions,
 * and no remote-versus-face-to-face gate. That version was written for a
 * service seen in person, which the client replaced on 30 August.
 *
 * Emits SQL rather than writing to the database, because that is how changes
 * are applied on this project — you run them, and you can read what you are
 * about to run first.
 *
 * Publishing rather than editing is the point. The two submissions already
 * answered against v1 stay bound to v1 and render exactly as they did; only
 * new patients get v2. That guarantee is what the whole form engine rests on,
 * and it is why this never touches the existing row.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/publish-wm-new-patient-form.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { buildWeightManagementNewPatientForm } from '../src/lib/services/weight-management';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function databaseUrl(): string {
  const env = readFileSync(join(root, '.env.local'), 'utf8');
  const match = env.match(/^DATABASE_URL="?([^"\n\r]+)"?/m);
  if (!match?.[1]) throw new Error('DATABASE_URL not found in .env.local');
  return match[1];
}

async function main() {
  const sql = postgres(databaseUrl(), { prepare: false, max: 1, connect_timeout: 15 });

  try {
    /*
     * Built against the branches actually in the database. The collection
     * dropdown embeds their ids and copies the chosen one into the submission
     * as `branchId` — an option pointing at an id that does not exist would
     * leave the request with no branch, and a prescription number is allocated
     * per branch.
     */
    const branches = await sql<{ id: string; name: string }[]>`
      select id, name from branch where archived_at is null order by name`;

    if (branches.length === 0) throw new Error('No active branches — seed them first.');

    const [service] = await sql<{ id: string; organisation_id: string; name: string }[]>`
      select id, organisation_id, name from service where slug = 'weight-management-first' limit 1`;

    if (!service) throw new Error('No weight-management-first service found.');

    const schema = buildWeightManagementNewPatientForm(
      branches.map((b) => ({ id: b.id, name: b.name })),
    );

    const json = JSON.stringify(schema);
    if (json.includes('$json$')) throw new Error('Schema contains the dollar-quote delimiter.');

    const steps = schema.steps.length;
    const fields = schema.steps.reduce((n, s) => n + s.fields.length, 0);

    const out = `-- ============================================================
-- 23 — Weight Management new-patient questionnaire, remote
--
-- Publishes a NEW version. Nothing already answered changes: submissions stay
-- bound to the version they were completed against, so the two v1 requests
-- still render as the questions those patients were actually asked.
--
-- What changes from v1:
--
--   ADDED    a pathway step. It explains this is an online service, offers
--            face-to-face care, and HARD STOPS if that is chosen — pointing at
--            the separate Karsons programme. Every later step is hidden until
--            the patient chooses to continue online, so somebody told to book
--            elsewhere cannot carry on and submit anyway.
--
--   ADDED    identity: first name, last name, date of birth, gender, phone,
--            email, address, GP surgery. v1 asked forty-two questions and not
--            one of them was a name, so every submission arrived unattached to
--            a patient record — the review queue showed "Unmatched patient"
--            and approving one raised no prescription, because there was
--            nobody to raise it for.
--
--   ADDED    the route question the client supplied: "Are you currently
--            receiving, or have you recently received, weight-management
--            treatment from another clinic?" No routes to the standard
--            questions; Yes reveals a transfer step.
--
--   ADDED    a transfer step — prior clinic, current medicine and strength,
--            when that strength started, last supply, starting weight, side
--            effects. These are the categories the client named. The exact
--            question wording and what counts as acceptable proof are still
--            with him, and are deliberately not invented here.
--
--   ADDED    evidence: photo ID, a photograph of the patient, and evidence of
--            current weight, for everyone. Evidence of the current
--            prescription for transfers only.
--
--   ADDED    a supply step — delivery or collection. The branch is asked only
--            for collection and an address only for delivery. It is not an
--            appointment: the client is explicit that neither Weight
--            Management journey creates one.
--
--   CHANGED  consent. The clause promising "an appointment to see a pharmacist
--            in person at any time" described a service this is not. It now
--            says the patient can contact the team and will be told if they
--            need to be seen.
--
--   CHANGED  title and description. No copy remains telling a patient to
--            complete this before an appointment.
--
-- Eligibility is NOT enforced in the form. The client gave the BMI criteria
-- but has not said what happens to somebody outside them — refused at the
-- form, or accepted for a pharmacist to judge. The assessment is computed and
-- shown to staff; nobody is silently passed as eligible.
--
-- Safe to run more than once? NO. Each run publishes another version. Run once.
-- ============================================================

begin;

with next as (
  select coalesce(max(version), 0) + 1 as v
    from public.form_version
   where service_id = '${service.id}'::uuid
),
inserted as (
  insert into public.form_version (organisation_id, service_id, version, schema, published_at)
  select '${service.organisation_id}'::uuid,
         '${service.id}'::uuid,
         next.v,
         $json$${json}$json$::jsonb,
         now()
    from next
  returning id, version
)
update public.service
   set published_form_version_id = inserted.id
  from inserted
 where public.service.id = '${service.id}'::uuid;

commit;

-- ── Verify ──────────────────────────────────────────────────
-- Expect: version 2, ${steps} steps, and 1 / 3 / 1 / 1 across the flags.
select s.slug,
       fv.version,
       jsonb_array_length(fv.schema->'steps')                          as steps,
       (select count(*) from jsonb_array_elements(fv.schema->'steps') st
         where st->>'id' = 'pathway')                                  as has_pathway_gate,
       (select count(*) from jsonb_array_elements(fv.schema->'steps') st,
                             jsonb_array_elements(st->'fields') f
         where f->>'id' in ('firstName','lastName','dateOfBirth'))     as identity_fields,
       (select count(*) from jsonb_array_elements(fv.schema->'steps') st
         where st->>'id' = 'transfer')                                 as has_transfer_branch,
       (select count(*) from jsonb_array_elements(fv.schema->'steps') st
         where st->>'id' = 'supply')                                   as has_supply_step,
       (fv.schema::text like '%before your appointment%')              as still_says_appointment
  from public.service s
  join public.form_version fv on fv.id = s.published_form_version_id
 where s.slug = 'weight-management-first';
`;

    const path = join(root, '..', 'docs', 'pending-migrations', '23_wm_new_patient_form.sql');
    writeFileSync(path, out, 'utf8');

    console.log('Wrote docs/pending-migrations/23_wm_new_patient_form.sql');
    console.log(`  ${steps} steps, ${fields} top-level questions`);
    console.log(`  ${branches.length} branches: ${branches.map((b) => b.name).join(', ')}`);
    console.log(`  service ${service.id} (${service.name})`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
