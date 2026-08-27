/**
 * Service Designer route.
 *
 * Loads the current published form and hands it to the designer as a starting
 * draft. Publishing writes a NEW version — the published one is immutable, both
 * by convention and by a database trigger.
 */

import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db/client';
import { service, formVersion } from '@/lib/db/schema';
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

  return (
    <DesignerClient
      serviceId={row.serviceId}
      serviceName={row.serviceName}
      currentVersion={row.version}
      schema={row.schema as unknown as FormSchema}
    />
  );
}
