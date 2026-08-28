/**
 * Recording a status change.
 *
 * Deliberately the ONLY way a submission's status moves. Setting the column
 * directly is now a mistake rather than a shortcut, because a status written
 * without a history row is exactly the thing the specification forbids —
 * §16.4 lists status, pharmacist decisions and rejection reasons among the
 * values that must not be silently overwritten.
 *
 * The transition is validated before the write and both happen inside the
 * caller's transaction, so an illegal move leaves nothing behind and a
 * recorded history can never disagree with the column it describes.
 */

import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import { submission, statusHistory } from '@/lib/db/schema';
import {
  assertTransition, type SubmissionStatus,
} from './status';

export type StatusEntity = 'SUBMISSION' | 'APPOINTMENT' | 'CONSULTATION' | 'PRESCRIPTION';

export interface StatusChange {
  organisationId: string;
  submissionId: string;
  to: SubmissionStatus;
  /**
   * Who did it. The patient and the system are both real actors and neither is
   * an `app_user`, so the label is required and the id is not.
   */
  by: { userId?: string | null; label: string };
  /** Required for a rejection — §7.3. Enforced by the caller's own validation. */
  reason?: string | null;
  branchId?: string | null;
}

export interface StatusChangeResult {
  from: SubmissionStatus;
  to: SubmissionStatus;
  changed: boolean;
}

/**
 * Move a submission to a new status, recording how it got there.
 *
 * Returns the previous status so callers can put it in their audit entry
 * without reading the row twice.
 */
export async function changeSubmissionStatus(
  tx: Tx,
  change: StatusChange,
): Promise<StatusChangeResult> {
  const [current] = await tx
    .select({ status: submission.status, branchId: submission.branchId })
    .from(submission)
    .where(eq(submission.id, change.submissionId))
    .limit(1);

  if (!current) throw new Error('That request no longer exists.');

  const from = current.status as SubmissionStatus;
  assertTransition(from, change.to);

  await tx
    .update(submission)
    .set({ status: change.to, updatedAt: new Date() })
    .where(eq(submission.id, change.submissionId));

  await tx.insert(statusHistory).values({
    organisationId: change.organisationId,
    entityType: 'SUBMISSION',
    entityId: change.submissionId,
    fromStatus: from,
    toStatus: change.to,
    changedBy: change.by.userId ?? null,
    changedByLabel: change.by.label,
    reason: change.reason?.trim() || null,
    branchId: change.branchId ?? current.branchId ?? null,
  });

  return { from, to: change.to, changed: from !== change.to };
}

/**
 * The opening entry, written when a record first exists.
 *
 * Separate from the function above because there is no previous status to
 * validate against, and a machine that refuses unknown transitions would
 * otherwise have to special-case creation.
 */
export async function recordInitialStatus(
  tx: Tx,
  input: {
    organisationId: string;
    submissionId: string;
    status: SubmissionStatus;
    by: { userId?: string | null; label: string };
    branchId?: string | null;
  },
): Promise<void> {
  await tx.insert(statusHistory).values({
    organisationId: input.organisationId,
    entityType: 'SUBMISSION',
    entityId: input.submissionId,
    fromStatus: null,
    toStatus: input.status,
    changedBy: input.by.userId ?? null,
    changedByLabel: input.by.label,
    branchId: input.branchId ?? null,
  });
}

/** Everything that has happened to one record, oldest first. */
export async function readStatusHistory(
  tx: Tx,
  entityId: string,
  entityType: StatusEntity = 'SUBMISSION',
) {
  return tx
    .select({
      id: statusHistory.id,
      fromStatus: statusHistory.fromStatus,
      toStatus: statusHistory.toStatus,
      changedByLabel: statusHistory.changedByLabel,
      reason: statusHistory.reason,
      createdAt: statusHistory.createdAt,
    })
    .from(statusHistory)
    .where(
      and(
        eq(statusHistory.entityId, entityId),
        // Ids are uuids so a collision across types is not realistic, but the
        // index is on (type, id) and matching it keeps the read on the index.
        eq(statusHistory.entityType, entityType),
      ),
    )
    .orderBy(statusHistory.createdAt);
}
