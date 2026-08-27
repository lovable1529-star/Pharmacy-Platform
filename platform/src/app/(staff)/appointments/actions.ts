'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { appointment } from '@/lib/db/schema';

/**
 * Checking a patient in.
 *
 * Small, but it is a clinical event — it is the record that someone attended —
 * so it goes through the same scoped, audited path as everything else rather
 * than being a quiet status update.
 */
const arrive = action<{ appointmentId: string }>('appointments:edit').handler(
  async (input, { tx }) => {
    const [updated] = await tx
      .update(appointment)
      .set({ status: 'ARRIVED', updatedAt: new Date() })
      .where(eq(appointment.id, input.appointmentId))
      .returning({ id: appointment.id, reference: appointment.reference });

    if (!updated) throw new Error('That appointment no longer exists.');

    return {
      result: { id: updated.id },
      audit: {
        action: 'appointment.arrived',
        entityType: 'appointment',
        entityId: updated.id,
        after: { reference: updated.reference },
      },
    };
  },
);

export async function markArrived(appointmentId: string) {
  try {
    await arrive({ appointmentId });
    revalidatePath('/appointments');
    return { ok: true as const };
  } catch (error) {
    console.error('markArrived failed', error);
    return { ok: false as const };
  }
}
