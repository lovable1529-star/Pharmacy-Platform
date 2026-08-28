/**
 * Publish the corrected flu questionnaire as a new version.
 *
 * The published version in the database (v3) had drifted from the definition in
 * this repository. Someone had added a "Feedback" step through the designer
 * carrying a REQUIRED question — "Was it difficult to fill the form ?" — which
 * every patient had to answer before they could submit. It also predates the
 * partner's specification and was missing three of the nine questions in §25.4:
 * breastfeeding, bleeding disorder / anticoagulants, and current medication.
 *
 * This emits SQL rather than writing to the database, because that is how
 * changes are applied on this project — you run them, and you can read what you
 * are about to run first.
 *
 * Publishing rather than editing is deliberate. The version already answered by
 * patients stays exactly as it was; only new submissions get v4. That is the
 * guarantee the whole form engine rests on.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/publish-flu-form.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { buildFluVaccinationForm } from '../src/lib/services/flu-vaccination';

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
    // Build against the surgeries actually in the database: the GP dropdown
    // embeds their ids, and an option pointing at an id that does not exist
    // would silently fail to match on submission.
    const surgeries = await sql<{ id: string; name: string; email: string }[]>`
      select id, name, email from gp_surgery where archived_at is null order by name`;

    if (surgeries.length === 0) throw new Error('No active GP surgeries — seed them first.');

    const [service] = await sql<{ id: string; organisation_id: string }[]>`
      select id, organisation_id from service where slug = 'flu-vaccination' limit 1`;

    if (!service) throw new Error('No flu-vaccination service found.');

    const schema = buildFluVaccinationForm(
      surgeries.map((s) => ({ id: s.id, name: s.name, email: s.email })),
    );

    const json = JSON.stringify(schema);
    if (json.includes('$json$')) throw new Error('Schema contains the dollar-quote delimiter.');

    const out = `-- ============================================================
-- 15 — Flu questionnaire, corrected to the partner's specification
--
-- Publishes a NEW version. Nothing already answered changes: submissions stay
-- bound to the version they were completed against, which is why editing a live
-- form is safe here.
--
-- What changes from v3:
--
--   REMOVED  the "Feedback" step and its required question
--            "Was it difficult to fill the form ?" — a leftover from trying
--            out the designer, which every patient had to answer.
--
--   ADDED    breastfeeding                (§25.4 Q2, hidden for male patients)
--            bleedingDisorder             (§25.4 Q6)
--            currentMedication + detail   (§25.4 Q7 / Q7A)
--
--   CHANGED  fluVaccineLast6Months retired in favour of fluVaccineThisSeason.
--            The season is the clinically relevant window, and a rolling six
--            months answers a different question either side of a season
--            boundary. Retired rather than relabelled: an id must keep meaning
--            what it meant, and v3 submissions still render against v3.
--
--            pregnant moved from Yes/No/NA to Yes/No, since the gender rule
--            already hides it where it does not apply.
--
--   ORDER    now follows §25.4, with fever first — the specification numbers
--            it Q1 and requires it high in the pharmacist's view. It remains
--            clinician-only: it asks about the day of the appointment.
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
select s.slug,
       fv.version,
       jsonb_array_length(fv.schema->'steps')                       as steps,
       (fv.schema::text like '%Was it difficult%')                  as still_has_feedback_question,
       (fv.schema::text like '%breastfeeding%')                     as has_breastfeeding,
       (fv.schema::text like '%bleedingDisorder%')                  as has_bleeding_disorder,
       (fv.schema::text like '%currentMedication%')                 as has_current_medication
  from public.service s
  join public.form_version fv on fv.id = s.published_form_version_id
 where s.slug = 'flu-vaccination';
`;

    const path = join(root, 'supabase', '15_flu_form_v4.sql');
    writeFileSync(path, out, 'utf8');

    const steps = schema.steps.length;
    const fields = schema.steps.reduce((n, s) => n + s.fields.length, 0);
    console.log(`Wrote supabase/15_flu_form_v4.sql`);
    console.log(`  ${steps} steps, ${fields} top-level questions, ${surgeries.length} surgeries`);
    console.log(`  service ${service.id}`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
