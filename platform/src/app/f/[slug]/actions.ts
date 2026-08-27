'use server';

/**
 * Public form submission.
 *
 * This is the one write path with no signed-in user, so it does not go through
 * the scoped action wrapper — there is no actor to scope. It is deliberately
 * narrow instead: it accepts a service slug and a set of answers, and it can do
 * nothing else. It cannot read a patient record, cannot update one, and cannot
 * touch any other organisation's data.
 *
 * It still writes an audit entry, with a null user and the branch the patient
 * chose, so a submission that arrives at 2am from a phone is as traceable as one
 * a pharmacist types in.
 */

import { eq, and, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  service, formVersion, rulesetVersion, submission, ruleEvaluation, auditEvent,
} from '@/lib/db/schema';
import { sealAuditEntry } from '@/lib/audit';
import { pruneHiddenAnswers, collectMetadata } from '@/lib/forms/runtime';
import { evaluateRuleset, type RulesetDefinition } from '@/lib/rules/engine';
import { deriveValues } from '@/lib/clinical/derived';
import type { FormSchema, Answers } from '@/types/form-schema';

export interface SubmitResult {
  ok: boolean;
  submissionId?: string;
  outcome?: 'GREEN' | 'AMBER' | 'RED';
  patientMessage?: string;
  error?: string;
}

/** Height and weight arrive as { si, unit, raw } from the measurement control. */
function siValue(answers: Answers, key: string): number | null {
  const value = answers[key];
  if (typeof value === 'object' && value !== null && 'si' in value) {
    const si = (value as { si: unknown }).si;
    return typeof si === 'number' ? si : null;
  }
  return typeof value === 'number' ? value : null;
}

export async function submitPublicForm(
  slug: string,
  rawAnswers: Answers,
): Promise<SubmitResult> {
  try {
    const [svc] = await db
      .select()
      .from(service)
      .where(and(eq(service.slug, slug)))
      .limit(1);

    if (!svc || !svc.publishedFormVersionId) {
      return { ok: false, error: 'This form is not currently available.' };
    }

    const [version] = await db
      .select()
      .from(formVersion)
      .where(eq(formVersion.id, svc.publishedFormVersionId))
      .limit(1);

    if (!version) return { ok: false, error: 'This form is not currently available.' };

    const schema = version.schema as unknown as FormSchema;

    // Never trust what the browser posted: prune against the schema again on the
    // server, so a hidden field cannot be smuggled in by editing the payload.
    const answers = pruneHiddenAnswers(schema, rawAnswers);
    const metadata = collectMetadata(schema, answers);

    const derived = deriveValues({
      answers,
      heightCm: siValue(answers, 'height'),
      weightKg: siValue(answers, 'weight'),
      dateOfBirth: typeof answers.dateOfBirth === 'string' ? answers.dateOfBirth : null,
    });

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(submission)
        .values({
          organisationId: svc.organisationId,
          serviceId: svc.id,
          formVersionId: version.id,
          branchId: null,
          status: 'SUBMITTED',
          answers: { ...answers, _metadata: metadata } as Record<string, unknown>,
          derived: derived as unknown as Record<string, unknown>,
          consentVersion: `v${version.version}`,
          submittedAt: new Date(),
        })
        .returning();

      if (!row) throw new Error('Could not save the submission.');

      // Triage, if this service has published rules.
      let outcome: 'GREEN' | 'AMBER' | 'RED' | undefined;
      let patientMessage: string | undefined;

      if (svc.publishedRulesetVersionId) {
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

          await tx.insert(ruleEvaluation).values({
            organisationId: svc.organisationId,
            submissionId: row.id,
            rulesetVersionId: rules.id,
            outcome: evaluation.outcome,
            decidingRuleId: evaluation.decidingRuleId,
            trace: evaluation.trace as unknown[],
            advice: evaluation.advice,
          });

          outcome = evaluation.outcome;
          patientMessage = evaluation.patientMessage;

          await tx
            .update(submission)
            .set({ status: outcome === 'GREEN' ? 'APPROVED' : 'IN_REVIEW' })
            .where(eq(submission.id, row.id));
        }
      }

      // Audit, with the same hash chain every other write uses.
      const previous = await tx
        .select({ hash: auditEvent.hash })
        .from(auditEvent)
        .where(eq(auditEvent.organisationId, svc.organisationId))
        .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
        .limit(1);

      const sealed = sealAuditEntry(
        {
          organisationId: svc.organisationId,
          userId: null,
          branchId: null,
          action: 'submission.created',
          entityType: 'submission',
          entityId: row.id,
          after: { serviceId: svc.id, formVersionId: version.id, outcome: outcome ?? null },
        },
        { id: crypto.randomUUID(), occurredAt: new Date(), previousHash: previous[0]?.hash ?? null },
      );

      await tx.insert(auditEvent).values({
        id: sealed.id,
        organisationId: sealed.organisationId,
        userId: null,
        branchId: null,
        action: sealed.action,
        entityType: sealed.entityType,
        entityId: sealed.entityId ?? null,
        after: sealed.after ?? null,
        previousHash: sealed.previousHash,
        hash: sealed.hash,
        occurredAt: sealed.occurredAt,
      });

      return { submissionId: row.id, outcome, patientMessage };
    });

    return { ok: true, ...result };
  } catch (error) {
    console.error('submitPublicForm failed', error);
    return {
      ok: false,
      error: 'We could not save your answers. Please try again, or call the pharmacy.',
    };
  }
}
