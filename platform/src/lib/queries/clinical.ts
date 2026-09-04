/**
 * Queries for the clinical screens.
 *
 * Explicit column lists throughout rather than `select *` — these tables hold
 * special-category health data, and being deliberate about what leaves the
 * database is cheap here and expensive to retrofit.
 */

import { and, desc, eq, gte, isNull, lte, sql, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  patient, gpSurgery, consultation, service, clinician, branch, submission, stockLevel, batch, product, auditEvent, appUser, prescriptionFulfilment,
} from '@/lib/db/schema';
import { dayBounds } from './notifications';
import { getDueList } from './due';

// ─────────────────────────────────────────────────────────────
// Patients
// ─────────────────────────────────────────────────────────────

export interface PatientRow {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string | null;
  phone: string | null;
  email: string | null;
  town: string | null;
  postcode: string | null;
  gpSurgeryName: string | null;
  registeredBranchName: string | null;
}

/**
 * Every patient in the organisation — deliberately NOT filtered by branch.
 * A patient attending either site must be found instantly, which is what the
 * legacy system made structurally impossible.
 */
export async function getPatients(organisationId: string): Promise<PatientRow[]> {
  return db
    .select({
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      phone: patient.phone,
      email: patient.email,
      town: patient.town,
      postcode: patient.postcode,
      gpSurgeryName: gpSurgery.name,
      registeredBranchName: branch.name,
    })
    .from(patient)
    .leftJoin(gpSurgery, eq(patient.gpSurgeryId, gpSurgery.id))
    .leftJoin(branch, eq(patient.registeredBranchId, branch.id))
    .where(and(eq(patient.organisationId, organisationId), isNull(patient.archivedAt)))
    .orderBy(patient.lastName, patient.firstName);
}

export interface PatientDetail extends PatientRow {
  addressLine1: string | null;
  gpSurgeryEmail: string | null;
  createdAt: Date;
}

export async function getPatient(
  organisationId: string,
  patientId: string,
): Promise<PatientDetail | null> {
  const rows = await db
    .select({
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      phone: patient.phone,
      email: patient.email,
      addressLine1: patient.addressLine1,
      town: patient.town,
      postcode: patient.postcode,
      gpSurgeryName: gpSurgery.name,
      gpSurgeryEmail: gpSurgery.email,
      registeredBranchName: branch.name,
      createdAt: patient.createdAt,
    })
    .from(patient)
    .leftJoin(gpSurgery, eq(patient.gpSurgeryId, gpSurgery.id))
    .leftJoin(branch, eq(patient.registeredBranchId, branch.id))
    .where(and(eq(patient.id, patientId), eq(patient.organisationId, organisationId)))
    .limit(1);

  return rows[0] ?? null;
}

export interface TimelineEntry {
  id: string;
  kind: 'consultation' | 'submission';
  title: string;
  detail: string | null;
  branchName: string | null;
  status: string;
  occurredAt: Date;
}

/**
 * Consultations and submissions merged into one chronology.
 *
 * One timeline rather than separate tabs — a pharmacist reconstructing what
 * happened to a patient should not have to piece it together from three places.
 */
