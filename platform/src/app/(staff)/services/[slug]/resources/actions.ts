'use server';

/**
 * Editing the material a patient is shown.
 *
 * The exit criterion for this screen is that the client can change a leaflet
 * without a deployment, so everything here writes to `patient_resource` rather
 * than to a form version. Changing a resource must not republish a
 * questionnaire — that would split the answer history of every unrelated
 * question on it.
 *
 * Two behaviours are worth knowing before reading the code:
 *
 *   Saving may create a row rather than update one. Title and link are what an
 *   acknowledgement quotes, so changing either supersedes the resource with a
 *   new version and leaves the old row in place for the old acknowledgements
 *   to point at. Everything else edits where it stands.
 *
 *   Removing is archiving. A patient acknowledged this link on a date; the
 *   record of that has to keep resolving.
 */

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { action, query } from '@/lib/actions';
import { revalidateStaffViews } from '@/lib/cache/revalidate';
import { db } from '@/lib/db/client';
import { medicine, patientResource, service } from '@/lib/db/schema';
import {
  needsNewVersion,
  nextVersion,
  resourceKeyFrom,
  resourceProblems,
  type DisplayStage,
  type Resource,
  type ResourceDraft,
} from '@/lib/resources/applicable';

export interface ResourceRow extends Resource {
  medicineBrand: string | null;
  /** True when a later version of the same key exists. */
  superseded: boolean;
}

export interface ResourcesView {
  serviceId: string;
  serviceName: string;
  resources: ResourceRow[];
  medicines: { id: string; brand: string }[];
}

/**
 * Everything the screen needs, including superseded versions.
 *
 * Old versions are listed rather than hidden. They are what past
 * acknowledgements point at, and somebody asking "what did this patient
 * actually agree to in June" needs to be able to see it.
 */
export async function getServiceResources(slug: string): Promise<ResourcesView | null> {
  const read = query<{ slug: string }>('services:view')
    .scopedTo(() => ({}))
    .handler(async (input, { actor }) => {
      const [svc] = await db
        .select({ id: service.id, name: service.name })
        .from(service)
        .where(and(
          eq(service.slug, input.slug),
          eq(service.organisationId, actor.organisationId),
          isNull(service.archivedAt),
        ))
        .limit(1);

      if (!svc) return null;

      const [rows, meds] = await Promise.all([
        db
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
            medicineBrand: medicine.brand,
          })
          .from(patientResource)
          .leftJoin(medicine, eq(patientResource.medicineId, medicine.id))
          .where(and(
            eq(patientResource.serviceId, svc.id),
            eq(patientResource.organisationId, actor.organisationId),
          ))
          .orderBy(asc(patientResource.sortOrder), desc(patientResource.version)),

        db
          .select({ id: medicine.id, brand: medicine.brand })
          .from(medicine)
          .where(and(
            eq(medicine.organisationId, actor.organisationId),
            eq(medicine.active, true),
          ))
          .orderBy(asc(medicine.brand)),
      ]);

      /* The highest version of each key is the live one; the rest are history. */
      const highest = new Map<string, number>();
      for (const r of rows) {
        highest.set(r.resourceKey, Math.max(highest.get(r.resourceKey) ?? 0, r.version));
      }

      return {
        serviceId: svc.id,
        serviceName: svc.name,
        medicines: meds,
        resources: rows.map((r) => ({
          ...r,
          displayStage: r.displayStage as DisplayStage,
          superseded: r.version < (highest.get(r.resourceKey) ?? r.version),
        })),
      } satisfies ResourcesView;
    });

  try {
    return await read({ slug });
  } catch (error) {
    console.error('getServiceResources failed', error);
    return null;
  }
}

/**
 * Turn a thrown action into something the screen can render.
 *
 * The action wrapper throws; the client needs a value. Authorisation is
 * translated because "Forbidden" tells somebody nothing they can act on.
 */
function failure(error: unknown, fallback: string) {
  console.error(fallback, error);
  return {
    ok: false as const,
    error:
      error instanceof Error && error.name === 'AuthorisationError'
        ? 'Changing patient resources needs services access.'
        : error instanceof Error
          ? error.message
          : fallback,
  };
}

