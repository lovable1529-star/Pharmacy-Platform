'use server';

/**
 * Public form submission.
 *
 * This is the one write path with no signed-in user, so it does not go through
 * the scoped action wrapper — there is no actor to scope. It is deliberately
 * narrow instead: it accepts a service slug, a set of answers, and optionally a
 * resume token, and it can do nothing else. It cannot read a patient record it
 * was not given, cannot reach another organisation's data, and cannot be talked
 * into returning anything clinical.
 *
 * It still writes an audit entry, with a null user and the branch the patient
 * chose, so a submission that arrives at 2am from a phone is as traceable as one
 * a pharmacist types in.
 */

import { eq, and, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  service, formVersion, rulesetVersion, submission, ruleEvaluation, auditEvent,
  statusHistory, urgentTask,
  appointment,
} from '@/lib/db/schema';
import { sealAuditEntry } from '@/lib/audit';
import { pruneHiddenAnswers, collectMetadata } from '@/lib/forms/runtime';
import { isExpired } from '@/lib/forms/draft';
import { matchOrCreatePatient, readIdentity } from '@/lib/patients/identify';
import { evaluateRuleset, type RulesetDefinition } from '@/lib/rules/engine';
import { alertPharmacist } from '@/lib/notifications/alerts';
import { deriveValues } from '@/lib/clinical/derived';
import { siValue } from '@/lib/forms/present';
import { loadPreviousSupply } from '@/lib/clinical/previous-supply';
import { loadDoseLadders } from '@/lib/clinical/ladders';
import { captureConsent } from '@/lib/workflow/consent';
import { changeSubmissionStatus, recordInitialStatus } from '@/lib/workflow/history';
import type { FormSchema, Answers } from '@/types/form-schema';

export interface SubmitResult {
  ok: boolean;
  submissionId?: string;
  outcome?: 'GREEN' | 'AMBER' | 'RED';
  patientMessage?: string;
  error?: string;
}


/**
 * Autosave.
 *
 * Called as the patient works through the questionnaire. It writes answers and
 * nothing else — no triage, no patient record, no audit entry. Autosave firing
 * every few seconds must not put thousands of rows in a tamper-evident clinical
 * log; the audited event is the SUBMISSION, which is the point at which the
 * patient asserts the answers are true.
 *
 * It also refuses to touch anything that is no longer a draft, so a stale tab
 * left open cannot overwrite answers a pharmacist has since acted on.
 */
export async function saveFormDraft(
  token: string,
  rawAnswers: Answers,
): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: 'Missing token.' };

  try {
    const [draft] = await db
      .select({
        id: submission.id,
        status: submission.status,
        expiresAt: submission.resumeExpiresAt,
      })
      .from(submission)
      .where(eq(submission.resumeToken, token))
      .limit(1);

    if (!draft) return { ok: false, error: 'Not found.' };
    if (draft.status !== 'DRAFT') return { ok: false, error: 'Already submitted.' };
    if (isExpired(draft.expiresAt)) return { ok: false, error: 'Expired.' };

    // Files are not JSON-serialisable and are handled separately.
    const answers = Object.fromEntries(
      Object.entries(rawAnswers).filter(([, v]) => !(v instanceof File)),
    ) as Answers;

    await db
      .update(submission)
      .set({ answers: answers as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(submission.id, draft.id));

    return { ok: true };
  } catch (error) {
    console.error('saveFormDraft failed', error);
    return { ok: false, error: 'Could not save.' };
  }
}

