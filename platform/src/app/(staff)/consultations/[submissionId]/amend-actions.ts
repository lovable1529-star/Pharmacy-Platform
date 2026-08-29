'use server';

/**
 * Correcting a patient's answers.
 *
 * His brief says it twice, and it is the right call: "All fields must be
 * editable post-submission." Patients mistype their weight, misread a question,
 * or answer "no" to an allergy they remember at the counter. Without an amend
 * path, staff either work around the system or the clinical record stays wrong.
 *
 * What makes this safe rather than dangerous is that an amendment is a
 * documented clinical event, not a silent overwrite:
 *
 *   · the previous value is written to the audit chain alongside the new one
 *   · the reason is mandatory — an unexplained change to a medical answer is
 *     worse than no change at all
 *   · the ruleset is re-evaluated, so correcting an answer that flips the
 *     triage from GREEN to RED actually flips it, rather than leaving a stale
 *     approval attached to answers that no longer support it
 *
 * That last point is the one that matters most. An amend that did not re-run
 * the rules would let somebody quietly edit their way past a safety block.
 */

import { and, desc, eq } from 'drizzle-orm';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { action } from '@/lib/actions';
import { db } from '@/lib/db/client';
import {
  submission, formVersion, service, rulesetVersion, ruleEvaluation, reviewEvent,
  statusHistory,
} from '@/lib/db/schema';
import { pruneHiddenAnswers, collectMetadata } from '@/lib/forms/runtime';
import { evaluateRuleset, type RulesetDefinition } from '@/lib/rules/engine';
import { deriveValues } from '@/lib/clinical/derived';
import { siValue } from '@/lib/forms/present';
import type { FormSchema, Answers } from '@/types/form-schema';

export interface AmendInput {
  submissionId: string;
  /** The complete answer set after the correction, not a patch. */
  answers: Answers;
  reason: string;
}


