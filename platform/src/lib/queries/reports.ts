/**
 * Reporting — §21.
 *
 * Every figure here is aggregated BY THE DATABASE. That is the point of the
 * file. The existing report screen fetches up to a thousand consultations and
 * counts them in JavaScript, so a busy quarter reports on the first thousand
 * and presents the number as complete — a silently wrong total is worse than a
 * missing one, because nobody goes looking for it.
 *
 * These are also the numbers the client said he needs them for: internal
 * audits, NHS claims and performance tracking. All three are the kind where
 * being quietly short by a few hundred matters.
 */

import { and, asc, count, desc, eq, gte, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  consultation, submission, service, patient, branch, clinician, product, batch,
  prescription, stockMovement, reviewEvent, vaccineAdministration, payment,
} from '@/lib/db/schema';

export interface ReportRange {
  organisationId: string;
  from: Date;
  to: Date;
  branchId?: string | null;
}

function scope(range: ReportRange) {
  return range.branchId
    ? and(
      eq(consultation.organisationId, range.organisationId),
      eq(consultation.branchId, range.branchId),
      gte(consultation.createdAt, range.from),
      lte(consultation.createdAt, range.to),
    )
    : and(
      eq(consultation.organisationId, range.organisationId),
      gte(consultation.createdAt, range.from),
      lte(consultation.createdAt, range.to),
    );
}

export interface Counted { label: string; total: number }

/** 1 & 3 — total appointments, over a date range. */
export async function totalConsultations(range: ReportRange): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(consultation)
    .where(scope(range));
  return row?.total ?? 0;
}

/** 2 — status breakdown. */
export async function consultationsByStatus(range: ReportRange): Promise<Counted[]> {
  const rows = await db
    .select({ label: consultation.status, total: count() })
    .from(consultation)
    .where(scope(range))
    .groupBy(consultation.status)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: String(r.label), total: r.total }));
}

/** 4 — by service. */
export async function consultationsByService(range: ReportRange): Promise<Counted[]> {
  const rows = await db
    .select({ label: service.name, total: count() })
    .from(consultation)
    .innerJoin(service, eq(consultation.serviceId, service.id))
    .where(scope(range))
    .groupBy(service.name)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: r.label, total: r.total }));
}

/** 3 — a day-by-day series, for the shape of a period rather than its total. */
export async function consultationsByDay(range: ReportRange): Promise<Counted[]> {
  const rows = await db
    .select({
      // Grouped in the pharmacy's zone: a 09:00 local consultation is 08:00
      // UTC in summer, and grouping by the server's day moves it.
      label: sql<string>`to_char(${consultation.createdAt} at time zone 'Europe/Isle_of_Man', 'YYYY-MM-DD')`,
      total: count(),
    })
    .from(consultation)
    .where(scope(range))
    .groupBy(sql`1`)
    .orderBy(asc(sql`1`));
  return rows.map((r) => ({ label: r.label, total: r.total }));
}

/** 5 — pharmacist activity. */
export async function pharmacistActivity(range: ReportRange): Promise<Counted[]> {
  const rows = await db
    .select({ label: clinician.fullName, total: count() })
    .from(consultation)
    .innerJoin(clinician, eq(consultation.clinicianId, clinician.id))
    .where(scope(range))
    .groupBy(clinician.fullName)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: r.label, total: r.total }));
}

/** 6 — prescriptions issued, by lifecycle state. */
export async function prescriptionsIssued(range: ReportRange): Promise<Counted[]> {
  const rows = await db
    .select({ label: prescription.status, total: count() })
    .from(prescription)
    .where(
      and(
        eq(prescription.organisationId, range.organisationId),
        gte(prescription.createdAt, range.from),
        lte(prescription.createdAt, range.to),
      ),
    )
    .groupBy(prescription.status)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: String(r.label), total: r.total }));
}

/** 7 — medicine usage, from what was actually prescribed. */
export async function medicineUsage(range: ReportRange): Promise<Counted[]> {
  const rows = await db
    .select({ label: prescription.medicineNameSnapshot, total: count() })
    .from(prescription)
    .where(
      and(
        eq(prescription.organisationId, range.organisationId),
        gte(prescription.createdAt, range.from),
        lte(prescription.createdAt, range.to),
      ),
    )
    .groupBy(prescription.medicineNameSnapshot)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: r.label, total: r.total }));
}

