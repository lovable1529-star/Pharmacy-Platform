/**
 * Document categories — the client-safe half of the register.
 *
 * Separate from `register.ts` because that imports the database client, and a
 * client component importing a VALUE from it (rather than a type, which is
 * erased) drags `postgres` into the browser bundle. The build says so plainly:
 * "Can't resolve 'net'".
 *
 * Types and constants live here; anything that touches the database stays in
 * `register.ts`.
 */

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

export const DOCUMENT_CATEGORIES = Object.keys(CATEGORY_LABELS) as DocumentCategory[];
