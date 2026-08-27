'use server';

/**
 * Batch recall.
 *
 * The moment a batch is recalled, three questions matter and all of them are
 * about people rather than stock: who received it, how much is still on the
 * shelf and where, and — the one that gets forgotten — which of those patients
 * have no phone number or email, because those are the ones somebody has to
 * physically chase.
 *
 * Recalling does not delete anything. The batch stays, flagged, and the
 * consultation screen refuses to administer from it.
 */

import { eq, and, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action, query } from '@/lib/actions';
import { batch, stockLevel, stockMovement, consultation, patient, branch } from '@/lib/db/schema';
import { db } from '@/lib/db/client';

export interface RecallImpact {
  batchNumber: string;
  productName: string;
  patientsAffected: number;
  patientsWithoutContact: number;
  remainingByBranch: { branchName: string; quantity: number }[];
  totalRemaining: number;
  recipients: {
    patientId: string;
    name: string;
    phone: string | null;
    email: string | null;
    administeredAt: Date | null;
  }[];
}

/** Read-only, and scope-checked. Safe to call before deciding to recall. */
export async function getRecallImpact(batchId: string): Promise<RecallImpact | null> {
  const assess = query<{ batchId: string }>('inventory:view')
    .scopedTo(() => ({}))
    .handler(async (input, { actor }) => {
      const rows = await db
        .select({
          batchNumber: batch.batchNumber,
          productName: sql<string>`(select name from product where id = ${batch.productId})`,
        })
        .from(batch)
        .where(and(eq(batch.id, input.batchId), eq(batch.organisationId, actor.organisationId)))
        .limit(1);

      const info = rows[0];
      if (!info) return null;

      const recipients = await db
        .select({
          patientId: patient.id,
          firstName: patient.firstName,
          lastName: patient.lastName,
          phone: patient.phone,
          email: patient.email,
          administeredAt: consultation.completedAt,
        })
        .from(consultation)
        .innerJoin(patient, eq(consultation.patientId, patient.id))
        .where(
          and(
            eq(consultation.batchId, input.batchId),
            eq(consultation.organisationId, actor.organisationId),
          ),
        );

      const remaining = await db
        .select({ branchName: branch.name, quantity: stockLevel.quantity })
        .from(stockLevel)
        .innerJoin(branch, eq(stockLevel.branchId, branch.id))
        .where(eq(stockLevel.batchId, input.batchId));

      return {
        batchNumber: info.batchNumber,
        productName: info.productName,
        patientsAffected: recipients.length,
        patientsWithoutContact: recipients.filter((r) => !r.phone && !r.email).length,
        remainingByBranch: remaining.map((r) => ({
          branchName: r.branchName,
          quantity: r.quantity,
        })),
        totalRemaining: remaining.reduce((n, r) => n + r.quantity, 0),
        recipients: recipients.map((r) => ({
          patientId: r.patientId,
          name: `${r.firstName} ${r.lastName}`,
          phone: r.phone,
          email: r.email,
          administeredAt: r.administeredAt,
        })),
      } satisfies RecallImpact;
    });

  try {
    return await assess({ batchId });
  } catch (error) {
    console.error('getRecallImpact failed', error);
    return null;
  }
}

interface RecallInput {
  batchId: string;
  reason: string;
  branchId: string;
  companyId: string;
}

const recall = action<RecallInput>('inventory:disable')
  .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
  .handler(async (input, { tx, actor }) => {
    const now = new Date();

    const [updated] = await tx
      .update(batch)
      .set({ recalledAt: now, recallReason: input.reason.trim() })
      .where(and(eq(batch.id, input.batchId), eq(batch.organisationId, actor.organisationId)))
      .returning();

    if (!updated) throw new Error('That batch no longer exists.');

    // Quarantine the remaining stock as a movement, so the ledger explains why
    // the level dropped rather than the number simply changing.
    const levels = await tx
      .select({ branchId: stockLevel.branchId, quantity: stockLevel.quantity })
      .from(stockLevel)
      .where(eq(stockLevel.batchId, input.batchId));

    for (const level of levels) {
      if (level.quantity <= 0) continue;

      await tx.insert(stockMovement).values({
        organisationId: actor.organisationId,
        branchId: level.branchId,
        batchId: input.batchId,
        kind: 'WASTE',
        quantity: -level.quantity,
        reason: `Recalled: ${input.reason.trim()}`,
        occurredAt: now,
      });

      await tx
        .update(stockLevel)
        .set({ quantity: 0, updatedAt: now })
        .where(
          and(
            eq(stockLevel.batchId, input.batchId),
            eq(stockLevel.branchId, level.branchId),
          ),
        );
    }

    return {
      result: { quarantined: levels.reduce((n, l) => n + Math.max(0, l.quantity), 0) },
      audit: {
        action: 'batch.recalled',
        entityType: 'batch',
        entityId: input.batchId,
        after: { batchNumber: updated.batchNumber, reason: input.reason.trim() },
      },
    };
  });

export async function recallBatch(input: RecallInput) {
  if (!input.reason.trim()) {
    return { ok: false as const, error: 'A recall needs a reason — it goes in the audit log.' };
  }

  try {
    const result = await recall(input);
    revalidatePath('/inventory');
    revalidatePath('/');
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('recallBatch failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'Recalling a batch needs pharmacist or administrator access.'
          : 'Could not record that recall.',
    };
  }
}