export async function getPatientTimeline(
  organisationId: string,
  patientId: string,
): Promise<TimelineEntry[]> {
  const consultations = await db
    .select({
      id: consultation.id,
      serviceName: service.name,
      branchName: branch.name,
      status: consultation.status,
      completedAt: consultation.completedAt,
      createdAt: consultation.createdAt,
      clinicianName: clinician.fullName,
    })
    .from(consultation)
    .innerJoin(service, eq(consultation.serviceId, service.id))
    .innerJoin(branch, eq(consultation.branchId, branch.id))
    .leftJoin(clinician, eq(consultation.clinicianId, clinician.id))
    .where(and(eq(consultation.organisationId, organisationId), eq(consultation.patientId, patientId)));

  const submissions = await db
    .select({
      id: submission.id,
      serviceName: service.name,
      status: submission.status,
      submittedAt: submission.submittedAt,
      createdAt: submission.createdAt,
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .where(and(eq(submission.organisationId, organisationId), eq(submission.patientId, patientId)));

  const entries: TimelineEntry[] = [
    ...consultations.map((c) => ({
      id: c.id,
      kind: 'consultation' as const,
      title: c.serviceName,
      detail: c.clinicianName ? `Seen by ${c.clinicianName}` : null,
      branchName: c.branchName,
      status: c.status,
      occurredAt: c.completedAt ?? c.createdAt,
    })),
    ...submissions.map((s) => ({
      id: s.id,
      kind: 'submission' as const,
      title: `${s.serviceName} — form completed`,
      detail: null,
      branchName: null,
      status: s.status,
      occurredAt: s.submittedAt ?? s.createdAt,
    })),
  ];

  return entries.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

// ─────────────────────────────────────────────────────────────
// Consultations
// ─────────────────────────────────────────────────────────────

export interface ConsultationRow {
  id: string;
  patientName: string;
  dateOfBirth: string;
  serviceName: string;
  branchName: string;
  clinicianName: string | null;
  productName: string | null;
  batchNumber: string | null;
  status: string;
  fundedBy: string | null;
  completedAt: Date | null;
}

export async function getConsultations(
  organisationId: string,
  options: { branchId?: string; from?: Date; to?: Date } = {},
): Promise<ConsultationRow[]> {
  const filters = [eq(consultation.organisationId, organisationId)];
  if (options.branchId) filters.push(eq(consultation.branchId, options.branchId));
  if (options.from) filters.push(gte(consultation.createdAt, options.from));
  if (options.to) filters.push(lte(consultation.createdAt, options.to));

  const rows = await db
    .select({
      id: consultation.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      serviceName: service.name,
      branchName: branch.name,
      clinicianName: clinician.fullName,
      productName: product.name,
      batchNumber: batch.batchNumber,
      status: consultation.status,
      clinicalData: consultation.clinicalData,
      completedAt: consultation.completedAt,
      createdAt: consultation.createdAt,
    })
    .from(consultation)
    .innerJoin(patient, eq(consultation.patientId, patient.id))
    .innerJoin(service, eq(consultation.serviceId, service.id))
    .innerJoin(branch, eq(consultation.branchId, branch.id))
    .leftJoin(clinician, eq(consultation.clinicianId, clinician.id))
    .leftJoin(batch, eq(consultation.batchId, batch.id))
    .leftJoin(product, eq(batch.productId, product.id))
    .where(and(...filters))
    .orderBy(desc(consultation.createdAt))
    .limit(1000);

  return rows.map((r) => {
    const clinical = (r.clinicalData ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      patientName: `${r.firstName} ${r.lastName}`,
      dateOfBirth: r.dateOfBirth,
      serviceName: r.serviceName,
      branchName: r.branchName,
      clinicianName: r.clinicianName,
      productName: r.productName,
      batchNumber: r.batchNumber,
      status: r.status,
      fundedBy: typeof clinical.fundedBy === 'string' ? clinical.fundedBy : null,
      completedAt: r.completedAt ?? r.createdAt,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Inventory
// ─────────────────────────────────────────────────────────────

export interface StockRow {
  batchId: string;
  productName: string;
  category: string | null;
  batchNumber: string;
  expiryDate: string;
  branchName: string;
  branchId: string;
  quantity: number;
  recalledAt: Date | null;
  daysToExpiry: number;
}

export async function getStock(
  organisationId: string,
  branchId?: string,
): Promise<StockRow[]> {
  const filters = [eq(stockLevel.organisationId, organisationId)];
  if (branchId) filters.push(eq(stockLevel.branchId, branchId));

  const rows = await db
    .select({
      batchId: batch.id,
      productName: product.name,
      category: product.category,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      recalledAt: batch.recalledAt,
      branchName: branch.name,
      branchId: branch.id,
      quantity: stockLevel.quantity,
    })
    .from(stockLevel)
    .innerJoin(batch, eq(stockLevel.batchId, batch.id))
    .innerJoin(product, eq(batch.productId, product.id))
    .innerJoin(branch, eq(stockLevel.branchId, branch.id))
    .where(and(...filters))
    .orderBy(batch.expiryDate);

  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    daysToExpiry: Math.ceil((new Date(r.expiryDate).getTime() - now) / 86_400_000),
  }));
}

/** Who received a batch — the question that matters the moment one is recalled. */
export async function getBatchRecipients(organisationId: string, batchId: string) {
  return db
    .select({
      consultationId: consultation.id,
      patientName: sql<string>`${patient.firstName} || ' ' || ${patient.lastName}`,
      phone: patient.phone,
      email: patient.email,
      completedAt: consultation.completedAt,
      branchName: branch.name,
    })
    .from(consultation)
    .innerJoin(patient, eq(consultation.patientId, patient.id))
    .innerJoin(branch, eq(consultation.branchId, branch.id))
    .where(and(eq(consultation.organisationId, organisationId), eq(consultation.batchId, batchId)))
    .orderBy(desc(consultation.completedAt));
}

// ─────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────

export interface TodaySnapshot {
  completedToday: number;
  submissionsAwaiting: number;
  /** New patients waiting to be read and telephoned. */
  newPatientsAwaiting: number;
  /** How many of those nobody has yet spoken to and identified. */
  callsOwed: number;
  /** Repeat requests a safety rule stopped. */
  repeatsStopped: number;
  /** Prescriptions issued but not yet in the patient hands. */
  awaitingSupply: number;
  /** Enrolled patients whose supply has run out, or is about to. */
  dueForRepeat: number;
  lowStock: StockRow[];
  expiringSoon: StockRow[];
  recentConsultations: ConsultationRow[];
}

export async function getTodaySnapshot(
  organisationId: string,
  branchId: string | null,
): Promise<TodaySnapshot> {
  const { from, to } = dayBounds(new Date());

  const todays = await getConsultations(organisationId, {
    branchId: branchId ?? undefined, from, to,
  });

  const awaiting = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submission)
    .where(
      and(
        eq(submission.organisationId, organisationId),
        inArray(submission.status, ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED']),
      ),
    );

  /*
   * "Awaiting a decision" is one number covering two different jobs.
   *
   * A new patient needs reading and telephoning; a repeat needs authorising
   * and, per the client, no call at all. Somebody glancing at Today to decide
   * what to pick up cannot tell those apart from a single figure — and the
   * calls are the ones that age badly, because a patient is sitting waiting
   * for the phone to ring.
   *
   * Split on service kind rather than name: the pharmacy renames its own
   * services and a rename must not change what the dashboard counts.
   */
  const [newPatients] = await db
    .select({
      total: sql<number>`count(*)::int`,
      toCall: sql<number>`count(*) filter (
        where not exists (
          select 1 from clinical_contact_event c
          where c.submission_id = ${submission.id}
            and c.outcome = 'COMPLETED'
            and c.identity_verified = true
        )
      )::int`,
    })
    .from(submission)
    .innerJoin(service, eq(submission.serviceId, service.id))
    .where(
      and(
        eq(submission.organisationId, organisationId),
        inArray(submission.status, ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED']),
        eq(service.kind, 'CONSULTATION'),
      ),
    );

  /*
   * Repeats that a rule stopped. Read from the latest evaluation rather than
   * from anything cached on the submission, because an amendment writes a
   * fresh evaluation rather than overwriting the old one.
   */
  const [reds] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submission)
    .where(
      and(
        eq(submission.organisationId, organisationId),
        inArray(submission.status, ['SUBMITTED', 'IN_REVIEW', 'INFO_REQUESTED']),
        sql`(
          select r.outcome from rule_evaluation r
          where r.submission_id = ${submission.id}
          order by r.evaluated_at desc limit 1
        ) = 'RED'`,
      ),
    );

  /*
   * Enrolled patients nobody has heard from.
   *
   * The other counters on Today are work that arrived. This is the one that
   * never arrives on its own — a patient who ran out three weeks ago appears
   * on no screen until somebody goes looking.
   */
  const due = await getDueList(organisationId);

  /* Approved, paid for or not, but the medicine has not gone out. */
  const [toSupply] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prescriptionFulfilment)
    .where(
      and(
        eq(prescriptionFulfilment.organisationId, organisationId),
        inArray(prescriptionFulfilment.status, ['PENDING', 'ASSEMBLING', 'READY']),
      ),
    );

  const stock = await getStock(organisationId, branchId ?? undefined);

  return {
    completedToday: todays.filter((c) => c.status === 'COMPLETED').length,
    submissionsAwaiting: awaiting[0]?.count ?? 0,
    dueForRepeat: due.length,
    newPatientsAwaiting: newPatients?.total ?? 0,
    callsOwed: newPatients?.toCall ?? 0,
    repeatsStopped: reds?.count ?? 0,
    awaitingSupply: toSupply?.count ?? 0,
    lowStock: stock.filter((s) => s.quantity > 0 && s.quantity <= 10),
    expiringSoon: stock.filter((s) => s.daysToExpiry <= 60 && s.quantity > 0),
    recentConsultations: todays.slice(0, 8),
  };
}

// ─────────────────────────────────────────────────────────────
// Compliance
// ─────────────────────────────────────────────────────────────

export async function getAuditTrail(organisationId: string, limit = 200) {
  return db
    .select({
      id: auditEvent.id,
      action: auditEvent.action,
      entityType: auditEvent.entityType,
      entityId: auditEvent.entityId,
      userName: appUser.fullName,
      branchName: branch.name,
      occurredAt: auditEvent.occurredAt,
      hash: auditEvent.hash,
      previousHash: auditEvent.previousHash,
    })
    .from(auditEvent)
    .leftJoin(appUser, eq(auditEvent.userId, appUser.id))
    .leftJoin(branch, eq(auditEvent.branchId, branch.id))
    .where(eq(auditEvent.organisationId, organisationId))
    .orderBy(desc(auditEvent.occurredAt))
    .limit(limit);
}
