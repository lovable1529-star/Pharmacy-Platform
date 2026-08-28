/**
 * Loading the dose ladders from the medicine master.
 *
 * The ladders used to be a constant in the source, which meant adding a
 * strength — or correcting one — was a code change and a deploy. §12 requires
 * the medicine master to be configuration, and the specification's own note is
 * blunter still: values that cannot be confirmed from the recordings "should be
 * configurable in the admin panel rather than hard-coded".
 *
 * Ordering is the clinical content here. "Only same or ±1 step" is a safety
 * rule and a step is the distance between two rungs, so the query orders by
 * position and nothing downstream re-sorts.
 *
 * Falls back to the built-in ladders when the master is empty. That matters
 * during the migration: until the seed has run, a rule reading
 * `derived.doseStepChange` would otherwise start returning null again and the
 * dose-skip block would silently stop firing — the exact failure this project
 * has already had once.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import { medicine, medicineStrength } from '@/lib/db/schema';
import { DOSE_LADDERS, type DoseLadders } from './derived';

export async function loadDoseLadders(
  tx: Tx,
  organisationId: string,
): Promise<DoseLadders> {
  const rows = await tx
    .select({
      brand: medicine.brand,
      label: medicineStrength.label,
      position: medicineStrength.position,
    })
    .from(medicineStrength)
    .innerJoin(medicine, eq(medicineStrength.medicineId, medicine.id))
    .where(
      and(
        eq(medicine.organisationId, organisationId),
        eq(medicine.active, true),
        eq(medicineStrength.active, true),
      ),
    )
    .orderBy(asc(medicine.brand), asc(medicineStrength.position));

  if (rows.length === 0) return DOSE_LADDERS;

  const ladders: DoseLadders = {};
  for (const row of rows) {
    (ladders[row.brand] ??= []).push(row.label);
  }

  return ladders;
}
