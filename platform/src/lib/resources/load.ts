/**
 * Reading the resources that apply to one patient at one moment.
 *
 * The filtering itself is pure and lives in `applicable.ts`; this is only the
 * query. It exists so the three places that need resources — the public form,
 * the preview, and the message that goes out with a prescription — ask the
 * same question in the same way rather than each writing their own join and
 * quietly disagreeing about what "active" means.
 */

import { and, eq } from 'drizzle-orm';
import type { Reader } from '@/lib/actions';
import { patientResource } from '@/lib/db/schema';
import { applicableResources, type DisplayStage, type StageQuery } from './applicable';

export async function loadApplicableResources(
  reader: Reader,
  where: {
    organisationId: string;
    serviceId: string;
    stage: StageQuery;
    /**
     * Null where the medicine is not known — a new patient who has not been
     * prescribed anything. Medicine-specific resources are then left out
     * rather than all shown.
     */
    medicineId?: string | null;
  },
) {
  const rows = await reader
    .select({
      id: patientResource.id,
      resourceKey: patientResource.resourceKey,
      version: patientResource.version,
      title: patientResource.title,
      description: patientResource.description,
      url: patientResource.url,
      displayStage: patientResource.displayStage,
      requiresAcknowledgement: patientResource.requiresAcknowledgement,
      sortOrder: patientResource.sortOrder,
      active: patientResource.active,
      archivedAt: patientResource.archivedAt,
      medicineId: patientResource.medicineId,
    })
    .from(patientResource)
    .where(and(
      eq(patientResource.serviceId, where.serviceId),
      eq(patientResource.organisationId, where.organisationId),
    ));

  return applicableResources(
    rows.map((r) => ({ ...r, displayStage: r.displayStage as DisplayStage })),
    { stage: where.stage, medicineId: where.medicineId ?? null },
  );
}
