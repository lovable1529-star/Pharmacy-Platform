/**
 * Demonstration data, and a way to remove it again.
 *
 * The platform works and has almost nothing in it. `rule_evaluation` holds
 * zero rows, so the RAG triage — arguably the cleverest thing here — has never
 * once been seen working; the due list is empty because the one enrolled
 * patient was supplied yesterday; Reports shows no money because nothing has
 * been paid for. Shown like that the system looks like a set of empty screens.
 *
 * This fills them with a handful of patients whose stories are worth telling,
 * and does it by running the REAL code paths — the same `deriveValues` and
 * `evaluateRuleset` a live submission goes through — so what appears on the
 * screens is what the engine actually decided, not a fabricated colour that
 * would fall apart the moment somebody opened the trace.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/seed-demo.ts
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/seed-demo.ts --wipe
 *
 * Everything created is tagged by an @demo.invalid email address. `.invalid`
 * is reserved by RFC 2606 and can never resolve, so a stray notification can
 * never reach a real person — and the wipe has an unambiguous handle to find
 * its own rows by. Nothing else in the database is touched.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { deriveValues } from '../src/lib/clinical/derived';
import { evaluateRuleset } from '../src/lib/rules/engine';
import { generateRepeatReference } from '../src/lib/repeat-care/reference';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The tag. Every seeded patient has an email ending in this. */
const DEMO_DOMAIN = '@demo.invalid';

function databaseUrl(): string {
  const env = readFileSync(join(root, '.env.local'), 'utf8');
  const match = env.match(/^DIRECT_URL="?([^"\n\r]+)"?/m)
    ?? env.match(/^DATABASE_URL="?([^"\n\r]+)"?/m);
  if (!match?.[1]) throw new Error('No DIRECT_URL or DATABASE_URL in .env.local');
  return match[1];
}

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * The cast.
 *
 * Chosen so every screen has something true to show: one of each RAG colour on
 * the repeat queue, one patient due, one lapsed, one who has paid. The answers
 * are the ones that actually drive those outcomes rather than a colour asserted
 * alongside them.
 */
const PEOPLE = [
  {
    key: 'green',
    first: 'Ruth', last: 'Kelly', dob: '1979-06-11',
    // Everything stable: same dose, no effects, on target.
    answers: {
      consultType: 'online', doseRequest: 'same', adverseEffects: 'none',
      missedDoses: '0', weeksOnDose: '8', hydration: 'high',
      appetiteSuppression: 'full', snacking: 'controlled', historyChanged: 'no',
      pregnancy: 'no', supplyQuantity: '1', currentMedicine: 'mounjaro_5mg',
    },
    weightKg: 84, heightCm: 165, previousWeightKg: 88,
    previousMedicineValue: 'mounjaro_5mg',
    enrol: { medicine: 'Mounjaro', strength: '5mg', suppliedDaysAgo: 3 },
    paid: 10000,
  },
  {
    key: 'amber',
    first: 'Peter', last: 'Cregeen', dob: '1968-02-23',
    // Asking to go up before three weeks on the current strength.
    answers: {
      consultType: 'online', doseRequest: 'increase', adverseEffects: 'mild',
      missedDoses: '0', weeksOnDose: '2', hydration: 'low',
      appetiteSuppression: 'wearing_off', snacking: 'occasional',
      historyChanged: 'no', pregnancy: 'no', supplyQuantity: '1',
      currentMedicine: 'mounjaro_5mg', requestedMedicine: 'mounjaro_7.5mg',
    },
    weightKg: 101, heightCm: 178, previousWeightKg: 103,
    previousMedicineValue: 'mounjaro_5mg',
    enrol: { medicine: 'Mounjaro', strength: '5mg', suppliedDaysAgo: 26 },
    paid: 10000,
  },
  {
    key: 'red',
    first: 'Sinead', last: 'Corlett', dob: '1991-09-30',
    // Two missed doses and troublesome effects.
    answers: {
      consultType: 'online', doseRequest: 'same', adverseEffects: 'severe',
      missedDoses: '2+', weeksOnDose: '6', hydration: 'low',
      appetiteSuppression: 'poor', snacking: 'frequent', historyChanged: 'yes',
      pregnancy: 'no', supplyQuantity: '1', currentMedicine: 'wegovy_1mg',
    },
    weightKg: 96, heightCm: 170, previousWeightKg: 97,
    previousMedicineValue: 'wegovy_1mg',
    enrol: { medicine: 'Wegovy', strength: '1mg', suppliedDaysAgo: 30 },
    paid: null,
  },
  {
    key: 'due',
    first: 'Alan', last: 'Quayle', dob: '1974-11-05',
    answers: null, // enrolled, no request waiting — this is the chase list
    weightKg: 108, heightCm: 180, previousWeightKg: 112,
    previousMedicineValue: 'mounjaro_7.5mg',
    enrol: { medicine: 'Mounjaro', strength: '7.5mg', suppliedDaysAgo: 34 },
    paid: 10000,
  },
  {
    key: 'lapsed',
    first: 'Maureen', last: 'Faragher', dob: '1962-04-18',
    answers: null,
    weightKg: 79, heightCm: 158, previousWeightKg: 86,
    previousMedicineValue: 'wegovy_1.7mg',
    enrol: { medicine: 'Wegovy', strength: '1.7mg', suppliedDaysAgo: 71 },
    paid: 10000,
  },
] as const;