export async function submitPublicForm(
  slug: string,
  rawAnswers: Answers,
  token?: string | null,
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

    const result = await db.transaction(async (tx) => {
      // ── Find the draft, or start fresh ────────────────────
      //
      // A token means this questionnaire was created when the appointment was
      // booked, and we complete that row. Without one this is a walk-up at the
      // counter, which is still allowed.
      let existing: { id: string; branchId: string | null; patientId: string | null } | null = null;

      if (token) {
        const [draft] = await tx
          .select({
            id: submission.id,
            status: submission.status,
            branchId: submission.branchId,
            patientId: submission.patientId,
            expiresAt: submission.resumeExpiresAt,
          })
          .from(submission)
          .where(eq(submission.resumeToken, token))
          .limit(1);

        if (!draft) return { error: 'That link is no longer valid.' };
        if (isExpired(draft.expiresAt)) {
          return { error: 'That link has expired. Please call the pharmacy.' };
        }
        // Submitting twice must not create a second record for one appointment.
        if (draft.status !== 'DRAFT') {
          return { error: 'Those answers have already been sent to us.' };
        }

        existing = { id: draft.id, branchId: draft.branchId, patientId: draft.patientId };
      }

      /*
       * ── Identify the patient ──────────────────────────────
       *
       * The booking already established one, so start from that. Recomputing
       * from the answers alone used to NULL it out for any service whose form
       * does not ask for a name and a date of birth — the questionnaire arrived
       * unattached, and the consultation dead-ended at "no patient record yet"
       * with no way forward for the receptionist.
       *
       * A form that DOES carry identity still gets to match, because a patient
       * correcting their own name on the form is better information than the
       * name somebody typed when booking on their behalf.
       */
      const identity = readIdentity(answers);
      let patientId: string | null = existing?.patientId ?? null;

      if (identity) {
        const matched = await matchOrCreatePatient(tx, {
          organisationId: svc.organisationId,
          identity,
          registeredBranchId: existing?.branchId ?? null,
        });
        patientId = matched.id;
      }

      /*
       * Derive AFTER the patient is identified, not before.
       *
       * This used to run above the transaction, where no patient existed yet,
       * so the previous weight and previous strength were never supplied and
       * `weightLossPercent` and `doseStepChange` were always null. Four rules
       * read those two values and were therefore skipped on every submission —
       * both routes to GREEN among them, which is why nothing could ever be
       * auto-approved.
       */
      // Ladders come from the medicine master, so a strength added or corrected
      // there changes the dose-step rules without a deploy. Loaded first: the
      // previous supply is validated against them, and a strength the master no
      // longer lists must produce no step change rather than a wrong one.
      const ladders = await loadDoseLadders(tx, svc.organisationId);

      const previousSupply = await loadPreviousSupply(tx, {
        organisationId: svc.organisationId,
        patientId,
        serviceId: svc.id,
        ladders,
      });

      const derived = deriveValues({
        answers,
        heightCm: siValue(answers, 'height'),
        weightKg: siValue(answers, 'weight'),
        dateOfBirth: typeof answers.dateOfBirth === 'string' ? answers.dateOfBirth : null,
        previousMedicineValue: previousSupply.previousMedicineValue,
        previousWeightKg: previousSupply.previousWeightKg,
        ladders,
      });

      const payload = {
        answers: { ...answers, _metadata: metadata } as Record<string, unknown>,
        derived: derived as unknown as Record<string, unknown>,
        patientId,
        status: 'SUBMITTED' as const,
        consentVersion: `v${version.version}`,
        submittedAt: new Date(),
        updatedAt: new Date(),
        // The token dies with the submission. A confirmation email sitting in an
        // inbox must not stay a live key to a completed medical form.
        resumeToken: null,
        resumeExpiresAt: null,
      };

      let row: { id: string } | undefined;

      if (existing) {
        [row] = await tx
          .update(submission)
          .set(payload)
          .where(eq(submission.id, existing.id))
          .returning({ id: submission.id });
      } else {
        [row] = await tx
          .insert(submission)
          .values({
            organisationId: svc.organisationId,
            serviceId: svc.id,
            formVersionId: version.id,
            branchId: null,
            ...payload,
          })
          .returning({ id: submission.id });
      }

      if (!row) throw new Error('Could not save the submission.');

      /*
       * Record how it arrived before anything triages it.
       *
       * A resumed draft moves DRAFT -> SUBMITTED; a walk-up at the counter has
       * no earlier state, so its history opens here. The patient is a real
       * actor and is not an app_user, which is why the label carries who it was
       * and the id is null.
       */
      if (existing) {
        await tx.insert(statusHistory).values({
          organisationId: svc.organisationId,
          entityType: 'SUBMISSION',
          entityId: row.id,
          fromStatus: 'DRAFT',
          toStatus: 'SUBMITTED',
          changedByLabel: 'Patient',
          branchId: existing.branchId ?? null,
        });
      } else {
        await recordInitialStatus(tx, {
          organisationId: svc.organisationId,
          submissionId: row.id,
          status: 'SUBMITTED',
          by: { label: 'Patient' },
        });
      }

      await captureConsent(tx, {
        organisationId: svc.organisationId,
        submissionId: row.id,
        patientId,
        schema,
        answers,
        formVersion: version.version,
        capturedBy: 'Patient',
      });

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

          /*
           * §6.3 — a RED is not just a status, it is work for somebody today.
           *
           * The queue it lands in is separate from the review list precisely so
           * that "a pharmacist should look at this" and "ring this patient now"
           * cannot be confused, which is what happens when both sit in the same
           * list ordered by severity.
           */
          if (evaluation.outcome === 'RED') {
            await tx.insert(urgentTask).values({
              organisationId: svc.organisationId,
              submissionId: row.id,
              patientId,
              branchId: existing?.branchId ?? null,
              reason: evaluation.message
                ?? `Blocked by ${evaluation.decidingRuleId ?? 'a safety rule'}`,
            });
          }

          /*
           * The engine's verdict is a status change like any other, and it is
           * the system making it — so the history says so, rather than
           * attributing an automatic decision to whoever happens to look next.
           */
          await changeSubmissionStatus(tx, {
            organisationId: svc.organisationId,
            submissionId: row.id,
            to: outcome === 'GREEN' ? 'APPROVED' : 'IN_REVIEW',
            by: { label: 'Decision engine' },
            reason: evaluation.decidingRuleId
              ? `Rule: ${evaluation.decidingRuleId}`
              : 'No rule matched — default outcome',
          });
        }
      }

      // ── Link the appointment ──────────────────────────────
      //
      // This is the step whose absence made every appointment read "no form
      // yet" no matter how carefully the patient filled it in.
      if (existing) {
        await tx
          .update(appointment)
          .set({ patientId, updatedAt: new Date() })
          .where(eq(appointment.submissionId, existing.id));
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
          branchId: existing?.branchId ?? null,
          action: 'submission.created',
          entityType: 'submission',
          entityId: row.id,
          after: {
            serviceId: svc.id,
            formVersionId: version.id,
            outcome: outcome ?? null,
            patientId,
          },
        },
        { id: crypto.randomUUID(), occurredAt: new Date(), previousHash: previous[0]?.hash ?? null },
      );

      await tx.insert(auditEvent).values({
        id: sealed.id,
        organisationId: sealed.organisationId,
        userId: null,
        branchId: sealed.branchId ?? null,
        action: sealed.action,
        entityType: sealed.entityType,
        entityId: sealed.entityId ?? null,
        after: sealed.after ?? null,
        previousHash: sealed.previousHash,
        hash: sealed.hash,
        occurredAt: sealed.occurredAt,
      });

      return {
        submissionId: row.id,
        outcome,
        patientMessage,
        branchId: existing?.branchId ?? null,
        serviceName: svc.name,
        serviceKind: svc.kind,
        patientName: identity ? `${identity.firstName} ${identity.lastName}` : 'A patient',
      };
    });

    if ('error' in result && result.error) return { ok: false, error: result.error };

    // Tell the pharmacy. His weight-management SOW asks for this by name:
    // "Email + WhatsApp alert to pharmacist: New repeat request from [Patient
    // Name]". Best effort — a submission that saved must never be reported as
    // failed because an alert did not go out.
    if ('submissionId' in result && result.submissionId) {
      void alertPharmacist({
        organisationId: svc.organisationId,
        branchId: result.branchId ?? null,
        submissionId: result.submissionId,
        patientName: result.patientName,
        serviceName: result.serviceName,
        serviceKind: result.serviceKind,
        outcome: result.outcome ?? null,
        answers,
      }).catch((error) => console.error('alertPharmacist failed', error));
    }

    return { ok: true, ...result };
  } catch (error) {
    console.error('submitPublicForm failed', error);
    return {
      ok: false,
      error: 'We could not save your answers. Please try again, or call the pharmacy.',
    };
  }
}
