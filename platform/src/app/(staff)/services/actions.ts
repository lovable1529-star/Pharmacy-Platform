'use server';

/**
 * Creating a service by duplicating one.
 *
 * Starting from scratch is the wrong default. Adding COVID vaccination means
 * taking the flu form, changing a handful of questions and publishing — and the
 * fourteen other vaccines on his list are all the same shape. Duplicating
 * carries the consent wording and pharmacist declarations across too, which are
 * the parts nobody wants to retype.
 *
 * The copy is published immediately as version 1 of its own service. It is a
 * separate service from that moment: editing it never touches the original.
 */

import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { service, formVersion, rulesetVersion } from '@/lib/db/schema';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

interface DuplicateInput {
  sourceServiceId: string;
  name: string;
  copyRules: boolean;
}

const duplicate = action<DuplicateInput>('services:edit').handler(
  async (input, { tx, actor }) => {
    const [source] = await tx
      .select()
      .from(service)
      .where(
        and(
          eq(service.id, input.sourceServiceId),
          eq(service.organisationId, actor.organisationId),
        ),
      )
      .limit(1);

    if (!source) throw new Error('That service no longer exists.');

    const slug = slugify(input.name);

    const [existing] = await tx
      .select({ id: service.id })
      .from(service)
      .where(and(eq(service.organisationId, actor.organisationId), eq(service.slug, slug)))
      .limit(1);

    if (existing) {
      throw new Error(`A service with the address /f/${slug} already exists. Choose another name.`);
    }

    const [created] = await tx
      .insert(service)
      .values({
        organisationId: actor.organisationId,
        name: input.name.trim(),
        slug,
        kind: source.kind,
        description: source.description,
        priceMinor: source.priceMinor,
        branchIds: source.branchIds,
      })
      .returning();

    if (!created) throw new Error('Could not create the service.');

    // Copy the published form as version 1 of the new service.
    if (source.publishedFormVersionId) {
      const [sourceForm] = await tx
        .select({ schema: formVersion.schema })
        .from(formVersion)
        .where(eq(formVersion.id, source.publishedFormVersionId))
        .limit(1);

      if (sourceForm) {
        const schema = sourceForm.schema as Record<string, unknown>;

        const [copiedForm] = await tx
          .insert(formVersion)
          .values({
            organisationId: actor.organisationId,
            serviceId: created.id,
            version: 1,
            schema: { ...schema, title: input.name.trim() },
            publishedAt: new Date(),
            publishedBy: actor.userId,
          })
          .returning();

        if (copiedForm) {
          await tx
            .update(service)
            .set({ publishedFormVersionId: copiedForm.id })
            .where(eq(service.id, created.id));
        }
      }
    }

    if (input.copyRules && source.publishedRulesetVersionId) {
      const [sourceRules] = await tx
        .select({ definition: rulesetVersion.definition })
        .from(rulesetVersion)
        .where(eq(rulesetVersion.id, source.publishedRulesetVersionId))
        .limit(1);

      if (sourceRules) {
        const [copiedRules] = await tx
          .insert(rulesetVersion)
          .values({
            organisationId: actor.organisationId,
            serviceId: created.id,
            version: 1,
            definition: sourceRules.definition,
            publishedAt: new Date(),
            publishedBy: actor.userId,
          })
          .returning();

        if (copiedRules) {
          await tx
            .update(service)
            .set({ publishedRulesetVersionId: copiedRules.id })
            .where(eq(service.id, created.id));
        }
      }
    }

    return {
      result: { id: created.id, slug: created.slug },
      audit: {
        action: 'service.created',
        entityType: 'service',
        entityId: created.id,
        after: { name: created.name, slug: created.slug, copiedFrom: source.slug },
      },
    };
  },
);

export async function duplicateService(input: DuplicateInput) {
  if (!input.name.trim()) {
    return { ok: false as const, error: 'Give the new service a name.' };
  }
  if (!slugify(input.name)) {
    return { ok: false as const, error: 'That name needs at least one letter or number.' };
  }

  try {
    const result = await duplicate(input);
    revalidatePath('/services');
    return { ok: true as const, ...result };
  } catch (error) {
    console.error('duplicateService failed', error);
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.name === 'AuthorisationError'
            ? 'You do not have permission to create services.'
            : error.message
          : 'Could not create that service.',
    };
  }
}
