'use server';

/**
 * The reference entities the system depends on and could not create.
 *
 * Pharmacists, products and branches were all stored, displayed, and required
 * by other records — with no way to add one. That is the gap that reads as
 * unfinished rather than unlucky: a pharmacy that takes on a new pharmacist, or
 * stocks this year's vaccine, or opens a third shop, had to ring a developer.
 *
 * Everything here archives rather than deletes. A consultation names the
 * pharmacist who performed it and the batch that was administered; deleting
 * either would leave a vaccination record that cannot say who gave what.
 */

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { branch, clinician, product } from '@/lib/db/schema';

function settingsError(error: unknown, what: string): string {
  if (error instanceof Error) {
    if (error.name === 'AuthorisationError') {
      return `You do not have permission to change ${what}.`;
    }
    // A duplicate branch code or GPhC number arrives as a constraint violation.
    // The raw Postgres text is not something to put in front of a pharmacist.
    if (/duplicate key|unique constraint/i.test(error.message)) {
      return 'That already exists — check the list before adding it again.';
    }
    return error.message;
  }
  return 'Something went wrong.';
}

// ─────────────────────────────────────────────────────────────
// Pharmacists
//
// He listed six by name with their GPhC numbers, and that list changes as staff
// join, leave and register. A consultation records who performed it, so a
// pharmacist who cannot be added cannot work in the system at all.
// ─────────────────────────────────────────────────────────────

export interface ClinicianInput {
  id: string | null;
  fullName: string;
  gphcNumber: string;
}

const saveClinicianAction = action<ClinicianInput>('settings:edit').handler(
  async (input, { tx, actor }) => {
    const fullName = input.fullName.trim();
    const gphcNumber = input.gphcNumber.trim();

    if (input.id) {
      const [updated] = await tx
        .update(clinician)
        .set({ fullName, gphcNumber })
        .where(
          and(
            eq(clinician.id, input.id),
            eq(clinician.organisationId, actor.organisationId),
          ),
        )
        .returning({ id: clinician.id });

      if (!updated) throw new Error('That pharmacist no longer exists.');

      return {
        result: { id: updated.id },
        audit: {
          action: 'clinician.updated',
          entityType: 'clinician',
          entityId: updated.id,
          after: { fullName, gphcNumber },
        },
      };
    }

    const [created] = await tx
      .insert(clinician)
      .values({
        organisationId: actor.organisationId,
        fullName,
        gphcNumber,
      })
      .returning({ id: clinician.id });

    if (!created) throw new Error('Could not add that pharmacist.');

    return {
      result: { id: created.id },
      audit: {
        action: 'clinician.created',
        entityType: 'clinician',
        entityId: created.id,
        after: { fullName, gphcNumber },
      },
    };
  },
);

export async function saveClinician(input: ClinicianInput) {
  if (!input.fullName.trim()) {
    return { ok: false as const, error: 'Give the pharmacist a full name.' };
  }
  // GPhC registration numbers are seven digits. Checking the shape catches a
  // transposed or truncated number now, rather than on a GP report months on.
  if (!/^\d{7}$/.test(input.gphcNumber.trim())) {
    return { ok: false as const, error: 'A GPhC number is seven digits.' };
  }

  try {
    await saveClinicianAction(input);
    revalidatePath('/settings');
    return { ok: true as const };
  } catch (error) {
    console.error('saveClinician failed', error);
    return { ok: false as const, error: settingsError(error, 'pharmacists') };
  }
}

const archiveClinicianAction = action<{ id: string }>('settings:edit').handler(
  async (input, { tx, actor }) => {
    const [archived] = await tx
      .update(clinician)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(clinician.id, input.id),
          eq(clinician.organisationId, actor.organisationId),
        ),
      )
      .returning({ id: clinician.id, fullName: clinician.fullName });

    if (!archived) throw new Error('That pharmacist no longer exists.');

    return {
      result: { id: archived.id },
      audit: {
        action: 'clinician.archived',
        entityType: 'clinician',
        entityId: archived.id,
        before: { fullName: archived.fullName },
      },
    };
  },
);

export async function archiveClinician(id: string) {
  try {
    await archiveClinicianAction({ id });
    revalidatePath('/settings');
    return { ok: true as const };
  } catch (error) {
    console.error('archiveClinician failed', error);
    return { ok: false as const, error: settingsError(error, 'pharmacists') };
  }
}

// ─────────────────────────────────────────────────────────────
// Products
//
// His list runs well past flu — Covid, Hep A and B, Shingrix, Varilrix, Ixiaro,
// Revaxis, Typhim, Vivotif — and he wrote "more types of vaccines to add in due
// course". Batches were addable; the product they belong to was not.
// ─────────────────────────────────────────────────────────────

