/**
 * GP notification batching.
 *
 * The client's preferred mode: one email per surgery at the end of each day,
 * listing every patient seen. Surgeries prefer one message to twenty, and eleven
 * separate mailouts per patient would be unwelcome in a `@gov.im` inbox.
 *
 * Three requirements drive the design, all stated in the brief:
 *   - never send the same consultation to a surgery twice
 *   - allow a historical resend, filtered by date and surgery
 *   - alert staff when delivery fails
 *
 * The first is why `alreadySentConsultationIds` is a required argument rather
 * than an optional one — forgetting it would silently double-notify.
 */

export interface NotifiableConsultation {
  consultationId: string;
  patientId: string;
  patientName: string;
  patientDateOfBirth: Date;
  gpSurgeryId: string;
  gpSurgeryName: string;
  gpSurgeryEmail: string;
  serviceName: string;
  productName?: string | null;
  batchNumber?: string | null;
  siteOfAdministration?: string | null;
  routeOfAdministration?: string | null;
  clinicianName: string;
  clinicianGphc: string;
  branchName: string;
  completedAt: Date;
}

export interface GpBatch {
  gpSurgeryId: string;
  gpSurgeryName: string;
  recipientEmail: string;
  consultations: NotifiableConsultation[];
  /** Groups the resulting messages so a whole batch can be traced or resent. */
  batchRef: string;
}

export interface BatchingResult {
  batches: GpBatch[];
  skipped: {
    /** Consultations already notified — excluded, not re-sent. */
    alreadySent: string[];
    /** Patients with no usable GP address. These need manual handling. */
    noGpAddress: NotifiableConsultation[];
  };
  totalConsultations: number;
}

function isValidEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function buildBatchRef(date: Date, gpSurgeryId: string): string {
  return `gpbatch-${date.toISOString().slice(0, 10)}-${gpSurgeryId}`;
}

/**
 * Groups consultations into one batch per surgery.
 *
 * Anything without a valid GP address is separated rather than dropped. A silent
 * drop means a GP never learns their patient was vaccinated, and nobody notices.
 */
export function buildGpBatches(input: {
  consultations: NotifiableConsultation[];
  alreadySentConsultationIds: Set<string>;
  batchDate: Date;
}): BatchingResult {
  const { consultations, alreadySentConsultationIds, batchDate } = input;

  const alreadySent: string[] = [];
  const noGpAddress: NotifiableConsultation[] = [];
  const bySurgery = new Map<string, NotifiableConsultation[]>();

  for (const consultation of consultations) {
    if (alreadySentConsultationIds.has(consultation.consultationId)) {
      alreadySent.push(consultation.consultationId);
      continue;
    }

    if (!isValidEmail(consultation.gpSurgeryEmail)) {
      noGpAddress.push(consultation);
      continue;
    }

    const existing = bySurgery.get(consultation.gpSurgeryId) ?? [];
    existing.push(consultation);
    bySurgery.set(consultation.gpSurgeryId, existing);
  }

  const batches: GpBatch[] = [];

  for (const [gpSurgeryId, items] of bySurgery) {
    const first = items[0]!;
    batches.push({
      gpSurgeryId,
      gpSurgeryName: first.gpSurgeryName,
      recipientEmail: first.gpSurgeryEmail,
      // Sorted by surname so a surgery can scan the table.
      consultations: [...items].sort((a, b) =>
        a.patientName.split(' ').at(-1)!.localeCompare(b.patientName.split(' ').at(-1)!),
      ),
      batchRef: buildBatchRef(batchDate, gpSurgeryId),
    });
  }

  return {
    batches: batches.sort((a, b) => a.gpSurgeryName.localeCompare(b.gpSurgeryName)),
    skipped: { alreadySent, noGpAddress },
    totalConsultations: batches.reduce((sum, b) => sum + b.consultations.length, 0),
  };
}

// ─────────────────────────────────────────────────────────────
// Delivery monitoring
// ─────────────────────────────────────────────────────────────

export interface MessageStatusRecord {
  messageId: string;
  recipient: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'FAILED';
  sentAt?: Date | null;
  failedReason?: string | null;
}

export interface DeliveryAlert {
  severity: 'HIGH' | 'MEDIUM';
  code: string;
  message: string;
  affected: string[];
}

/**
 * Produces alerts staff should act on.
 *
 * Bounces to `@gov.im` are HIGH: a bounced clinical notification means a GP
 * practice has no record of something that happened to their patient, and the
 * usual cause is an address that needs correcting rather than a transient fault.
 *
 * A message stuck in QUEUED past the threshold is also flagged. Silent queue
 * stalls are the failure nobody notices until a surgery complains.
 */