/**
 * Retire the demo data. It cannot be deleted, and that is deliberate.
 *
 * A database trigger refuses DELETE on patient, submission, rule_evaluation,
 * resource_acknowledgement, consultation, appointment and several others:
 * "Clinical records cannot be deleted. Set archived_at, or create a new
 * version." That rule is correct and this script does not get an exception
 * from it.
 *
 * So retiring does what the system permits and says what it cannot:
 *
 *   patients          archived, which removes them from every list
 *   submissions       closed, which removes them from the queue
 *   enrolments        deleted, so they leave the due list
 *   payments          deleted, so they leave the revenue figures
 *   rule evaluations  KEPT — they are clinical history and cannot go
 *
 * The consequence is worth stating before anybody runs the seed: on a
 * production database this data is permanent. Five archived patients and three
 * closed submissions are harmless, but they are there for good. Run the seed on
 * a staging copy if that matters.
 */
async function retire(sql: postgres.Sql) {
  const patients = await sql<{ id: string }[]>`
    select id from patient where email like ${'%' + DEMO_DOMAIN}`;

  if (patients.length === 0) {
    console.log('Nothing to retire — no demo patients found.');
    return;
  }

  const ids = patients.map((p) => p.id);

  // Removable: neither is clinical history.
  await sql`delete from payment where patient_id = any(${ids})`;
  await sql`delete from repeat_enrolment where patient_id = any(${ids})`;

  // Closed rather than removed, which is how the system retires a request.
  const closed = await sql`
    update submission set status = 'COMPLETED'
     where patient_id = any(${ids}) and status <> 'COMPLETED'
     returning id`;

  await sql`
    update patient set archived_at = now()
     where id = any(${ids}) and archived_at is null`;

  console.log(`Retired ${ids.length} demo patients: archived, `
    + `${closed.length} requests closed, payments and enrolments removed.`);
  console.log('Their submissions and rule evaluations remain — clinical records '
    + 'cannot be deleted.');
}

