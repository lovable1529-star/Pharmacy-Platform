/**
 * Patient resources: which ones apply, and when a change needs a new version.
 *
 * A resource is a leaflet, a video or a link the client wants a patient to see
 * — how to inject, what to do about nausea, the needle-disposal policy. They
 * change often and they change for clinical reasons, so they live in the
 * database rather than in the questionnaire: the client edits one without a
 * deployment, and without republishing a form version and thereby splitting
 * the answer history of an unrelated question.
 *
 * That mutability is exactly why acknowledgement has to be snapshotted. This
 * module owns the two decisions that keeps honest:
 *
 *   1. which resources a given patient should be shown, and
 *   2. whether an edit changes what a past acknowledgement claimed.
 *
 * Both are pure. No database, no clock, no request.
 */

/** Where in the journey a resource is shown. */
export type DisplayStage = 'BEFORE_SUBMISSION' | 'AFTER_RX' | 'BOTH';

export const DISPLAY_STAGES: readonly DisplayStage[] = [
  'BEFORE_SUBMISSION',
  'AFTER_RX',
  'BOTH',
] as const;

/** The stage a screen is asking about. `BOTH` is an answer, never a question. */
export type StageQuery = 'BEFORE_SUBMISSION' | 'AFTER_RX';

export interface Resource {
  id: string;
  resourceKey: string;
  version: number;
  title: string;
  description: string | null;
  url: string;
  displayStage: DisplayStage;
  requiresAcknowledgement: boolean;
  sortOrder: number;
  active: boolean;
  archivedAt: Date | null;
  /** Null means it applies whatever the patient is on. */
  medicineId: string | null;
}

/**
 * Is this resource live?
 *
 * Archived and merely inactive are different states on purpose. Inactive is
 * the client switching a leaflet off for a season; archived is it being
 * retired. Neither is shown, but only one of them is expected to come back.
 */
export function isLive(r: Pick<Resource, 'active' | 'archivedAt'>): boolean {
  return r.active && r.archivedAt === null;
}

function coversStage(stage: DisplayStage, wanted: StageQuery): boolean {
  return stage === 'BOTH' || stage === wanted;
}

/**
 * The resources to show, in the order the client put them in.
 *
 * Medicine-specific resources are included only when we know the patient is on
 * that medicine. When the medicine is unknown — a new patient who has not
 * chosen yet — the medicine-specific ones are left out rather than all shown.
 * Handing somebody the injection guide for a medicine they were not prescribed
 * is not a neutral act.
 *
 * Ties on sortOrder fall back to the title so the order is stable; two
 * resources the client never ordered should not swap places between renders.
 */
export function applicableResources(
  all: readonly Resource[],
  where: { stage: StageQuery; medicineId?: string | null },
): Resource[] {
  return all
    .filter(isLive)
    .filter((r) => coversStage(r.displayStage, where.stage))
    .filter((r) => r.medicineId === null || r.medicineId === where.medicineId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

/**
 * The ones the patient must tick before they can submit.
 *
 * Only the required ones, and only the ones on this screen — a resource shown
 * after the prescription cannot block a form the patient is filling in now.
 */
export function blockingResources(shown: readonly Resource[]): Resource[] {
  return shown.filter((r) => r.requiresAcknowledgement);
}

/** Which required resources have not been ticked. Empty means clear to submit. */
export function missingAcknowledgements(
  shown: readonly Resource[],
  acknowledgedIds: Iterable<string>,
): Resource[] {
  const ticked = new Set(acknowledgedIds);
  return blockingResources(shown).filter((r) => !ticked.has(r.id));
}

/* ── Editing ──────────────────────────────────────────────────────────────── */

export interface ResourceDraft {
  title: string;
  description: string | null;
  url: string;
  displayStage: DisplayStage;
  requiresAcknowledgement: boolean;
  sortOrder: number;
  medicineId: string | null;
}

/**
 * What is wrong with this draft, in words the client can act on.
 *
 * Returned as a list rather than throwing on the first fault, so somebody who
 * has got two things wrong is told both at once instead of discovering the
 * second after fixing the first.
 */
export function resourceProblems(draft: ResourceDraft): string[] {
  const problems: string[] = [];

  if (draft.title.trim().length === 0) {
    problems.push('Give the resource a title — the patient sees this as the link text.');
  } else if (draft.title.trim().length > 120) {
    problems.push('The title is too long to read on a phone. Keep it under 120 characters.');
  }

  const url = draft.url.trim();
  if (url.length === 0) {
    problems.push('A resource needs a link.');
  } else {
    /*
     * http and https only. A resource is rendered as a link the patient taps,
     * so a javascript: or data: URL saved here would execute in their browser.
     * Anything the URL parser rejects outright is caught by the same branch.
     */
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }

    if (!parsed) {
      problems.push('That link is not a valid web address. It should start with https://');
    } else if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      problems.push('Links must be web addresses starting with https://');
    }
  }

  if (!DISPLAY_STAGES.includes(draft.displayStage)) {
    problems.push('Choose when the patient sees this.');
  }

  if (!Number.isInteger(draft.sortOrder)) {
    problems.push('The order must be a whole number.');
  }

  /*
   * A resource shown only after the prescription cannot be acknowledged on the
   * form, so requiring acknowledgement there would be a promise nothing keeps.
   */
  if (draft.displayStage === 'AFTER_RX' && draft.requiresAcknowledgement) {
    problems.push(
      'A resource shown only after the prescription cannot be a required tick — '
      + 'the patient has already submitted. Show it before submission as well, or '
      + 'make it optional.',
    );
  }

  return problems;
}

/**
 * Does this edit need a new version, or can it be changed where it stands?
 *
 * The rule is: version whatever an acknowledgement quotes. A past record says
 * "on this date, this patient agreed they had read TITLE at URL". Changing
 * either of those retrospectively rewrites what that record claims, so those
 * two changes mint a new version and leave the old row for the old
 * acknowledgements to point at.
 *
 * Everything else — the description, the order, the stage, whether a tick is
 * required, which medicine it applies to — is presentation. No acknowledgement
 * quotes it, so editing it in place changes nothing that was already claimed.
 */
export function needsNewVersion(
  current: Pick<Resource, 'title' | 'url'>,
  draft: Pick<ResourceDraft, 'title' | 'url'>,
): boolean {
  return (
    current.title.trim() !== draft.title.trim()
    || current.url.trim() !== draft.url.trim()
  );
}

/** The version number a new revision of this resource should take. */
export function nextVersion(existing: readonly Pick<Resource, 'resourceKey' | 'version'>[],
  resourceKey: string): number {
  const versions = existing
    .filter((r) => r.resourceKey === resourceKey)
    .map((r) => r.version);

  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

/**
 * A stable key from a title, used once when the resource is first created.
 *
 * The key never changes afterwards, which is the point: it is what ties
 * version 3 of the injection guide to the version 1 somebody acknowledged last
 * year, however much the wording moved in between.
 */
export function resourceKeyFrom(title: string, taken: Iterable<string> = []): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    || 'resource';

  const used = new Set(taken);
  if (!used.has(base)) return base;

  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