export interface SaveResourceInput extends ResourceDraft {
  serviceId: string;
  /** Omitted when adding. */
  resourceId?: string;
}

const save = action<SaveResourceInput>('services:edit').handler(
  async (input, { tx, actor }) => {
    const draft: ResourceDraft = {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      url: input.url.trim(),
      displayStage: input.displayStage,
      requiresAcknowledgement: input.requiresAcknowledgement,
      sortOrder: input.sortOrder,
      medicineId: input.medicineId || null,
    };

    const problems = resourceProblems(draft);
    if (problems.length > 0) throw new Error(problems.join(' '));

    const [svc] = await tx
      .select({ id: service.id })
      .from(service)
      .where(and(
        eq(service.id, input.serviceId),
        eq(service.organisationId, actor.organisationId),
        isNull(service.archivedAt),
      ))
      .limit(1);

    if (!svc) throw new Error('That service no longer exists.');

    /*
     * A medicine chosen from the dropdown still gets checked against the
     * organisation. The dropdown is not the authority on what this actor may
     * point a resource at.
     */
    if (draft.medicineId) {
      const [med] = await tx
        .select({ id: medicine.id })
        .from(medicine)
        .where(and(
          eq(medicine.id, draft.medicineId),
          eq(medicine.organisationId, actor.organisationId),
        ))
        .limit(1);

      if (!med) throw new Error('That medicine is not on this organisation.');
    }

    const siblings = await tx
      .select({
        id: patientResource.id,
        resourceKey: patientResource.resourceKey,
        version: patientResource.version,
        title: patientResource.title,
        url: patientResource.url,
      })
      .from(patientResource)
      .where(and(
        eq(patientResource.serviceId, input.serviceId),
        eq(patientResource.organisationId, actor.organisationId),
      ));

    /* ── Adding ─────────────────────────────────────────────────────────── */
    if (!input.resourceId) {
      const key = resourceKeyFrom(draft.title, siblings.map((s) => s.resourceKey));

      const [created] = await tx
        .insert(patientResource)
        .values({
          organisationId: actor.organisationId,
          serviceId: input.serviceId,
          medicineId: draft.medicineId,
          resourceKey: key,
          version: 1,
          title: draft.title,
          description: draft.description,
          url: draft.url,
          displayStage: draft.displayStage,
          requiresAcknowledgement: draft.requiresAcknowledgement,
          sortOrder: draft.sortOrder,
          createdBy: actor.userId,
        })
        .returning({ id: patientResource.id });

      return {
        result: { id: created!.id, versioned: false, version: 1 },
        audit: {
          action: 'resource.created',
          entityType: 'patient_resource',
          entityId: created!.id,
          after: { resourceKey: key, version: 1, title: draft.title, url: draft.url },
        },
      };
    }

    /* ── Editing ────────────────────────────────────────────────────────── */
    const current = siblings.find((s) => s.id === input.resourceId);
    if (!current) throw new Error('That resource no longer exists.');

    if (needsNewVersion(current, draft)) {
      /*
       * Supersede rather than overwrite. The old row stays exactly as it was,
       * because an acknowledgement written last month says the patient read
       * THAT title at THAT link, and editing the row in place would silently
       * change what that record claims.
       *
       * The old version is deactivated, not archived: it should stop being
       * shown to new patients, but it is not retired — it is superseded.
       */
      const version = nextVersion(siblings, current.resourceKey);

      const [created] = await tx
        .insert(patientResource)
        .values({
          organisationId: actor.organisationId,
          serviceId: input.serviceId,
          medicineId: draft.medicineId,
          resourceKey: current.resourceKey,
          version,
          title: draft.title,
          description: draft.description,
          url: draft.url,
          displayStage: draft.displayStage,
          requiresAcknowledgement: draft.requiresAcknowledgement,
          sortOrder: draft.sortOrder,
          createdBy: actor.userId,
        })
        .returning({ id: patientResource.id });

      await tx
        .update(patientResource)
        .set({ active: false })
        .where(and(
          eq(patientResource.id, current.id),
          eq(patientResource.organisationId, actor.organisationId),
        ));

      return {
        result: { id: created!.id, versioned: true, version },
        audit: {
          action: 'resource.versioned',
          entityType: 'patient_resource',
          entityId: created!.id,
          before: { title: current.title, url: current.url, version: current.version },
          after: { title: draft.title, url: draft.url, version },
        },
      };
    }

    /* Presentation only. Nothing already claimed quotes any of this. */
    await tx
      .update(patientResource)
      .set({
        description: draft.description,
        displayStage: draft.displayStage,
        requiresAcknowledgement: draft.requiresAcknowledgement,
        sortOrder: draft.sortOrder,
        medicineId: draft.medicineId,
      })
      .where(and(
        eq(patientResource.id, current.id),
        eq(patientResource.organisationId, actor.organisationId),
      ));

    return {
      result: { id: current.id, versioned: false, version: current.version },
      audit: {
        action: 'resource.updated',
        entityType: 'patient_resource',
        entityId: current.id,
        after: {
          displayStage: draft.displayStage,
          requiresAcknowledgement: draft.requiresAcknowledgement,
          sortOrder: draft.sortOrder,
          medicineId: draft.medicineId,
        },
      },
    };
  },
);