/**
 * 8 — stock usage, by movement kind.
 *
 * Quantities summed, not rows counted: one movement of forty is not the same
 * event as forty movements of one, and a report that counted rows would say
 * they were.
 */
export async function stockUsage(range: ReportRange): Promise<Counted[]> {
  const rows = await db
    .select({
      label: stockMovement.kind,
      total: sql<number>`coalesce(sum(abs(${stockMovement.quantity})), 0)::int`,
    })
    .from(stockMovement)
    .where(
      and(
        eq(stockMovement.organisationId, range.organisationId),
        gte(stockMovement.occurredAt, range.from),
        lte(stockMovement.occurredAt, range.to),
      ),
    )
    .groupBy(stockMovement.kind)
    .orderBy(desc(sql`2`));
  return rows.map((r) => ({ label: r.label, total: Number(r.total) }));
}

/** 9 — rejections, with the reason, because the count alone teaches nothing. */
export interface RejectedCase {
  submissionId: string;
  patientName: string | null;
  serviceName: string;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: Date;
}

export async function rejectedCases(range: ReportRange, limit = 200): Promise<RejectedCase[]> {
  const rows = await db
    .select({
      submissionId: reviewEvent.submissionId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      serviceName: service.name,
      reason: reviewEvent.note,
      decidedAt: reviewEvent.occurredAt,
      decidedBy: clinician.fullName,
    })
    .from(reviewEvent)
    .innerJoin(submission, eq(reviewEvent.submissionId, submission.id))
    .innerJoin(service, eq(submission.serviceId, service.id))
    .leftJoin(patient, eq(submission.patientId, patient.id))
    .leftJoin(clinician, eq(clinician.userId, reviewEvent.userId))
    .where(
      and(
        eq(reviewEvent.organisationId, range.organisationId),
        eq(reviewEvent.action, 'REJECTED'),
        gte(reviewEvent.occurredAt, range.from),
        lte(reviewEvent.occurredAt, range.to),
      ),
    )
    .orderBy(desc(reviewEvent.occurredAt))
    .limit(limit);

  return rows.map((r) => ({
    submissionId: r.submissionId,
    patientName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
    serviceName: r.serviceName,
    reason: r.reason,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
  }));
}

/**
 * 10 — weight and BMI progress.
 *
 * Read from `derived`, which is where the computed values are stored at
 * submission, rather than recomputed here. Recomputing would answer "what would
 * we calculate today", and the report is asking "what did we record then".
 */
export interface ProgressRow {
  patientId: string | null;
  patientName: string | null;
  submittedAt: Date | null;
  bmi: number | null;
  weightLossPercent: number | null;
}

export async function weightProgress(range: ReportRange, limit = 500): Promise<ProgressRow[]> {
  const rows = await db
    .select({
      patientId: submission.patientId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      submittedAt: submission.submittedAt,
      derived: submission.derived,
    })
    .from(submission)
    .leftJoin(patient, eq(submission.patientId, patient.id))
    .where(
      and(
        eq(submission.organisationId, range.organisationId),
        isNotNull(submission.submittedAt),
        gte(submission.submittedAt, range.from),
        lte(submission.submittedAt, range.to),
      ),
    )
    .orderBy(desc(submission.submittedAt))
    .limit(limit);

  return rows
    .map((r) => {
      const derived = (r.derived ?? {}) as Record<string, unknown>;
      const bmi = typeof derived.bmi === 'number' ? derived.bmi : null;
      const loss = typeof derived.weightLossPercent === 'number'
        ? derived.weightLossPercent : null;
      return {
        patientId: r.patientId,
        patientName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
        submittedAt: r.submittedAt,
        bmi,
        weightLossPercent: loss,
      };
    })
    // A row with neither value is a questionnaire that did not measure anything
    // — including it would pad the report with blanks.
    .filter((r) => r.bmi !== null || r.weightLossPercent !== null);
}

/** Vaccinations given, which the flu service reports on rather than prescriptions. */
export async function vaccinationsGiven(range: ReportRange): Promise<Counted[]> {
  const rows = await db
    .select({ label: vaccineAdministration.vaccineNameSnapshot, total: count() })
    .from(vaccineAdministration)
    .where(
      and(
        eq(vaccineAdministration.organisationId, range.organisationId),
        gte(vaccineAdministration.completedAt, range.from),
        lte(vaccineAdministration.completedAt, range.to),
      ),
    )
    .groupBy(vaccineAdministration.vaccineNameSnapshot)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: r.label, total: r.total }));
}

