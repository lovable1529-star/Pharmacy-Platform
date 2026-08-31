/**
 * Recording what a patient confirmed they had read.
 *
 * Same reasoning as `captureConsent`, and for the same reason. A resource is a
 * mutable row: the client edits the link, swaps the leaflet, retires it. A
 * record that merely pointed at the resource would quietly change its meaning
 * every time somebody edited a link — "the patient read this" would end up
 * naming a document that did not exist on the day they read it.
 *
 * So the title, the link and the version are copied in at the moment of
 * acknowledgement. §29.5: copy master data into completed records.
 *
 * The resource's own versioning is the other half of the guarantee. Changing a
 * title or a link supersedes the row rather than overwriting it, so the
 * pointer alongside the snapshot still resolves to something.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/lib/actions';
import { patientResource, resourceAcknowledgement } from '@/lib/db/schema';

export interface ResourceAcknowledgementCapture {
  organisationId: string;
  submissionId: string;
  patientId: string | null;
  /** The ids the patient ticked, as sent by the form. */
  acknowledgedResourceIds: string[];
}

/** A resource as the database returned it, ready to be snapshotted. */
export interface ResolvedResource {
  id: string;
  resourceKey: string;
  version: number;
  title: string;
  url: string;
}

/**
 * The ids worth looking up.
 *
 * Deduplicated because a resubmission can send the same id twice, and emptied
 * of blanks because a missing id would otherwise widen the lookup rather than
 * narrow it.
 */
export function requestedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter(Boolean);
}

/**
 * The rows to write, with every quoted field copied rather than referenced.
 *
 * Separated from the write so the guarantee that matters — that the record
 * says what the resource said THAT DAY — is testable without a database.
 */
export function acknowledgementValues(
  resolved: readonly ResolvedResource[],
  context: { organisationId: string; submissionId: string; patientId: string | null },
) {
  return resolved.map((r) => ({
    organisationId: context.organisationId,
    patientId: context.patientId,
    submissionId: context.submissionId,
    resourceId: r.id,
    resourceKeySnapshot: r.resourceKey,
    resourceVersionSnapshot: r.version,
    titleSnapshot: r.title,
    urlSnapshot: r.url,
    acknowledged: true,
  }));
}

/**
 * Write one row per resource the patient confirmed.
 *
 * Returns how many were written. Does nothing when the patient ticked nothing
 * — a repeat request that shows no leaflets has nothing to record, and writing
 * an empty row would make "acknowledgement held" untrue wherever it is counted.
 *
 * The ids arrive from the browser, so they are re-read here rather than
 * trusted: the snapshot must quote what the resource actually says, not what a
 * request claimed it said, and an id belonging to another organisation must
 * find nothing.
 */
export async function captureResourceAcknowledgements(
  tx: Tx,
  input: ResourceAcknowledgementCapture,
): Promise<number> {
  const ids = requestedIds(input.acknowledgedResourceIds);
  if (ids.length === 0) return 0;

  const rows = await tx
    .select({
      id: patientResource.id,
      resourceKey: patientResource.resourceKey,
      version: patientResource.version,
      title: patientResource.title,
      url: patientResource.url,
    })
    .from(patientResource)
    .where(and(
      inArray(patientResource.id, ids),
      eq(patientResource.organisationId, input.organisationId),
    ));

  if (rows.length === 0) return 0;

  await tx
    .insert(resourceAcknowledgement)
    .values(acknowledgementValues(rows, input))
    /*
     * A resubmission re-ticks the same leaflets. The unique index on
     * (submission, key, version) means the first acknowledgement stands and the
     * second is ignored — which is right: it is the same patient confirming the
     * same document, and the earlier timestamp is the honest one.
     */
    .onConflictDoNothing();

  return rows.length;
}
