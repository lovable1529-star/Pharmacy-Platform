'use server';

/**
 * Correcting a consultation that is already complete.
 *
 * The record itself is immutable, and that is not stubbornness: the answers and
 * the batch behind an administered vaccine are the justification for having
 * administered it, and editing them afterwards rewrites why a clinical decision
 * was made.
 *
 * But "we recorded the wrong batch and noticed an hour later" is a real event.
 * A recall list built from a wrong batch number is actively dangerous, and his
 * brief says twice that records must stay correctable.
 *
 * So a correction is APPENDED. The original stands, the correction stands
 * beside it, and both appear on the record and in the audit chain — which is
 * exactly how amendment works on paper, and the only version a regulator will
 * accept.
 *
 * One consequence worth stating: an addendum that changes the batch does NOT
 * move the stock movement. The dose left the fridge either way, so quietly
 * re-pointing it would put inventory out of step with what physically happened.
 * A stock correction is its own adjustment, made deliberately.
 */

import { and, desc, eq } from 'drizzle-orm';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { action } from '@/lib/actions';
import { db } from '@/lib/db/client';
import { consultation, consultationAddendum, appUser } from '@/lib/db/schema';

export interface AddendumInput {
  consultationId: string;
  reason: string;
  /** Field-level corrections, where the correction maps to something known. */
  corrections: Record<string, string>;
}

const append = action<AddendumInput>('consultations:edit').handler(
  async (input, { tx, actor }) => {
    const [target] = await tx
      .select({ id: consultation.id, status: consultation.status })
      .from(consultation)
      .where(
        and(
          eq(consultation.id, input.consultationId),
          eq(consultation.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!target) throw new Error('That consultation no longer exists.');

    // noUncheckedIndexedAccess makes the tuple element optional, so this is
    // built explicitly rather than through a map/filter chain.
    const corrections: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.corrections)) {
      const trimmed = (value ?? '').trim();
      if (trimmed) corrections[key] = trimmed;
    }

    const [created] = await tx
      .insert(consultationAddendum)
      .values({
        organisationId: actor.organisationId,
        consultationId: target.id,
        userId: actor.userId,
        reason: input.reason.trim(),
        corrections,
      })
      .returning({ id: consultationAddendum.id });

    if (!created) throw new Error('Could not save that correction.');

    return {
      result: { id: created.id },
      audit: {
        action: 'consultation.amended',
        entityType: 'consultation',
        entityId: target.id,
        after: { reason: input.reason.trim(), corrections },
      },
    };
  },
);

export async function addAddendum(input: AddendumInput) {
  if (!input.reason.trim()) {
    return {
      ok: false as const,
      error: 'Say what was wrong and what it should have said — it goes on the record.',
    };
  }

  try {
    await append(input);
    revalidateStaffViews();
    return { ok: true as const };
  } catch (error) {
    console.error('addAddendum failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.name === 'AuthorisationError'
            ? 'You do not have permission to amend consultations.'
            : error.message
          : 'Could not save that correction.',
    };
  }
}

export async function getAddenda(consultationId: string) {
  return db
    .select({
      id: consultationAddendum.id,
      reason: consultationAddendum.reason,
      corrections: consultationAddendum.corrections,
      occurredAt: consultationAddendum.occurredAt,
      authorName: appUser.fullName,
    })
    .from(consultationAddendum)
    .leftJoin(appUser, eq(consultationAddendum.userId, appUser.id))
    .where(eq(consultationAddendum.consultationId, consultationId))
    .orderBy(desc(consultationAddendum.occurredAt));
}
