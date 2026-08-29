'use server';

/**
 * Recording a stock movement — §9.2.
 *
 * `stock_level` is a cached projection of `stock_movement`; the movements are
 * the truth. So this always writes a movement and then recalculates the level
 * from it, rather than adjusting the level directly. Editing the cache without
 * the event behind it is how a stock count becomes unexplainable — the number
 * is wrong and nothing says when it went wrong or who did it.
 *
 * The direction of each kind lives in `lib/inventory/movements`, so a caller
 * cannot decide that a damaged vial adds to the shelf.
 */

import { and, eq, sql } from 'drizzle-orm';
import { action } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { batch, product, stockLevel, stockMovement } from '@/lib/db/schema';
import {
  checkMovement, isMovementKind, movementDelta, MOVEMENT_LABELS,
  type MovementKind,
} from '@/lib/inventory/movements';

export interface MovementInput {
  batchId: string;
  branchId: string;
  companyId?: string | null;
  kind: MovementKind;
  quantity: number;
  reason: string | null;
  reference: string | null;
}

const record = action<MovementInput>('inventory:edit')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId ?? null }))
  .handler(async (input, { tx, actor }) => {
    if (!isMovementKind(input.kind)) {
      throw new Error('That is not a movement type we recognise.');
    }

    const [chosen] = await tx
      .select({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        productName: product.name,
        recalledAt: batch.recalledAt,
      })
      .from(batch)
      .innerJoin(product, eq(batch.productId, product.id))
      .where(
        and(eq(batch.id, input.batchId), eq(batch.organisationId, actor.organisationId)),
      )
      .limit(1);

    if (!chosen) throw new Error('That batch no longer exists.');

    /*
     * A recalled batch can still move OUT — it has to, or recalled stock could
     * never be written off or returned to the supplier. What it must not do is
     * come back in as usable stock.
     */
    const delta = movementDelta(input.kind, input.quantity);
    if (chosen.recalledAt && delta > 0) {
      throw new Error('That batch has been recalled. Stock cannot be added back to it.');
    }

    // Lock the level row before reading it, so two people counting the same
    // shelf at once cannot both write from the same starting number.
    const [level] = await tx
      .select({ id: stockLevel.id, quantity: stockLevel.quantity })
      .from(stockLevel)
      .where(
        and(eq(stockLevel.batchId, input.batchId), eq(stockLevel.branchId, input.branchId)),
      )
      .for('update')
      .limit(1);

    const current = level?.quantity ?? 0;
    const check = checkMovement(input.kind, input.quantity, current);
    if (!check.ok) throw new Error(check.error ?? 'That movement is not possible.');

    await tx.insert(stockMovement).values({
      organisationId: actor.organisationId,
      branchId: input.branchId,
      batchId: input.batchId,
      kind: input.kind,
      quantity: Math.trunc(input.kind === 'ADJUSTMENT' ? input.quantity : Math.abs(input.quantity)),
      reason: input.reason?.trim() || null,
      userId: actor.userId,
      reference: input.reference?.trim() || null,
    });

    if (level) {
      await tx
        .update(stockLevel)
        .set({ quantity: check.resulting, updatedAt: new Date() })
        .where(eq(stockLevel.id, level.id));
    } else {
      await tx.insert(stockLevel).values({
        organisationId: actor.organisationId,
        branchId: input.branchId,
        batchId: input.batchId,
        quantity: check.resulting,
      });
    }

    return {
      result: { quantity: check.resulting },
      audit: {
        action: `stock.${input.kind.toLowerCase()}`,
        entityType: 'batch',
        entityId: input.batchId,
        before: { quantity: current },
        after: {
          quantity: check.resulting,
          kind: MOVEMENT_LABELS[input.kind],
          product: chosen.productName,
          batch: chosen.batchNumber,
          reason: input.reason?.trim() || null,
        },
      },
    };
  });

export async function recordMovement(input: MovementInput) {
  try {
    const result = await record(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('recordMovement failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to change stock.'
          : error instanceof Error
            ? error.message
            : 'Could not record that movement.',
    };
  }
}

/** The batch's own history — §9.2 wants transactions kept, not totals rewritten. */
export async function getBatchHistory(batchId: string, branchId: string) {
  const { db } = await import('@/lib/db/client');
  return db
    .select({
      id: stockMovement.id,
      kind: stockMovement.kind,
      quantity: stockMovement.quantity,
      reason: stockMovement.reason,
      reference: stockMovement.reference,
      occurredAt: stockMovement.occurredAt,
    })
    .from(stockMovement)
    .where(
      and(eq(stockMovement.batchId, batchId), eq(stockMovement.branchId, branchId)),
    )
    .orderBy(sql`${stockMovement.occurredAt} desc`)
    .limit(50);
}
