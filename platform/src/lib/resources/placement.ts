/**
 * Where the leaflets appear on a form.
 *
 * Originally they went in one fixed place — above the signature — which was
 * right for the weight-management form and wrong as a rule. A pharmacy that
 * wants the injection guide beside the dose question and the privacy leaflet
 * beside the consent has no way to say so, and "add a link to step 3" is a
 * completely ordinary thing to want.
 *
 * So the form can now carry `resourceList` blocks, placed in the designer like
 * any other field. What each block CONTAINS still comes from the database, so
 * the pharmacy edits a leaflet without republishing a form; the schema only
 * says where the blocks sit and which resources belong in each.
 *
 * Three rules, and they are meant to be sayable in one breath each:
 *
 *   A block that names resources shows exactly those.
 *   A block that names none shows everything no other block claimed.
 *   A form with no blocks at all shows everything above the signature.
 *
 * The third is what keeps every already-published form working. Version 2 of
 * the weight-management questionnaire has no blocks in it and must keep
 * showing its leaflets.
 */

import type { FormField, FormStep } from '@/types/form-schema';

export interface PlaceableResource {
  id: string;
  resourceKey: string;
  title: string;
  description: string | null;
  url: string;
  requiresAcknowledgement: boolean;
}

/** One rendered block: the field it belongs to, and what goes in it. */
export interface ResourceBlock {
  fieldId: string;
  resources: PlaceableResource[];
}

/**
 * Which resources each block on a step should render.
 *
 * `steps` must be the VISIBLE steps with their VISIBLE fields — a block hidden
 * behind an unanswered branch is not a place a patient can read anything, and
 * treating it as one would strand a required tick somewhere unreachable.
 */
export function placeResources(
  steps: readonly { fields: readonly Pick<FormField, 'id' | 'type' | 'resourceKeys'>[] }[],
  resources: readonly PlaceableResource[],
): Map<number, ResourceBlock[]> {
  const placement = new Map<number, ResourceBlock[]>();
  if (resources.length === 0) return placement;

  const blocks: { stepIndex: number; field: Pick<FormField, 'id' | 'resourceKeys'> }[] = [];
  steps.forEach((step, stepIndex) => {
    for (const field of step.fields) {
      if (field.type === 'resourceList') blocks.push({ stepIndex, field });
    }
  });

  if (blocks.length === 0) return placement;

  /*
   * Claimed by name first, so the catch-all knows what is left. A key named by
   * two blocks appears in both — deliberately allowed, because "show the
   * safety leaflet again beside the signature" is a reasonable thing to ask
   * for and refusing it would need a rule nobody could guess.
   */
  const named = new Set<string>();
  for (const { field } of blocks) {
    for (const key of field.resourceKeys ?? []) named.add(key);
  }

  const byKey = new Map<string, PlaceableResource[]>();
  for (const r of resources) {
    const list = byKey.get(r.resourceKey) ?? [];
    list.push(r);
    byKey.set(r.resourceKey, list);
  }

  const unclaimed = resources.filter((r) => !named.has(r.resourceKey));

  for (const { stepIndex, field } of blocks) {
    const keys = field.resourceKeys ?? [];

    const contents = keys.length > 0
      // In the order the block names them, so the client controls the order
      // here as well as on the resources screen.
      ? keys.flatMap((key) => byKey.get(key) ?? [])
      : unclaimed;

    const list = placement.get(stepIndex) ?? [];
    list.push({ fieldId: field.id, resources: contents });
    placement.set(stepIndex, list);
  }

  return placement;
}

/** Does this form place its own resource blocks, or should the fallback apply? */
export function hasResourceBlocks(
  steps: readonly { fields: readonly Pick<FormField, 'type'>[] }[],
): boolean {
  return steps.some((s) => s.fields.some((f) => f.type === 'resourceList'));
}

/**
 * The step the fallback block belongs on: the one holding the signature.
 *
 * Returns -1 when the form signs somewhere the patient cannot see yet — a
 * signature behind an unanswered branch is not the same as a form that never
 * signs, and showing "before you sign, please read" above the first question
 * of a ten-step form was exactly that mistake.
 */
export function fallbackStepIndex(
  visibleSteps: readonly { fields: readonly Pick<FormField, 'type'>[] }[],
  allSteps: readonly Pick<FormStep, 'fields'>[],
): number {
  const signed = visibleSteps.findIndex((s) => s.fields.some((f) => f.type === 'signature'));
  if (signed >= 0) return signed;

  const signsAtAll = allSteps.some((s) => s.fields.some((f) => f.type === 'signature'));
  return signsAtAll ? -1 : visibleSteps.length - 1;
}

/** Every resource actually rendered somewhere, deduplicated. */
export function renderedResources(
  placement: ReadonlyMap<number, ResourceBlock[]>,
): PlaceableResource[] {
  const seen = new Map<string, PlaceableResource>();
  for (const blocks of placement.values()) {
    for (const block of blocks) {
      for (const r of block.resources) seen.set(r.id, r);
    }
  }
  return [...seen.values()];
}

/**
 * The step a patient must not leave until they have ticked something.
 *
 * A required resource gates the step it is ON, not the final submit. Leaving
 * the tick five steps behind and refusing at the end tells somebody they are
 * wrong without telling them where.
 */
export function unticked(
  blocks: readonly ResourceBlock[],
  acknowledgedIds: Iterable<string>,
): PlaceableResource[] {
  const ticked = new Set(acknowledgedIds);
  const missing = new Map<string, PlaceableResource>();

  for (const block of blocks) {
    for (const r of block.resources) {
      if (r.requiresAcknowledgement && !ticked.has(r.id)) missing.set(r.id, r);
    }
  }

  return [...missing.values()];
}
