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
