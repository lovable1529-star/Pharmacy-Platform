/**
 * Service Designer route.
 *
 * Loads the current published form and hands it to the designer as a starting
 * draft. Publishing writes a NEW version — the published one is immutable, both
 * by convention and by a database trigger.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { service, formVersion, patientResource } from '@/lib/db/schema';
import { getStaffContext } from '@/lib/auth/context';
import type { FormSchema } from '@/types/form-schema';
import { DesignerClient } from './designer-client';

export const dynamic = 'force-dynamic';

export default async function DesignerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const rows = await db
    .select({
      serviceId: service.id,
      serviceName: service.name,
      schema: formVersion.schema,
      version: formVersion.version,
    })
    .from(service)
    .innerJoin(formVersion, eq(service.publishedFormVersionId, formVersion.id))
    .where(eq(service.slug, slug))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();

  const { actor } = await getStaffContext();

  /*
   * The leaflets a "Links and leaflets" block can choose between.
   *
   * Titles and keys only. The designer decides WHICH appear WHERE; the wording,
   * the link and whether it must be ticked belong to the resource itself, which
   * is what lets a leaflet change without republishing every form using it.
   *
   * Live ones only — offering a retired leaflet would let somebody build a
   * block that renders nothing.
   */
  const resources = await db
    .select({
      id: patientResource.id,
      resourceKey: patientResource.resourceKey,
      title: patientResource.title,
      description: patientResource.description,
      url: patientResource.url,
      requiresAcknowledgement: patientResource.requiresAcknowledgement,
    })
    .from(patientResource)
    .where(and(
      eq(patientResource.serviceId, row.serviceId),
      eq(patientResource.organisationId, actor.organisationId),
      eq(patientResource.active, true),
      isNull(patientResource.archivedAt),
    ))
    .orderBy(asc(patientResource.sortOrder), asc(patientResource.title));

  return (
    <DesignerClient
      serviceId={row.serviceId}
      serviceName={row.serviceName}
      currentVersion={row.version}
      slug={slug}
      schema={row.schema as unknown as FormSchema}
      resources={resources}
    />
  );
}
