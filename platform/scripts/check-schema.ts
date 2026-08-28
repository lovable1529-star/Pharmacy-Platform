/**
 * Confirms every migration the app now depends on has actually been applied.
 *
 * Cheaper than discovering a missing column mid-demo, and read-only.
 */
import './env.mjs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

const CHECKS: { label: string; script: string; kind: 'table' | 'column'; a: string; b?: string }[] = [
  { label: 'resume tokens',        script: '09', kind: 'column', a: 'submission',  b: 'resume_token' },
  { label: 'consultation guard',   script: '09', kind: 'table',  a: 'consultation' },
  { label: 'arrival time',         script: '11', kind: 'column', a: 'appointment', b: 'arrived_at' },
  { label: 'reminder tracking',    script: '11', kind: 'column', a: 'appointment', b: 'reminder_sent_at' },
  { label: 'consultation addenda', script: '11', kind: 'table',  a: 'consultation_addendum' },
  { label: 'notification outbox',  script: '11', kind: 'table',  a: 'notification' },
  { label: 'GP send tracking',     script: '11', kind: 'column', a: 'consultation', b: 'gp_notified_at' },
  { label: 'repeat care',          script: '12', kind: 'table',  a: 'repeat_enrolment' },
  { label: 'payments',             script: '13', kind: 'table',  a: 'payment' },
];

async function main() {
  let missing = 0;
  console.log('');

  for (const c of CHECKS) {
    const rows = c.kind === 'table'
      ? await sql`select 1 from information_schema.tables
                   where table_schema = 'public' and table_name = ${c.a} limit 1`
      : await sql`select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = ${c.a}
                     and column_name = ${c.b!} limit 1`;

    const ok = rows.length > 0;
    if (!ok) missing += 1;
    console.log(`  ${ok ? 'OK  ' : 'MISS'}  ${c.script}  ${c.label}`);
  }

  // Storage bucket, which script 10 creates.
  const bucket = await sql`select public from storage.buckets where id = 'patient-uploads' limit 1`;
  const b = bucket[0];
  console.log(`  ${b ? 'OK  ' : 'MISS'}  10  uploads bucket${b ? (b.public ? '  (WARNING: public!)' : ' (private)') : ''}`);
  if (!b) missing += 1;

  console.log('');
  console.log(missing === 0 ? '  All migrations applied.' : `  ${missing} missing — run those scripts.`);
  await sql.end();
  process.exit(missing === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
