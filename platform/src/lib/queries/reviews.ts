/**
 * Review queue data access.
 *
 * Reads only — every function here is scope-checked by its caller. Kept apart
 * from the React components so the shape of a query is reviewable on its own,
 * and so the columns we pull are explicit rather than `select *` over a table
 * holding special-category health data.
 */

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  submission, ruleEvaluation, service, patient, reviewEvent, appUser, branch,
  urgentTask, repeatEnrolment, formVersion,
} from '@/lib/db/schema';
import type { RuleTraceEntry, Outcome } from '@/lib/rules/engine';

export interface QueueItem {
  submissionId: string;
  reference: string;
  patientName: string | null;
  patientId: string | null;
  dateOfBirth: string | null;
  serviceName: string;
  serviceSlug: string;
  status: string;
  outcome: Outcome | null;
  decidingRuleId: string | null;
  advice: string[];
  submittedAt: Date | null;
  branchName: string | null;
  answers: Record<string, unknown>;
  derived: Record<string, unknown>;
  trace: RuleTraceEntry[];
  /**
   * What the pharmacy's own record says they are currently on.
   *
   * Read from the enrolment rather than from the questionnaire on purpose: the
   * previous scope of work is explicit that patients must not be able to
   * circumvent the clinical checks, and a self-reported current strength is
   * exactly the field somebody would adjust to make a two-step jump look like
   * one.
   */
  previousMedicine: string | null;
  previousStrength: string | null;
  /** Which questionnaire version this was answered against. */
  formVersionId: string;
}

/**
 * A ceiling, not a page size.
 *
 * With worst-first ordering applied in the database this is now safe: anything
 * cut off is genuinely lower priority than everything kept. Raised from 100
 * because a busy week of AMBERs should not push a RED off the end.
 */
const REVIEW_QUEUE_LIMIT = 500;

/**
 * Everything awaiting a decision, worst first.
 *
 * Sorting happens in application code rather than SQL because the ordering is a
 * clinical judgement — reds before ambers, then oldest first within each band so
 * nothing quietly ages at the bottom of the list.
 */
