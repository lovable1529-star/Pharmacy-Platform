/**
 * Review queue data access.
 *
 * Reads only — every function here is scope-checked by its caller. Kept apart
 * from the React components so the shape of a query is reviewable on its own,
 * and so the columns we pull are explicit rather than `select *` over a table
 * holding special-category health data.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  submission, ruleEvaluation, service, patient, reviewEvent, appUser, branch,
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
}

const SEVERITY: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2 };

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
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .leftJoin(patient, eq(submission.patientId, patient.id))
    .leftJoin(branch, eq(submission.branchId, branch.id))
    .leftJoin(ruleEvaluation, eq(ruleEvaluation.submissionId, submission.id))
    .where(
      and(
        eq(submission.organisationId, organisationId),
        inArray(submission.status, ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED']),
      ),
    )
    .orderBy(desc(submission.submittedAt))
    .limit(100);

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
    }))
    .sort((a, b) => {
      const severity = (SEVERITY[a.outcome ?? 'AMBER'] ?? 1) - (SEVERITY[b.outcome ?? 'AMBER'] ?? 1);
      if (severity !== 0) return severity;
      return (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0);
    });
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
