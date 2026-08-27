import './env.mjs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, isNull, and } from 'drizzle-orm';
import * as s from '../src/lib/db/schema';
import { generateSlotsForRange } from '../src/lib/scheduling/slots';

const sql = postgres(process.env.DIRECT_URL!, { max: 1 });
const db = drizzle(sql, { schema: s });

async function main() {
  const branches = await db.select({ id: s.branch.id, name: s.branch.name })
    .from(s.branch).where(isNull(s.branch.archivedAt));
  const services = await db.select({ id: s.service.id, name: s.service.name })
    .from(s.service).where(isNull(s.service.archivedAt));

  const branch = branches[0]!;
  const service = services[0]!;

  const windows = (await db.select().from(s.availability)
    .where(and(eq(s.availability.branchId, branch.id), isNull(s.availability.archivedAt))))
    .map((r) => ({
      id: r.id, branchId: r.branchId, serviceId: r.serviceId, weekday: r.weekday,
      startMinute: r.startMinute, endMinute: r.endMinute,
      slotMinutes: r.slotMinutes, capacity: r.capacity,
      effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
    }));

  const days = generateSlotsForRange({
    windows, bookings: [], from: new Date(), days: 7,
    branchId: branch.id, serviceId: service.id, leadTimeMinutes: 120,
  });

  console.log(`\n  ${branch.name} — ${service.name}`);
  console.log(`  ${windows.length} availability windows loaded from the database\n`);

  let total = 0;
  for (const d of days) {
    total += d.slots.length;
    const label = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      .format(new Date(`${d.date}T12:00:00`));
    const first = d.slots[0];
    const last = d.slots.at(-1);
    // Show the PHARMACY's clock, not this machine's — printing server-local
    // time is exactly the confusion this whole fix was about.
    const clock = (x: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Europe/Isle_of_Man',
      }).format(x);
    console.log(
      `  ${label.padEnd(12)} ${String(d.slots.length).padStart(3)} slots` +
      (first && last ? `   ${clock(first.startsAt)}–${clock(last.endsAt)}` : '   (closed)'),
    );
  }
  console.log(`\n  ${total} bookable slots over the next 7 days.\n`);
  await sql.end();
}

main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