export async function getReviewQueue(organisationId: string): Promise<QueueItem[]> {
  const rows = await db
    .select({
      submissionId: submission.id,
      status: submission.status,
      answers: submission.answers,
      derived: submission.derived,
      submittedAt: submission.submittedAt,
      serviceName: service.name,
      serviceSlug: service.slug,
      patientId: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      branchName: branch.name,
      outcome: ruleEvaluation.outcome,
      decidingRuleId: ruleEvaluation.decidingRuleId,
      trace: ruleEvaluation.trace,
      advice: ruleEvaluation.advice,
      previousMedicine: repeatEnrolment.medicine,
      previousStrength: repeatEnrolment.strength,
      formVersionId: submission.formVersionId,
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .leftJoin(patient, eq(submission.patientId, patient.id))
    .leftJoin(branch, eq(submission.branchId, branch.id))
    .leftJoin(ruleEvaluation, eq(ruleEvaluation.submissionId, submission.id))
    /*
     * Safe as a join rather than a subquery: `repeat_enrolment` carries a
     * unique index on (patient_id, service_id), so this cannot multiply rows
     * the way an appointment join would.
     */
    .leftJoin(
      repeatEnrolment,
      and(
        eq(repeatEnrolment.patientId, submission.patientId),
        eq(repeatEnrolment.serviceId, submission.serviceId),
      ),
    )
    .where(
      and(
        eq(submission.organisationId, organisationId),
        inArray(submission.status, ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED']),
      ),
    )
    /*
     * Worst first, decided by the DATABASE — before the limit, not after.
     *
     * This used to order by date, cut to 100, then sort by severity in
     * JavaScript. A RED sitting 101st by date was therefore dropped before the
     * worst-first sort ever saw it: the queue said "worst first" and quietly
     * omitted the worst. For a clinical review list that is a correctness bug,
     * not a performance one.
     *
     * Within a severity band, oldest first — the one that has been waiting
     * longest is the one to look at.
     */
    .orderBy(
      sql`case
            when ${ruleEvaluation.outcome} = 'RED' then 0
            when ${ruleEvaluation.outcome} = 'AMBER' then 1
            else 2
          end`,
      asc(submission.submittedAt),
    )
    .limit(REVIEW_QUEUE_LIMIT);

  return rows
    .map((r) => ({
      submissionId: r.submissionId,
      reference: r.submissionId.slice(0, 8).toUpperCase(),
      patientName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
      patientId: r.patientId,
      dateOfBirth: r.dateOfBirth,
      serviceName: r.serviceName,
      serviceSlug: r.serviceSlug,
      status: r.status,
      outcome: (r.outcome as Outcome | null) ?? null,
      decidingRuleId: r.decidingRuleId,
      advice: (r.advice as string[] | null) ?? [],
      submittedAt: r.submittedAt,
      branchName: r.branchName,
      answers: (r.answers as Record<string, unknown>) ?? {},
      derived: (r.derived as Record<string, unknown>) ?? {},
      trace: (r.trace as RuleTraceEntry[] | null) ?? [],
      previousMedicine: r.previousMedicine,
      previousStrength: r.previousStrength,
      formVersionId: r.formVersionId,
    }));

  // No client-side re-sort: the database already returned them worst-first, and
  // re-sorting a truncated page was exactly what made the old cap unsafe.
}

/**
 * How many are waiting — as a number, from the database.
 *
 * The staff layout renders a badge on "Repeat care" on EVERY page, and it used
 * to get that number by calling `getReviewQueue()` and reading `.length`. That
 * query pulls up to 500 rows across five joins and carries `answers`, `derived`
 * and `trace` — the three largest JSONB columns in the schema, holding the full
 * questionnaire and the whole rules trace for every waiting submission.
 *
 * So opening Patients paid for the complete clinical payload of the review
 * queue, decoded it into objects, and threw all of it away to keep one integer.
 * On a page that never shows any of it.
 *
 * Same predicate, no joins, no JSONB, counted in the database. It is also more
 * honest than what it replaces: `.length` was capped by the query's 500 limit,
 * so a genuinely long queue would have displayed "500" and stopped.
 */
export async function getReviewQueueCount(organisationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submission)
    .where(
      and(
        eq(submission.organisationId, organisationId),
        inArray(submission.status, ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED']),
      ),
    );

  return row?.count ?? 0;
}

/**
 * The questionnaires behind a queue, one per VERSION rather than one per row.
 *
 * The drawer has to label an answer, and labels live in the schema. Carrying
 * the schema on every queue item would have added the largest JSONB column in
 * the table to as many as 500 rows to render at most a handful of distinct
 * forms — the same mistake `getReviewQueueCount` exists to undo.
 *
 * Keyed by form version, not by service, because a published form is immutable
 * and two requests days apart may have been answered against different
 * wordings. Labelling last week's answers with this week's questions would
 * misreport what the patient was actually asked.
 */
export async function getQueueSchemas(
  organisationId: string,
  formVersionIds: string[],
): Promise<Record<string, unknown>> {
  const unique = [...new Set(formVersionIds)];
  if (unique.length === 0) return {};

  const rows = await db
    .select({ id: formVersion.id, schema: formVersion.schema })
    .from(formVersion)
    .where(
      and(
        eq(formVersion.organisationId, organisationId),
        inArray(formVersion.id, unique),
      ),
    );

  return Object.fromEntries(rows.map((r) => [r.id, r.schema]));
}

export interface ReviewHistoryEntry {
  id: string;
  action: string;
  note: string | null;
  userName: string | null;
  occurredAt: Date;
}

/** Discrete, attributable events — never one accumulating text blob. */
export async function getReviewHistory(submissionId: string): Promise<ReviewHistoryEntry[]> {
  const rows = await db
    .select({
      id: reviewEvent.id,
      action: reviewEvent.action,
      note: reviewEvent.note,
      userName: appUser.fullName,
      occurredAt: reviewEvent.occurredAt,
    })
    .from(reviewEvent)
    .leftJoin(appUser, eq(reviewEvent.userId, appUser.id))
    .where(eq(reviewEvent.submissionId, submissionId))
    .orderBy(desc(reviewEvent.occurredAt));

  return rows;
}

/**
 * The urgent queue — §6.3.
 *
 * Deliberately a different list from the review queue. "A pharmacist should
 * look at this today" and "ring this patient now" are different jobs, and
 * ordering one list by severity merges them: the urgent item sits at the top
 * of a long queue and looks like the worst of a set rather than the only thing
 * that cannot wait.
 */
export interface UrgentItem {
  id: string;
  submissionId: string | null;
  patientId: string | null;
  patientName: string | null;
  reason: string;
  createdAt: Date;
}

export async function getUrgentTasks(organisationId: string): Promise<UrgentItem[]> {
  const rows = await db
    .select({
      id: urgentTask.id,
      submissionId: urgentTask.submissionId,
      patientId: urgentTask.patientId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      reason: urgentTask.reason,
      createdAt: urgentTask.createdAt,
    })
    .from(urgentTask)
    .leftJoin(patient, eq(urgentTask.patientId, patient.id))
    .where(
      and(
        eq(urgentTask.organisationId, organisationId),
        isNull(urgentTask.resolvedAt),
      ),
    )
    .orderBy(asc(urgentTask.createdAt));

  return rows.map((r) => ({
    id: r.id,
    submissionId: r.submissionId,
    patientId: r.patientId,
    patientName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
}
