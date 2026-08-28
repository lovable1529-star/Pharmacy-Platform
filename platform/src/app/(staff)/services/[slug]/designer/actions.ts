'use server';

/**
 * Publishing a form version.
 *
 * Never edits the live version — it inserts a new one and repoints the service.
 * A patient halfway through the old version finishes on the old version, and
 * everything already answered stays bound to the version it was answered
 * against.
 *
 * Goes through the scoped action wrapper, so it is permission-checked and
 * audited like every other mutation.
 */

import { eq, desc } from 'drizzle-orm';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { action } from '@/lib/actions';
import { formVersion, service } from '@/lib/db/schema';
import type { FormSchema } from '@/types/form-schema';

const publish = action<{ serviceId: string; schema: FormSchema }>('services:edit').handler(
  async (input, { tx, actor }) => {
    const [existing] = await tx
      .select({ version: formVersion.version })
      .from(formVersion)
      .where(eq(formVersion.serviceId, input.serviceId))
      .orderBy(desc(formVersion.version))
      .limit(1);

    const nextVersion = (existing?.version ?? 0) + 1;

    const [created] = await tx
      .insert(formVersion)
      .values({
        organisationId: actor.organisationId,
        serviceId: input.serviceId,
        version: nextVersion,
        schema: input.schema as unknown as Record<string, unknown>,
        publishedAt: new Date(),
        publishedBy: actor.userId,
      })
      .returning();

    if (!created) throw new Error('Could not create the new version.');

    await tx
      .update(service)
      .set({ publishedFormVersionId: created.id })
      .where(eq(service.id, input.serviceId));

    return {
      result: { versionId: created.id, version: nextVersion },
      audit: {
        action: 'form.published',
        entityType: 'form_version',
        entityId: created.id,
        after: { serviceId: input.serviceId, version: nextVersion },
      },
    };
  },
);

export async function publishFormVersion(serviceId: string, schema: FormSchema) {
  try {
    const result = await publish({ serviceId, schema });
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('publishFormVersion failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error && error.name === 'AuthorisationError'
          ? 'You do not have permission to publish services.'
          : 'Could not publish this version. Please try again.',
    };
  }
}
