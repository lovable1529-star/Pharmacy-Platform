'use server';

/**
 * Stock operations: receiving a delivery, and recalling a batch.
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

import { eq, and, sql, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action, query } from '@/lib/actions';
import {
  batch, stockLevel, stockMovement, consultation, patient, branch,
  vaccineAdministration,
} from '@/lib/db/schema';
import { db } from '@/lib/db/client';
import { receiptProblem, type BatchReceipt } from '@/lib/inventory/receipts';

// ─────────────────────────────────────────────────────────────────────────
// Receiving stock
//
// Moved here from Settings. The validation lives in lib/inventory/receipts.ts
// so it can be tested without a database, and so the same answer is given
// wherever a receipt is entered.
// ─────────────────────────────────────────────────────────────────────────

export interface ReceiveBatchInput extends BatchReceipt {
  branchId: string;
  companyId: string;
}

const receive = action<ReceiveBatchInput>('inventory:edit')
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
        action: 'inventory.receipt',
        entityType: 'batch',
        entityId: created.id,
        after: {
          batchNumber: created.batchNumber,
          expiryDate: created.expiryDate,
          quantity: input.quantity,
          branchId: input.branchId,
        },
      },
    };
  });

export async function receiveBatch(input: ReceiveBatchInput) {
  const problem = receiptProblem(input);
  if (problem) return { ok: false as const, error: problem };

  try {
    const result = await receive(input);
    revalidatePath('/inventory');
    revalidatePath('/settings');
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('receiveBatch failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to change stock at this branch.'
          : 'Could not receive that batch.',
    };
  }
}

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

      /*
       * Who received this batch — from BOTH records that can hold one.
       *
       * This asked `consultation.batch_id` alone. Vaccinations recorded through
       * the administration path write their batch to `vaccine_administration`
       * and leave the consultation's own column null, so a recall of a batch
       * given that way reported ZERO patients affected while somebody had
       * actually received it. On the live database that is already true of the
       * only administered vaccination.
       *
       * Both are queried and the results merged on patient id. A patient who
       * appears in both — an older record that populated the consultation
       * column as well — is one person, not two, and the earliest known
       * administration time is kept.
       */
      const [fromConsultations, fromAdministrations] = await Promise.all([
        db
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
          ),
        db
          .select({
            patientId: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            phone: patient.phone,
            email: patient.email,
            // A `date` column, so Drizzle hands back `YYYY-MM-DD`. Joined
            // straight to the patient rather than through the submission,
            // which is nullable on this table.
            administeredOn: vaccineAdministration.administeredOn,
          })
          .from(vaccineAdministration)
          .innerJoin(patient, eq(vaccineAdministration.patientId, patient.id))
          .where(
            and(
              eq(vaccineAdministration.batchId, input.batchId),
              eq(vaccineAdministration.organisationId, actor.organisationId),
            ),
          ),
      ]);

      type Recipient = {
        patientId: string;
        firstName: string;
        lastName: string;
        phone: string | null;
        email: string | null;
        administeredAt: Date | null;
      };

      const merged: Recipient[] = [
        ...fromConsultations,
        ...fromAdministrations.map((r) => ({
          patientId: r.patientId,
          firstName: r.firstName,
          lastName: r.lastName,
          phone: r.phone,
          email: r.email,
          administeredAt: r.administeredOn ? new Date(`${r.administeredOn}T00:00:00Z`) : null,
        })),
      ];

      const byPatient = new Map<string, Recipient>();
      for (const row of merged) {
        const seen = byPatient.get(row.patientId);
        if (!seen) {
          byPatient.set(row.patientId, row);
          continue;
        }
        // Same person, two records of the same event. Keep the earliest time we
        // can evidence — a recall letter should say when they had it, and the
        // earlier of two timestamps is the safer claim.
        if (
          row.administeredAt
          && (!seen.administeredAt || row.administeredAt < seen.administeredAt)
        ) {
          byPatient.set(row.patientId, row);
        }
      }

      const recipients = [...byPatient.values()];

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