export interface ProductInput {
  id: string | null;
  name: string;
  category: string | null;
  /**
   * What this product contains that someone can react to — egg, latex,
   * gentamicin, neomycin. This is not descriptive metadata: the safety check
   * matches it against the patient's declared allergies, so a vaccine added
   * with an empty list is a vaccine that will never trigger a warning.
   */
  allergens: string[];
}

const saveProductAction = action<ProductInput>('inventory:edit').handler(
  async (input, { tx, actor }) => {
    const values = {
      name: input.name.trim(),
      category: input.category?.trim() || null,
      allergens: input.allergens
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a.length > 0),
    };

    if (input.id) {
      const [updated] = await tx
        .update(product)
        .set(values)
        .where(
          and(
            eq(product.id, input.id),
            eq(product.organisationId, actor.organisationId),
          ),
        )
        .returning({ id: product.id });

      if (!updated) throw new Error('That product no longer exists.');

      return {
        result: { id: updated.id },
        audit: {
          action: 'product.updated',
          entityType: 'product',
          entityId: updated.id,
          after: values,
        },
      };
    }

    const [created] = await tx
      .insert(product)
      .values({ organisationId: actor.organisationId, ...values })
      .returning({ id: product.id });

    if (!created) throw new Error('Could not add that product.');

    return {
      result: { id: created.id },
      audit: {
        action: 'product.created',
        entityType: 'product',
        entityId: created.id,
        after: values,
      },
    };
  },
);

export async function saveProduct(input: ProductInput) {
  if (!input.name.trim()) {
    return { ok: false as const, error: 'Give the product a name.' };
  }

  try {
    await saveProductAction(input);
    revalidatePath('/settings');
    revalidatePath('/inventory');
    return { ok: true as const };
  } catch (error) {
    console.error('saveProduct failed', error);
    return { ok: false as const, error: settingsError(error, 'stock') };
  }
}

// ─────────────────────────────────────────────────────────────
// Branches
//
// The four-level tenancy is the centre of the multi-site story, and a group
// that cannot open a third shop without a developer does not really have one.
// ─────────────────────────────────────────────────────────────

export interface BranchInput {
  id: string | null;
  companyId: string;
  name: string;
  code: string;
  phone: string | null;
  inboxEmail: string | null;
  addressLine1: string | null;
  town: string | null;
  postcode: string | null;
}

const saveBranchAction = action<BranchInput>('settings:edit')
  .scopedTo((input) => ({ companyId: input.companyId }))
  .handler(async (input, { tx, actor }) => {
    const values = {
      name: input.name.trim(),
      // The code prefixes every appointment reference (ONC-3JBX4), so it is
      // normalised here rather than taken however it was typed.
      code: input.code.trim().toUpperCase(),
      phone: input.phone?.trim() || null,
      inboxEmail: input.inboxEmail?.trim() || null,
      addressLine1: input.addressLine1?.trim() || null,
      town: input.town?.trim() || null,
      postcode: input.postcode?.trim().toUpperCase() || null,
    };

    if (input.id) {
      const [updated] = await tx
        .update(branch)
        .set(values)
        .where(
          and(
            eq(branch.id, input.id),
            eq(branch.organisationId, actor.organisationId),
          ),
        )
        .returning({ id: branch.id });

      if (!updated) throw new Error('That branch no longer exists.');

      return {
        result: { id: updated.id },
        audit: {
          action: 'branch.updated',
          entityType: 'branch',
          entityId: updated.id,
          after: values,
        },
      };
    }

    const [created] = await tx
      .insert(branch)
      .values({
        organisationId: actor.organisationId,
        companyId: input.companyId,
        ...values,
      })
      .returning({ id: branch.id });

    if (!created) throw new Error('Could not add that branch.');

    return {
      result: { id: created.id },
      audit: {
        action: 'branch.created',
        entityType: 'branch',
        entityId: created.id,
        after: values,
      },
    };
  });

export async function saveBranch(input: BranchInput) {
  if (!input.name.trim()) {
    return { ok: false as const, error: 'Give the branch a name.' };
  }
  if (!/^[A-Za-z]{2,5}$/.test(input.code.trim())) {
    return {
      ok: false as const,
      error: 'The branch code is 2–5 letters — it prefixes every appointment reference.',
    };
  }
  if (!input.companyId) {
    return { ok: false as const, error: 'Choose which company operates this branch.' };
  }

  try {
    await saveBranchAction(input);
    revalidatePath('/settings');
    revalidatePath('/appointments');
    return { ok: true as const };
  } catch (error) {
    console.error('saveBranch failed', error);
    return { ok: false as const, error: settingsError(error, 'branches') };
  }
}