export function detectDeliveryProblems(
  messages: MessageStatusRecord[],
  options: { stuckAfterMinutes?: number; now?: Date } = {},
): DeliveryAlert[] {
  const { stuckAfterMinutes = 60, now = new Date() } = options;
  const alerts: DeliveryAlert[] = [];

  const bounced = messages.filter((m) => m.status === 'BOUNCED');
  if (bounced.length > 0) {
    alerts.push({
      severity: 'HIGH',
      code: 'DELIVERY_BOUNCED',
      message: `${bounced.length} notification${bounced.length === 1 ? '' : 's'} bounced. The recipient address is likely wrong — check it before resending.`,
      affected: bounced.map((m) => m.recipient),
    });
  }

  const failed = messages.filter((m) => m.status === 'FAILED');
  if (failed.length > 0) {
    alerts.push({
      severity: 'HIGH',
      code: 'DELIVERY_FAILED',
      message: `${failed.length} notification${failed.length === 1 ? '' : 's'} failed to send.`,
      affected: failed.map((m) => m.recipient),
    });
  }

  const cutoff = new Date(now.getTime() - stuckAfterMinutes * 60_000);
  const stuck = messages.filter(
    (m) => m.status === 'QUEUED' && (!m.sentAt || m.sentAt < cutoff),
  );

  if (stuck.length > 0) {
    alerts.push({
      severity: 'MEDIUM',
      code: 'DELIVERY_STUCK',
      message: `${stuck.length} notification${stuck.length === 1 ? '' : 's'} have been queued for over ${stuckAfterMinutes} minutes.`,
      affected: stuck.map((m) => m.recipient),
    });
  }

  return alerts;
}

// ─────────────────────────────────────────────────────────────
// Daily internal summary
// ─────────────────────────────────────────────────────────────

export interface DailySummary {
  date: Date;
  byBranch: {
    branchName: string;
    total: number;
    nhs: number;
    paid: number;
    byService: { serviceName: string; count: number }[];
  }[];
  totals: { consultations: number; nhs: number; paid: number };
  gpNotificationsSent: number;
  outstandingReviews: number;
  alerts: string[];
}

/** Builds the end-of-day summary emailed to the pharmacy team. */
export function buildDailySummary(input: {
  date: Date;
  consultations: { branchName: string; serviceName: string; fundingType?: string | null }[];
  gpNotificationsSent: number;
  outstandingReviews: number;
  alerts?: string[];
}): DailySummary {
  const branchMap = new Map<string, { nhs: number; paid: number; services: Map<string, number> }>();

  for (const c of input.consultations) {
    const branch = branchMap.get(c.branchName) ?? { nhs: 0, paid: 0, services: new Map() };
    if (c.fundingType === 'NHS') branch.nhs += 1;
    else branch.paid += 1;
    branch.services.set(c.serviceName, (branch.services.get(c.serviceName) ?? 0) + 1);
    branchMap.set(c.branchName, branch);
  }

  const byBranch = [...branchMap.entries()]
    .map(([branchName, data]) => ({
      branchName,
      total: data.nhs + data.paid,
      nhs: data.nhs,
      paid: data.paid,
      byService: [...data.services.entries()]
        .map(([serviceName, count]) => ({ serviceName, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => a.branchName.localeCompare(b.branchName));

  return {
    date: input.date,
    byBranch,
    totals: {
      consultations: input.consultations.length,
      nhs: byBranch.reduce((s, b) => s + b.nhs, 0),
      paid: byBranch.reduce((s, b) => s + b.paid, 0),
    },
    gpNotificationsSent: input.gpNotificationsSent,
    outstandingReviews: input.outstandingReviews,
    alerts: input.alerts ?? [],
  };
}

// ─────────────────────────────────────────────────────────────
// Prescription numbering
// ─────────────────────────────────────────────────────────────

/**
 * Sequential, human-readable prescription numbers: `KP-2026-000412`.
 *
 * Sequence is per organisation per year. Gaps matter — a missing number in a
 * sequence is a question an inspector will ask, so numbers are allocated inside
 * the issuing transaction and never pre-allocated or reserved.
 */
export function formatPrescriptionNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

export function parsePrescriptionNumber(
  value: string,
): { prefix: string; year: number; sequence: number } | null {
  const match = /^([A-Z]+)-(\d{4})-(\d{6})$/.exec(value);
  if (!match) return null;

  return {
    prefix: match[1]!,
    year: Number(match[2]),
    sequence: Number(match[3]),
  };
}

/** Finds gaps in an issued sequence — evidence for the compliance centre. */
export function findSequenceGaps(numbers: string[]): number[] {
  const sequences = numbers
    .map(parsePrescriptionNumber)
    .filter((n): n is NonNullable<typeof n> => n !== null)
    .map((n) => n.sequence)
    .sort((a, b) => a - b);

  if (sequences.length === 0) return [];

  const gaps: number[] = [];
  for (let i = sequences[0]!; i <= sequences.at(-1)!; i += 1) {
    if (!sequences.includes(i)) gaps.push(i);
  }
  return gaps;
}
