'use server';

/**
 * Reference data maintenance.
 *
 * He asked this directly about vaccines: "Presume there's a way for me to add
 * these on when needed?" Yes — and it is deliberately reference data he owns
 * rather than a code change.
 *
 * Products and GP surgeries only. RECEIVING a batch used to live here too, and
 * that was the wrong home: adding a product to the catalogue is something an
 * administrator does once, while taking in a delivery is something a
 * pharmacist does on an ordinary morning. It now sits in Inventory, next to
 * the stock it changes.
 */

import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { product, gpSurgery } from '@/lib/db/schema';


interface AddSurgeryInput {
  name: string;
  email: string;
}

const addSurgeryAction = action<AddSurgeryInput>('settings:edit').handler(
  async (input, { tx, actor }) => {
    const [created] = await tx
      .insert(gpSurgery)
      .values({
        organisationId: actor.organisationId,
        name: input.name.trim(),
        email: input.email.trim(),
      })
      .returning();

    if (!created) throw new Error('Could not add the surgery.');

    return {
      result: { id: created.id },
      audit: {
        action: 'gp_surgery.created',
        entityType: 'gp_surgery',
        entityId: created.id,
        after: { name: created.name, email: created.email },
      },
    };
  },
);

export async function addSurgery(input: AddSurgeryInput) {
  if (!input.name.trim()) return { ok: false as const, error: 'A practice name is needed.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return { ok: false as const, error: 'That does not look like an email address.' };
  }

  try {
    const result = await addSurgeryAction(input);
    revalidatePath('/settings');
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('addSurgery failed', error);
    return { ok: false as const, error: 'Could not add that surgery.' };
  }
}

export async function listProducts(organisationId: string) {
  const { db } = await import('@/lib/db/client');
  return db
    .select({ id: product.id, name: product.name })
    .from(product)
    .where(and(eq(product.organisationId, organisationId)));
}
