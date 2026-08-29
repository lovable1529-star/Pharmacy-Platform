/**
 * Documents — §10.
 *
 * A register of what the system has produced, per patient and per category.
 * The files themselves stay in private storage or are regenerated from records
 * on demand; this is the index that makes "everything on file for this person"
 * a question with an answer.
 */

import { getStaffContext } from '@/lib/auth/context';
import { listDocuments, documentCounts, type DocumentCategory } from '@/lib/documents/register';
import { DocumentsView } from './documents-view';

export const dynamic = 'force-dynamic';

const CATEGORIES = new Set<DocumentCategory>([
  'CONSULTATION_RECORD', 'PRESCRIPTION', 'APPROVAL_RECORD',
  'REJECTION_RECORD', 'PATIENT_EVIDENCE', 'TREATMENT_REVIEW', 'VACCINATION_RECORD',
]);

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const params = await searchParams;
  const { actor } = await getStaffContext();

  const category = CATEGORIES.has(params.category as DocumentCategory)
    ? (params.category as DocumentCategory)
    : undefined;

  const LIMIT = 400;

  const [rows, counts] = await Promise.all([
    listDocuments(actor.organisationId, { category, limit: LIMIT }),
    documentCounts(actor.organisationId),
  ]);

  return (
    <DocumentsView
      rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      counts={counts}
      category={category ?? null}
      // The screen says when it is showing a capped view rather than everything.
      capped={rows.length === LIMIT}
    />
  );
}