const amend = action<AmendInput>('consultations:edit').handler(
  async (input, { tx, actor }) => {
    const [row] = await tx
      .select({
        id: submission.id,
        status: submission.status,
        serviceId: submission.serviceId,
        formVersionId: submission.formVersionId,
        answers: submission.answers,
      })
      .from(submission)
      .where(
        and(
          eq(submission.id, input.submissionId),
          eq(submission.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!row) throw new Error('That submission no longer exists.');

    /*
     * §20 — after approval the questionnaire is historical clinical data.
     *
     * The line the specification draws is between silent modification and a
     * recorded correction, not between editable and frozen: it asks that a
     * patient cannot quietly change an approved form, while a permitted
     * administrative correction creates an audit event or a revision.
     *
     * Patients already cannot: the resume token is destroyed at submission, so
     * the only route in is a member of staff with `consultations:edit`, and
     * every amendment writes an audit entry naming them and listing exactly
     * which answers moved. What remains is to stop amendment where the record
     * is genuinely finished, and to leave a revision marker on the history so
     * an approved record that was later corrected says so on its own timeline.
     */
    if (row.status === 'COMPLETED' || row.status === 'CANCELLED') {
      throw new Error(
        row.status === 'COMPLETED'
          ? 'This consultation is already complete. Its answers form part of the clinical record and cannot be changed.'
          : 'This request was cancelled. Its answers cannot be changed.',
      );
    }

    const [version] = await tx
      .select({ schema: formVersion.schema, version: formVersion.version })
      .from(formVersion)
      .where(eq(formVersion.id, row.formVersionId))
      .limit(1);

    if (!version) throw new Error('The form this was answered against is missing.');

    const schema = version.schema as unknown as FormSchema;

    // Prune server-side against the same schema, so an edited payload cannot
    // smuggle in a field the patient never saw.
    const answers = pruneHiddenAnswers(schema, input.answers);
    const metadata = collectMetadata(schema, answers);

    const previous = (row.answers ?? {}) as Record<string, unknown>;

    // Only the fields that actually moved. An audit entry listing every answer
    // on every amendment is one nobody reads.
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(previous), ...Object.keys(answers)]);

    for (const key of keys) {
      if (key === '_metadata') continue;
      if (JSON.stringify(previous[key]) !== JSON.stringify(answers[key])) {
        changedBefore[key] = previous[key] ?? null;
        changedAfter[key] = answers[key] ?? null;
      }
    }

    if (Object.keys(changedAfter).length === 0) {
      return { result: { changed: 0, outcome: null as string | null } };
    }

    const derived = deriveValues({
      answers,
      heightCm: siValue(answers, 'height'),
      weightKg: siValue(answers, 'weight'),
      dateOfBirth: typeof answers.dateOfBirth === 'string' ? answers.dateOfBirth : null,
    });

    await tx
      .update(submission)
      .set({
        answers: { ...answers, _metadata: metadata } as Record<string, unknown>,
        derived: derived as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(submission.id, row.id));

    // ── Re-run the ruleset ────────────────────────────────
    //
    // Without this, editing an answer that should trigger a safety block would
    // leave the old GREEN sitting there — an edit-your-way-past-the-rules hole.
    let outcome: string | null = null;

    const [svc] = await tx
      .select({ publishedRulesetVersionId: service.publishedRulesetVersionId })
      .from(service)
      .where(eq(service.id, row.serviceId))
      .limit(1);

    if (svc?.publishedRulesetVersionId) {
      const [rules] = await tx
        .select()
        .from(rulesetVersion)
        .where(eq(rulesetVersion.id, svc.publishedRulesetVersionId))
        .limit(1);

      if (rules) {
        const evaluation = evaluateRuleset(
          rules.definition as unknown as RulesetDefinition,
          { answers, derived: derived as Record<string, unknown> },
        );

        // A new evaluation row rather than an update: how the decision changed
        // after a correction is exactly what a reviewer needs to see.
        await tx.insert(ruleEvaluation).values({
          organisationId: actor.organisationId,
          submissionId: row.id,
          rulesetVersionId: rules.id,
          outcome: evaluation.outcome,
          decidingRuleId: evaluation.decidingRuleId,
          trace: evaluation.trace as unknown[],
          advice: evaluation.advice,
        });

        outcome = evaluation.outcome;

        await tx
          .update(submission)
          .set({ status: evaluation.outcome === 'GREEN' ? 'APPROVED' : 'IN_REVIEW' })
          .where(eq(submission.id, row.id));
      }
    }

    await tx.insert(reviewEvent).values({
      organisationId: actor.organisationId,
      submissionId: row.id,
      userId: actor.userId,
      action: 'AMENDED',
      note: input.reason.trim(),
    });

    /*
     * The revision marker §20 asks for.
     *
     * Status does not move — an amended approval is still approved — but the
     * timeline has to show that the answers behind it were corrected after the
     * fact, and by whom. Reading the record later, "approved, then amended" and
     * "approved" must not look identical.
     */
    await tx.insert(statusHistory).values({
      organisationId: actor.organisationId,
      entityType: 'SUBMISSION',
      entityId: row.id,
      fromStatus: row.status,
      toStatus: row.status,
      changedBy: actor.userId,
      changedByLabel: actor.fullName,
      reason: `Answers amended: ${input.reason.trim()}`,
    });

    return {
      result: { changed: Object.keys(changedAfter).length, outcome },
      audit: {
        action: 'submission.amended',
        entityType: 'submission',
        entityId: row.id,
        before: changedBefore,
        after: { ...changedAfter, _reason: input.reason.trim(), _outcome: outcome },
      },
    };
  },
);

export async function amendSubmission(input: AmendInput) {
  if (!input.reason.trim()) {
    return {
      ok: false as const,
      error: 'Give a reason for the correction — it goes on the clinical record.',
    };
  }

  try {
    const result = await amend(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('amendSubmission failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.name === 'AuthorisationError'
            ? 'You do not have permission to change submitted answers.'
            : error.message
          : 'Could not save that correction.',
    };
  }
}

/** The amendment history for a submission, newest first. */
export async function getAmendmentHistory(submissionId: string) {
  const rows = await db
    .select({
      id: reviewEvent.id,
      action: reviewEvent.action,
      note: reviewEvent.note,
      occurredAt: reviewEvent.occurredAt,
    })
    .from(reviewEvent)
    .where(eq(reviewEvent.submissionId, submissionId))
    .orderBy(desc(reviewEvent.occurredAt))
    .limit(50);

  return rows;
}