export async function saveResource(input: SaveResourceInput) {
  try {
    const result = await save(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, 'Could not save that resource.');
  }
}

export interface SetResourceActiveInput {
  resourceId: string;
  active: boolean;
}

/** Switch a resource off for a season without retiring it. */
const setActive = action<SetResourceActiveInput>('services:edit').handler(
  async (input, { tx, actor }) => {
    const [row] = await tx
      .select({ id: patientResource.id, title: patientResource.title })
      .from(patientResource)
      .where(and(
        eq(patientResource.id, input.resourceId),
        eq(patientResource.organisationId, actor.organisationId),
      ))
      .limit(1);

    if (!row) throw new Error('That resource no longer exists.');

    await tx
      .update(patientResource)
      .set({ active: input.active })
      .where(and(
        eq(patientResource.id, input.resourceId),
        eq(patientResource.organisationId, actor.organisationId),
      ));

    return {
      result: { title: row.title, active: input.active },
      audit: {
        action: input.active ? 'resource.enabled' : 'resource.disabled',
        entityType: 'patient_resource',
        entityId: row.id,
        after: { active: input.active },
      },
    };
  },
);

export async function setResourceActive(input: SetResourceActiveInput) {
  try {
    const result = await setActive(input);
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, 'Could not change that resource.');
  }
}

/**
 * Retire a resource.
 *
 * Archived, not deleted, and guarded by services:delete rather than
 * services:edit — for the same reason withdrawing a service is. Past
 * acknowledgements carry their own snapshot of the title and link, so they
 * stay readable either way; the row is kept so the acknowledgement's pointer
 * back to it still resolves.
 */
const archive = action<{ resourceId: string }>('services:delete').handler(
  async (input, { tx, actor }) => {
    const [row] = await tx
      .select({
        id: patientResource.id,
        title: patientResource.title,
        archivedAt: patientResource.archivedAt,
      })
      .from(patientResource)
      .where(and(
        eq(patientResource.id, input.resourceId),
        eq(patientResource.organisationId, actor.organisationId),
      ))
      .limit(1);

    if (!row) throw new Error('That resource no longer exists.');

    // Clicking twice should leave one archived resource and no complaint.
    if (row.archivedAt) {
      return {
        result: { title: row.title, alreadyArchived: true },
        audit: {
          action: 'resource.archive_noop',
          entityType: 'patient_resource',
          entityId: row.id,
          after: { archivedAt: row.archivedAt },
        },
      };
    }

    await tx
      .update(patientResource)
      .set({ archivedAt: new Date(), active: false })
      .where(and(
        eq(patientResource.id, input.resourceId),
        eq(patientResource.organisationId, actor.organisationId),
        isNull(patientResource.archivedAt),
      ));

    return {
      result: { title: row.title, alreadyArchived: false },
      audit: {
        action: 'resource.archived',
        entityType: 'patient_resource',
        entityId: row.id,
        after: { archived: true },
      },
    };
  },
);

export async function archiveResource(resourceId: string) {
  try {
    const result = await archive({ resourceId });
    revalidateStaffViews();
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, 'Could not retire that resource.');
  }
}
