/**
 * The document register — §10.
 *
 * Files already lived in private storage. What did not exist was a list of what
 * has been produced, in what category, for whom — so "everything on file for
 * this patient" meant sweeping a bucket and guessing from object keys.
 *
 * Registering is separate from storing on purpose. A document may be a stored
 * file (a signed consent, an uploaded photo) or something the system can
 * regenerate on demand from records that cannot change (a prescription, a
 * vaccination record). Both belong in the register; only the first has bytes
 * sitting somewhere.
 *
 * Never fails the caller. A prescription that was issued but whose register row
 * did not get written is a bookkeeping problem; a prescription that failed to
 * issue because bookkeeping failed is a clinical one.
 */

import { and, count, desc, eq } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import { db } from '@/lib/db/client';
import { document, patient } from '@/lib/db/schema';

export type DocumentCategory =
  | 'CONSULTATION_RECORD' | 'PRESCRIPTION' | 'APPROVAL_RECORD'
  | 'REJECTION_RECORD' | 'PATIENT_EVIDENCE' | 'TREATMENT_REVIEW'
  | 'VACCINATION_RECORD';

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  CONSULTATION_RECORD: 'Consultation record',
  PRESCRIPTION: 'Prescription',
  APPROVAL_RECORD: 'Approval record',
  REJECTION_RECORD: 'Rejection record',
  PATIENT_EVIDENCE: 'Patient evidence',
  TREATMENT_REVIEW: 'Treatment review',
  VACCINATION_RECORD: 'Vaccination record',
};

export interface RegisterInput {
  organisationId: string;
  category: DocumentCategory;
  title: string;
  /**
   * Object key in the private bucket, or a route that regenerates the document
   * from records. Never a public URL — §16.2.
   */
  storagePath: string;
  patientId?: string | null;
  submissionId?: string | null;
  consultationId?: string | null;
  prescriptionId?: string | null;
  appointmentId?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdBy?: string | null;
}

/**
 * Add a document to the register.
 *
 * Swallows its own failure deliberately — see the note at the top of the file.
 * The error is logged so a missing row is diagnosable, not invisible.
 */
export async function registerDocument(tx: Tx, input: RegisterInput): Promise<void> {
  try {
    await tx.insert(document).values({
      organisationId: input.organisationId,
      category: input.category,
      title: input.title,
      storagePath: input.storagePath,
      patientId: input.patientId ?? null,
      submissionId: input.submissionId ?? null,
      consultationId: input.consultationId ?? null,
      prescriptionId: input.prescriptionId ?? null,
      appointmentId: input.appointmentId ?? null,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      createdBy: input.createdBy ?? null,
    });
  } catch (error) {
    console.error('registerDocument failed', { title: input.title, error });
  }
}

export interface DocumentRow {
  id: string;
  category: DocumentCategory;
  title: string;
  storagePath: string;
  patientId: string | null;
  patientName: string | null;
  mimeType: string | null;
  createdAt: Date;
}

/**
 * The register, newest first.
 *
 * Capped, and the screen says so. A register that silently showed the first
 * five hundred of two thousand would be the same defect the reports had.
 */
export async function listDocuments(
  organisationId: string,
  options: { patientId?: string; category?: DocumentCategory; limit?: number } = {},
): Promise<DocumentRow[]> {
  const filters = [eq(document.organisationId, organisationId)];
  if (options.patientId) filters.push(eq(document.patientId, options.patientId));
  if (options.category) filters.push(eq(document.category, options.category));

  const rows = await db
    .select({
      id: document.id,
      category: document.category,
      title: document.title,
      storagePath: document.storagePath,
      patientId: document.patientId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      mimeType: document.mimeType,
      createdAt: document.createdAt,
    })
    .from(document)
    .leftJoin(patient, eq(document.patientId, patient.id))
    .where(and(...filters))
    .orderBy(desc(document.createdAt))
    .limit(options.limit ?? 400);

  return rows.map((r) => ({
    id: r.id,
    category: r.category as DocumentCategory,
    title: r.title,
    storagePath: r.storagePath,
    patientId: r.patientId,
    patientName: r.firstName && r.lastName ? `${r.firstName} ${r.lastName}` : null,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
  }));
}

/** How many of each kind exist, for the filter chips. Counted by the database. */
export async function documentCounts(
  organisationId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ category: document.category, total: count() })
    .from(document)
    .where(eq(document.organisationId, organisationId))
    .groupBy(document.category);

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.category] = row.total;
  return counts;
}