export interface Revenue {
  /** Pence taken in the period. */
  totalMinor: number;
  /** Pence raised but not yet settled — what is owed. */
  outstandingMinor: number;
  byService: Counted[];
}

/**
 * What the period earned.
 *
 * Reports counted consultations, prescriptions and stock and never once
 * mentioned money, which is the first question an owner asks. Read from
 * `payment` rather than from the service's current price, because a price
 * edited in June must not retrospectively change what March took.
 *
 * Outstanding is shown beside it deliberately: a service with no price used to
 * strand its prescriptions awaiting a payment that could never be made, and a
 * revenue figure alone would hide that.
 */
export async function revenue(range: ReportRange): Promise<Revenue> {
  const scoped = (extra: SQL | undefined) => (range.branchId
    ? and(
      eq(payment.organisationId, range.organisationId),
      eq(payment.branchId, range.branchId),
      gte(payment.createdAt, range.from),
      lte(payment.createdAt, range.to),
      extra,
    )
    : and(
      eq(payment.organisationId, range.organisationId),
      gte(payment.createdAt, range.from),
      lte(payment.createdAt, range.to),
      extra,
    ));

  const [totals] = await db
    .select({
      paid: sql<number>`coalesce(sum(${payment.amountMinor}) filter (where ${payment.status} = 'PAID'), 0)::int`,
      outstanding: sql<number>`coalesce(sum(${payment.amountMinor}) filter (where ${payment.status} = 'PENDING'), 0)::int`,
    })
    .from(payment)
    .where(scoped(undefined));

  /*
   * Left joins, not inner ones.
   *
   * A payment reaches a service through its submission, and not every payment
   * has one — a counter sale, or anything raised outside a questionnaire.
   * Joined inwards those rows vanished from the breakdown while still counting
   * towards the total, so the figures on the screen did not add up to the
   * figure above them. They are now gathered under their own heading instead:
   * money the pharmacy took is money the pharmacy took, and a report that
   * quietly loses some of it is worse than one that cannot attribute it.
   */
  const rows = await db
    .select({
      label: sql<string>`coalesce(${service.name}, 'Not linked to a service')`,
      total: sql<number>`coalesce(sum(${payment.amountMinor}), 0)::int`,
    })
    .from(payment)
    .leftJoin(submission, eq(payment.submissionId, submission.id))
    .leftJoin(service, eq(submission.serviceId, service.id))
    .where(scoped(eq(payment.status, 'PAID')))
    .groupBy(sql`coalesce(${service.name}, 'Not linked to a service')`)
    .orderBy(desc(sql`coalesce(sum(${payment.amountMinor}), 0)`));

  return {
    totalMinor: totals?.paid ?? 0,
    outstandingMinor: totals?.outstanding ?? 0,
    byService: rows.map((r) => ({ label: r.label, total: r.total })),
  };
}

export interface ReportBundle {
  total: number;
  revenue: Revenue;
  byStatus: Counted[];
  byService: Counted[];
  byDay: Counted[];
  byPharmacist: Counted[];
  prescriptions: Counted[];
  medicines: Counted[];
  stock: Counted[];
  vaccinations: Counted[];
  rejected: RejectedCase[];
  progress: ProgressRow[];
}

/** Everything at once. Independent queries, so they go together. */
export async function buildReports(range: ReportRange): Promise<ReportBundle> {
  const [
    total, byStatus, byService, byDay, byPharmacist,
    prescriptions, medicines, stock, vaccinations, rejected, progress,
    money,
  ] = await Promise.all([
    totalConsultations(range),
    consultationsByStatus(range),
    consultationsByService(range),
    consultationsByDay(range),
    pharmacistActivity(range),
    prescriptionsIssued(range),
    medicineUsage(range),
    stockUsage(range),
    vaccinationsGiven(range),
    rejectedCases(range),
    weightProgress(range),
    revenue(range),
  ]);

  return {
    total, byStatus, byService, byDay, byPharmacist,
    prescriptions, medicines, stock, vaccinations, rejected, progress,
    revenue: money,
  };
}
