'use server';

/**
 * Reference data maintenance.
 *
 * He asked this directly about vaccines: "Presume there's a way for me to add
 * these on when needed?" Yes — and it is deliberately reference data he owns
 * rather than a code change, because the alternative is ringing a developer
 * every time a new batch arrives.
 */

import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { batch, stockLevel, stockMovement, product, gpSurgery } from '@/lib/db/schema';

interface AddBatchInput {
  productId: string;
  batchNumber: string;
  expiryDate: string;
  branchId: string;
  companyId: string;
  quantity: number;
}

const addBatchAction = action<AddBatchInput>('inventory:edit')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
  .handler(async (input, { tx, actor }) => {
    const [created] = await tx
      .insert(batch)
      .values({
        organisationId: actor.organisationId,
        productId: input.productId,
        batchNumber: input.batchNumber.trim(),
        expiryDate: input.expiryDate,
      })
      .returning();

    if (!created) throw new Error('Could not create the batch.');

    await tx.insert(stockLevel).values({
      organisationId: actor.organisationId,
      branchId: input.branchId,
      batchId: created.id,
      quantity: input.quantity,
    });

    // Opening stock is a movement like any other, so the cached level always
    // reconciles against the ledger.
    await tx.insert(stockMovement).values({
      organisationId: actor.organisationId,
      branchId: input.branchId,
      batchId: created.id,
      kind: 'RECEIPT',
      quantity: input.quantity,
      reason: 'Batch received',
    });

    return {
      result: { batchId: created.id },
      audit: {
        action: 'batch.received',
        entityType: 'batch',
        entityId: created.id,
        after: {
          batchNumber: created.batchNumber,
          expiryDate: created.expiryDate,
          quantity: input.quantity,
        },
      },
    };
  });

export async function addBatch(input: AddBatchInput) {
  if (!input.batchNumber.trim()) {
    return { ok: false as const, error: 'A batch number is needed.' };
  }
  if (!input.expiryDate) {
    return { ok: false as const, error: 'An expiry date is needed.' };
  }
  if (new Date(input.expiryDate) <= new Date()) {
    return { ok: false as const, error: 'That expiry date has already passed.' };
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    return { ok: false as const, error: 'Quantity must be a whole number.' };
  }

  try {
    const result = await addBatchAction(input);
    revalidatePath('/settings');
    revalidatePath('/inventory');
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('addBatch failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to change stock at this branch.'
          : 'Could not add that batch.',
    };
  }
}

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
