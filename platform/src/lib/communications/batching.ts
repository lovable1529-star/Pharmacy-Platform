/**
 * GP notification batching.
 *
 * The client's stated preference: one email per surgery at the end of each day,
 * listing every patient seen. Surgeries prefer one message to twenty, and eleven
 * separate mailouts per patient would be unwelcome in a @gov.im inbox.
 *
 * Pure functions — grouping, reference generation and problem detection are all
 * testable without sending anything.
 *
 * The delivery risk this exists to manage: every surgery is a government
 * mailbox, and without aligned SPF, DKIM and DMARC they reject or silently drop
 * clinical mail. A silent drop means a practice never learns their patient was
 * vaccinated, with no bounce to notice. That is why delivery state is tracked
 * per message rather than assumed.
 */

export interface NotifiableConsultation {
  consultationId: string;
  patientName: string;
  patientDateOfBirth: string;
  gpSurgeryId: string;
  gpSurgeryName: string;
  gpSurgeryEmail: string;
  serviceName: string;
  productName: string | null;
  batchNumber: string | null;
  administeredAt: Date;
  branchName: string;
  clinicianName: string;
  clinicianGphc: string;
  siteOfAdministration: string | null;
  fundedBy: 'NHS' | 'Private' | null;
  /** Already sent in an earlier batch — excluded unless resending. */
  notifiedAt: Date | null;
}

export interface GpBatch {
  gpSurgeryId: string;
  gpSurgeryName: string;
  gpSurgeryEmail: string;
  reference: string;
  consultations: NotifiableConsultation[];
}

export interface BatchingResult {
  batches: GpBatch[];
  /** Consultations with no usable surgery address — these need a human. */
  unroutable: NotifiableConsultation[];
  totalConsultations: number;
}

/** e.g. KP-20260827-HAILWO — stable, sortable, and readable in an inbox. */
export function buildBatchRef(date: Date, gpSurgeryName: string): string {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('');

  const slug = gpSurgeryName
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 6)
    .padEnd(6, 'X');

  return `KP-${stamp}-${slug}`;
}