async function main() {
  const sql = postgres(databaseUrl(), { prepare: false, max: 1, connect_timeout: 15 });

  try {
    if (process.argv.includes('--wipe')) {
      await retire(sql);
      return;
    }

    // Idempotent by construction: seeding twice would double the queue.
    await retire(sql);

    const [org] = await sql<{ id: string }[]>`select id from organisation limit 1`;
    const [branch] = await sql<{ id: string }[]>`
      select id from branch where archived_at is null order by name limit 1`;

    const [repeatSvc] = await sql<{
      id: string; form_version_id: string; ruleset_version_id: string;
      definition: Record<string, unknown>; price_minor: number | null;
    }[]>`
      select s.id,
             s.published_form_version_id as form_version_id,
             s.published_ruleset_version_id as ruleset_version_id,
             rv.definition,
             s.price_minor
        from service s
        join ruleset_version rv on rv.id = s.published_ruleset_version_id
       where s.slug = 'weight-management-repeat'`;

    if (!org || !branch || !repeatSvc) {
      throw new Error('Expected an organisation, a branch and a published repeat service.');
    }

    let submissions = 0;
    let evaluations = 0;

    for (const person of PEOPLE) {
      /*
       * Reused rather than recreated.
       *
       * Patients cannot be deleted, so a seed that inserted afresh every time
       * would leave five more of them in the record on every run — permanently.
       * Retiring archives them; seeding brings the same five back.
       */
      const email = `${person.first}.${person.last}`.toLowerCase() + DEMO_DOMAIN;

      // Oldest first, so repeated runs always reuse the same row rather than
      // alternating between duplicates left by an earlier version of this script.
      const [existing] = await sql<{ id: string }[]>`
        select id from patient where email = ${email}
         order by created_at asc limit 1`;

      let patient = existing;

      if (patient) {
        await sql`update patient set archived_at = null where id = ${patient.id}`;
      } else {
        [patient] = await sql<{ id: string }[]>`
          insert into patient
            (organisation_id, first_name, last_name, date_of_birth, email, phone)
          values (${org.id}, ${person.first}, ${person.last}, ${person.dob},
                  ${email}, '01624 000000')
          returning id`;
      }

      await sql`
        insert into repeat_enrolment
          (organisation_id, patient_id, service_id, status, external_ref,
           medicine, strength, strength_since, last_supplied_at,
           height_cm, starting_weight_kg, last_weight_kg)
        values (${org.id}, ${patient!.id}, ${repeatSvc.id}, 'ACTIVE',
                ${generateRepeatReference()},
                ${person.enrol.medicine}, ${person.enrol.strength},
                ${ago(person.enrol.suppliedDaysAgo + 28).toISOString().slice(0, 10)},
                ${ago(person.enrol.suppliedDaysAgo)},
                ${person.heightCm}, ${person.previousWeightKg}, ${person.weightKg})`;

      const pay = async (submissionId: string | null) => {
        if (person.paid === null) return;
        await sql`
          insert into payment
            (organisation_id, patient_id, submission_id, branch_id, amount_minor,
             description, status, provider, access_token, paid_at, created_at)
          values (${org.id}, ${patient!.id}, ${submissionId}, ${branch.id},
                  ${person.paid}, 'Weight management supply', 'PAID', 'DEMO',
                  ${'demo-' + Math.random().toString(36).slice(2)},
                  ${ago(person.enrol.suppliedDaysAgo)},
                  ${ago(person.enrol.suppliedDaysAgo)})`;
      };

      if (!person.answers) {
        // Enrolled with no request in flight. Their payment has no submission
        // to hang off, which is the case the revenue breakdown now handles.
        await pay(null);
        continue;
      }

      /*
       * The real path from here: derive, evaluate, store the trace. A colour
       * asserted rather than computed would fall apart the moment somebody
       * opened the decision trace on the screen.
       */
      const answers = { ...person.answers } as Record<string, unknown>;

      const derived = deriveValues({
        answers,
        weightKg: person.weightKg,
        heightCm: person.heightCm,
        dateOfBirth: person.dob,
        previousMedicineValue: person.previousMedicineValue,
        previousWeightKg: person.previousWeightKg,
      });

      const [submission] = await sql<{ id: string }[]>`
        insert into submission
          (organisation_id, service_id, form_version_id, patient_id, branch_id,
           status, answers, derived, created_at)
        values (${org.id}, ${repeatSvc.id}, ${repeatSvc.form_version_id},
                ${patient!.id}, ${branch.id}, 'SUBMITTED',
                ${sql.json(answers)}, ${sql.json(derived as never)},
                ${ago(1)})
        returning id`;

      submissions += 1;
      await pay(submission!.id);

      const result = evaluateRuleset(
        repeatSvc.definition as never,
        { answers, derived } as never,
      );

      await sql`
        insert into rule_evaluation
          (organisation_id, submission_id, ruleset_version_id, outcome,
           deciding_rule_id, trace, advice, evaluated_at)
        values (${org.id}, ${submission!.id}, ${repeatSvc.ruleset_version_id},
                ${result.outcome}, ${result.decidingRuleId},
                ${sql.json(result.trace as never)},
                ${sql.json(result.advice as never)}, ${ago(1)})`;

      evaluations += 1;

      console.log(
        `  ${person.first} ${person.last}: ${result.outcome}`
        + `${result.decidingRuleId ? ` — ${result.decidingRuleId}` : ' — default'}`,
      );
    }

    console.log(`\nSeeded ${PEOPLE.length} patients, ${submissions} requests, `
      + `${evaluations} evaluations.`);
    console.log('Remove with: npx tsx --tsconfig scripts/tsconfig.json scripts/seed-demo.ts --wipe');
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
