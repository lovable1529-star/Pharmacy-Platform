import 'server-only';

/**
 * Allocating a prescription number.
 *
 * The number comes from the database, once, and then belongs to that
 * consultation permanently. It is not computed from anything — a number
 * derived from an id can collide, and the previous implementation did.
 *
 * Allocation is idempotent: reprinting a prescription returns the number it
 * already has rather than burning a new one, or a single supply ends up with
 * two references and neither is authoritative.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

/**
 * A number for a supply that never had a consultation.
 *
 * The remote Weight Management journey has no appointment and therefore no
 * consultation row, so the original allocator raised "Consultation does not
 * exist" and the prescription was issued unnumbered. Both draw from the same
 * per-branch, per-year sequence — two series would let one number describe two
 * different supplies.
 */
export async function allocatePrescriptionNumberForSubmission(
  submissionId: string,
): Promise<string | null> {
  try {
    const result = await db.execute(
      sql`select public.allocate_prescription_number_for_submission(${submissionId}::uuid) as number`,
    );

    const row = (result as unknown as { number?: string }[])[0];
    return row?.number ?? null;
  } catch (error) {
    console.error('allocatePrescriptionNumberForSubmission failed', error);
    return null;
  }
}

export async function allocatePrescriptionNumber(
  consultationId: string,
): Promise<string | null> {
  try {
    const result = await db.execute(
      sql`select public.allocate_prescription_number(${consultationId}::uuid) as number`,
    );

    const row = (result as unknown as { number?: string }[])[0];
    return row?.number ?? null;
  } catch (error) {
    // A prescription that cannot be numbered must not be silently issued with a
    // made-up one — the caller decides what to show.
    console.error('allocatePrescriptionNumber failed', error);
    return null;
  }
}