function looksLikeEmail(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Groups a day's consultations into one batch per surgery.
 *
 * Already-notified consultations are excluded by default, so re-running the job
 * — which happens whenever a cron retries — never double-sends. Passing
 * `includeAlreadySent` is how a manual resend of a corrected record works.
 */
export function buildGpBatches(input: {
  consultations: NotifiableConsultation[];
  date?: Date;
  includeAlreadySent?: boolean;
}): BatchingResult {
  const { consultations, date = new Date(), includeAlreadySent = false } = input;

  const eligible = includeAlreadySent
    ? consultations
    : consultations.filter((c) => c.notifiedAt === null);

  const unroutable: NotifiableConsultation[] = [];
  const grouped = new Map<string, NotifiableConsultation[]>();

  for (const consultation of eligible) {
    if (!looksLikeEmail(consultation.gpSurgeryEmail)) {
      unroutable.push(consultation);
      continue;
    }
    const existing = grouped.get(consultation.gpSurgeryId);
    if (existing) existing.push(consultation);
    else grouped.set(consultation.gpSurgeryId, [consultation]);
  }

  const batches: GpBatch[] = [...grouped.entries()]
    .map(([gpSurgeryId, group]) => {
      const first = group[0]!;
      return {
        gpSurgeryId,
        gpSurgeryName: first.gpSurgeryName,
        gpSurgeryEmail: first.gpSurgeryEmail,
        reference: buildBatchRef(date, first.gpSurgeryName),
        // Oldest first, so the table reads in the order the day happened.
        consultations: [...group].sort(
          (a, b) => a.administeredAt.getTime() - b.administeredAt.getTime(),
        ),
      };
    })
    .sort((a, b) => a.gpSurgeryName.localeCompare(b.gpSurgeryName));

  return { batches, unroutable, totalConsultations: eligible.length };
}

// ─────────────────────────────────────────────────────────────
// Delivery monitoring
// ─────────────────────────────────────────────────────────────

export interface MessageStatusRecord {
  messageId: string;
  gpSurgeryName: string;
  recipient: string;
  status: 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed';
  sentAt: Date;
  patientCount: number;
}

export interface DeliveryAlert {
  severity: 'warn' | 'stop';
  recipient: string;
  gpSurgeryName: string;
  message: string;
  affectedPatients: number;
}

/**
 * Turns raw delivery states into things a human should act on.
 *
 * A bounce is urgent because the surgery has no record of a clinical event that
 * actually happened. A message stuck in `queued` for hours usually means the
 * domain is failing authentication checks — which fails silently for everyone.
 */
export function detectDeliveryProblems(
  records: MessageStatusRecord[],
  now = new Date(),
  stuckAfterMinutes = 60,
): DeliveryAlert[] {
  const alerts: DeliveryAlert[] = [];

  for (const record of records) {
    if (record.status === 'bounced' || record.status === 'failed') {
      alerts.push({
        severity: 'stop',
        recipient: record.recipient,
        gpSurgeryName: record.gpSurgeryName,
        message:
          `Mail to ${record.gpSurgeryName} ${record.status}. The address is likely wrong — ` +
          'check it and resend, then confirm the practice has the record.',
        affectedPatients: record.patientCount,
      });
      continue;
    }

    const ageMinutes = (now.getTime() - record.sentAt.getTime()) / 60000;
    if (record.status === 'queued' && ageMinutes > stuckAfterMinutes) {
      alerts.push({
        severity: 'warn',
        recipient: record.recipient,
        gpSurgeryName: record.gpSurgeryName,
        message:
          `Mail to ${record.gpSurgeryName} has been queued for ${Math.round(ageMinutes)} minutes. ` +
          'Check SPF, DKIM and DMARC on the sending domain.',
        affectedPatients: record.patientCount,
      });
    }
  }

  return alerts.sort((a, b) => b.affectedPatients - a.affectedPatients);
}

// ─────────────────────────────────────────────────────────────
// Daily summary
// ─────────────────────────────────────────────────────────────

export interface DailySummary {
  date: Date;
  total: number;
  nhs: number;
  paid: number;
  byBranch: { branchName: string; count: number }[];
  byProduct: { productName: string; count: number }[];
  gpBatchesSent: number;
  deliveryAlerts: number;
}

export function buildDailySummary(input: {
  consultations: NotifiableConsultation[];
  gpBatchesSent: number;
  deliveryAlerts: number;
  date?: Date;
}): DailySummary {
  const { consultations, gpBatchesSent, deliveryAlerts, date = new Date() } = input;

  const tally = (key: (c: NotifiableConsultation) => string | null) => {
    const counts = new Map<string, number>();
    for (const c of consultations) {
      const value = key(c);
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  };

  return {
    date,
    total: consultations.length,
    nhs: consultations.filter((c) => c.fundedBy === 'NHS').length,
    paid: consultations.filter((c) => c.fundedBy === 'Private').length,
    byBranch: tally((c) => c.branchName).map((e) => ({ branchName: e.name, count: e.count })),
    byProduct: tally((c) => c.productName).map((e) => ({ productName: e.name, count: e.count })),
    gpBatchesSent,
    deliveryAlerts,
  };
}

// ─────────────────────────────────────────────────────────────
// Prescription numbering
// ─────────────────────────────────────────────────────────────

/** e.g. ONC-2026-000147 — branch, year, sequence. */
export function formatPrescriptionNumber(
  branchCode: string,
  year: number,
  sequence: number,
): string {
  return `${branchCode.toUpperCase()}-${year}-${String(sequence).padStart(6, '0')}`;
}

export function parsePrescriptionNumber(
  value: string,
): { branchCode: string; year: number; sequence: number } | null {
  const match = value.match(/^([A-Z]{2,4})-(\d{4})-(\d{6})$/);
  if (!match) return null;
  return {
    branchCode: match[1]!,
    year: Number(match[2]),
    sequence: Number(match[3]),
  };
}
