'use server';

/**
 * Price and public branding.
 *
 * Neither could be changed without a database script until now. The price in
 * particular was not a cosmetic gap: a service with no price stranded every
 * prescription raised from it at PENDING_PAYMENT, because there was nothing to
 * charge and so nothing ever settled it.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { action, query } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { db } from '@/lib/db/client';
import { organisation, service, servicePublicProfile } from '@/lib/db/schema';
import {
  normaliseProfile, priceProblems, publicProfileProblems,
  type PublicProfileDraft,
} from '@/lib/services/settings';

export interface ServiceSettingsView {
  serviceId: string;
  serviceName: string;
  organisationName: string;
  priceMinor: number | null;
  profile: PublicProfileDraft;
}

const EMPTY_PROFILE: PublicProfileDraft = {
  publicBrandName: '',
  primaryColour: '',
  secondaryColour: '',
  supportEmail: '',
  supportPhone: '',
  privacyUrl: '',
  termsUrl: '',
  fulfilmentName: '',
};

export async function getServiceSettings(slug: string): Promise<ServiceSettingsView | null> {
  const read = query<{ slug: string }>('services:view')
    .scopedTo(() => ({}))
    .handler(async (input, { actor }) => {
      const [svc] = await db
        .select({
          id: service.id,
          name: service.name,
          priceMinor: service.priceMinor,
          // Shown as the fallback the patient sees when no brand name is set,
          // so the screen can say what happens rather than just "optional".
          organisationName: organisation.name,
        })
        .from(service)
        .innerJoin(organisation, eq(service.organisationId, organisation.id))
        .where(and(
          eq(service.slug, input.slug),
          eq(service.organisationId, actor.organisationId),
          isNull(service.archivedAt),
        ))
        .limit(1);

      if (!svc) return null;

      const [row] = await db
        .select()
        .from(servicePublicProfile)
        .where(and(
          eq(servicePublicProfile.serviceId, svc.id),
          eq(servicePublicProfile.organisationId, actor.organisationId),
        ))
        .limit(1);

      return {
        serviceId: svc.id,
        serviceName: svc.name,
        organisationName: svc.organisationName,
        priceMinor: svc.priceMinor,
        profile: row
          ? {
            publicBrandName: row.publicBrandName ?? '',
            primaryColour: row.primaryColour ?? '',
            secondaryColour: row.secondaryColour ?? '',
            supportEmail: row.supportEmail ?? '',
            supportPhone: row.supportPhone ?? '',
            privacyUrl: row.privacyUrl ?? '',
            termsUrl: row.termsUrl ?? '',
            fulfilmentName: row.fulfilmentName ?? '',
          }
          : EMPTY_PROFILE,
      } satisfies ServiceSettingsView;
    });

  try {
    return await read({ slug });
  } catch (error) {
    console.error('getServiceSettings failed', error);
    return null;
  }
}

function failure(error: unknown, fallback: string) {
  console.error(fallback, error);
  return {
    ok: false as const,
    error:
      error instanceof Error && error.name === 'AuthorisationError'
        ? 'Changing service settings needs services access.'
        : error instanceof Error
          ? error.message
          : fallback,
  };
}

export interface SetPriceInput {
  serviceId: string;
  /** Pence. Null means the service has no price. */
  priceMinor: number | null;
}

/**
 * Set what a service costs.
 *
 * The price is read when a prescription is raised and copied onto the payment
 * then, so changing it here never re-prices anything already issued. That is
 * the behaviour you want: a patient quoted £190 in March does not owe a
 * different amount because somebody edited a field in June.
 */
const setPrice = action<SetPriceInput>('services:edit').handler(
  async (input, { tx, actor }) => {
    const problems = priceProblems(input.priceMinor);
    if (problems.length > 0) throw new Error(problems.join(' '));

    const [row] = await tx
      .select({ id: service.id, name: service.name, priceMinor: service.priceMinor })
      .from(service)
      .where(and(
        eq(service.id, input.serviceId),
        eq(service.organisationId, actor.organisationId),
        isNull(service.archivedAt),
      ))
      .limit(1);

    if (!row) throw new Error('That service no longer exists.');

    await tx
      .update(service)
      .set({ priceMinor: input.priceMinor })
      .where(and(
        eq(service.id, input.serviceId),
        eq(service.organisationId, actor.organisationId),
      ));

    return {
      result: { name: row.name, priceMinor: input.priceMinor },
      audit: {
        action: 'service.price_changed',
        entityType: 'service',
        entityId: row.id,
        before: { priceMinor: row.priceMinor },
        after: { priceMinor: input.priceMinor },
      },
    };
  },
);

export async function setServicePrice(input: SetPriceInput) {
  try {
    const result = await setPrice(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, 'Could not save that price.');
  }
}

export interface SetProfileInput extends PublicProfileDraft {
  serviceId: string;
}

/**
 * Set how the service looks to a patient.
 *
 * Upserted by hand because the table carries no unique constraint on service
 * id — one profile per service is expected but not enforced, and inventing a
 * constraint here would mean a migration for a settings screen.
 */
const setProfile = action<SetProfileInput>('services:edit').handler(
  async (input, { tx, actor }) => {
    const { serviceId, ...draft } = input;

    const problems = publicProfileProblems(draft);
    if (problems.length > 0) throw new Error(problems.join(' '));

    const [svc] = await tx
      .select({ id: service.id })
      .from(service)
      .where(and(
        eq(service.id, serviceId),
        eq(service.organisationId, actor.organisationId),
        isNull(service.archivedAt),
      ))
      .limit(1);

    if (!svc) throw new Error('That service no longer exists.');

    const stored = normaliseProfile(draft);

    const [existing] = await tx
      .select({ id: servicePublicProfile.id })
      .from(servicePublicProfile)
      .where(and(
        eq(servicePublicProfile.serviceId, serviceId),
        eq(servicePublicProfile.organisationId, actor.organisationId),
      ))
      .limit(1);

    if (existing) {
      await tx
        .update(servicePublicProfile)
        .set({ ...stored, active: true, updatedBy: actor.userId, updatedAt: new Date() })
        .where(and(
          eq(servicePublicProfile.id, existing.id),
          eq(servicePublicProfile.organisationId, actor.organisationId),
        ));
    } else {
      await tx.insert(servicePublicProfile).values({
        organisationId: actor.organisationId,
        serviceId,
        ...stored,
        updatedBy: actor.userId,
      });
    }

    return {
      result: { saved: true },
      audit: {
        action: 'service.public_profile_changed',
        entityType: 'service',
        entityId: serviceId,
        after: stored,
      },
    };
  },
);

export async function setServiceProfile(input: SetProfileInput) {
  try {
    const result = await setProfile(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, 'Could not save those settings.');
  }
}
