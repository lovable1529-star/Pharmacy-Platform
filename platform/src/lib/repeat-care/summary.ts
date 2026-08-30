/**
 * The one line that answers "can I approve this without opening it?"
 *
 * A repeat request is a judgement about a trend: what they were on, what they
 * are asking for, how the weight has moved, how long they have been on the
 * dose. All four were already computed and stored — and none of them were on
 * the queue row, so a pharmacist had to open every single request to find out
 * whether it was routine.
 *
 * ── Why none of this is coloured ──────────────────────────────────────────
 *
 * These are facts, deliberately presented without judgement. The temptation is
 * to turn "−1.2%" amber because his rules use a 2% threshold — but that
 * threshold lives in the published ruleset, where the pharmacy can change it,
 * and a second copy of it here would disagree with the first the day anybody
 * edits it. The outcome chip is the judgement; this is the evidence behind it.
 */

export interface RequestFacts {
  /** `Mounjaro 5mg → 7.5mg`, or `Mounjaro 5mg` when nothing is changing. */
  dose: string | null;
  /** `−4.2% since last supply`. Signed, because a gain matters as much as a loss. */
  weightChange: string | null;
  /** `5 weeks on dose`. */
  timeOnDose: string | null;
}

export interface FactsInput {
  /** The submission's stored `derived` block. */
  derived: Record<string, unknown>;
  /** The submission's answers, for the strength being requested. */
  answers: Record<string, unknown>;
  /** Medicine and strength as the enrolment holds them — what they are on now. */
  previous: { medicine: string | null; strength: string | null };
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The strength inside an option value like `mounjaro_7.5mg`.
 *
 * Split leniently and NOT validated against a ladder, because this is display
 * only. A strength that has drifted off the ladder should be shown as it is —
 * the rules already skip it, and hiding it would leave the row looking normal
 * while the dose-step check silently did not run.
 */
export function strengthOf(medicineValue: unknown): string | null {
  const value = str(medicineValue);
  if (!value || !value.includes('_')) return null;
  return str(value.slice(value.indexOf('_') + 1));
}

/** Title case, so `mounjaro` reads as `Mounjaro` next to a strength. */
function titled(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function requestFacts(input: FactsInput): RequestFacts {
  const { derived, answers, previous } = input;

  // The medicine name: from the derivation where it validated, otherwise from
  // the enrolment. Either is the same medicine; only the casing differs.
  const medicine = str(derived.medicine) ?? (previous.medicine ? titled(previous.medicine) : null);

  const from = str(previous.strength) ?? str(derived.strength);
  const to = strengthOf(answers.requestedMedicine);

  let dose: string | null = null;
  if (medicine && from && to && from !== to) {
    dose = `${medicine} ${from} → ${to}`;
  } else if (medicine && (from ?? to)) {
    dose = `${medicine} ${from ?? to}`;
  } else if (medicine) {
    dose = medicine;
  }

  const percent = num(derived.weightLossPercent);
  /*
   * The sign is flipped on purpose. `weightLossPercent` is positive when weight
   * has been LOST, which is the opposite of how a change is normally written —
   * so a 4.2% loss reads as −4.2%, the way it would on a chart.
   */
  const weightChange =
    percent === null
      ? null
      : `${percent > 0 ? '−' : percent < 0 ? '+' : ''}${Math.abs(percent).toFixed(1)}% since last supply`;

  const weeks = num(derived.weeksOnDose);
  const timeOnDose =
    weeks === null ? null : `${weeks} ${weeks === 1 ? 'week' : 'weeks'} on dose`;

  return { dose, weightChange, timeOnDose };
}

/**
 * How long this has been sitting there.
 *
 * A queue exists to show what is ageing, and `27 Aug 2026, 23:33` does not do
 * that at a glance — the reader has to know today's date and do the subtraction.
 * Days up to a fortnight, then weeks, because past that the precision is noise
 * and the point is simply "too long".
 */
export function waitingFor(submittedAt: Date | null, now: Date = new Date()): string | null {
  if (!submittedAt) return null;

  const ms = now.getTime() - submittedAt.getTime();
  // A clock skew or a request submitted moments ago both read as "today"
  // rather than as a negative age.
  if (ms < 0) return 'waiting today';

  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'waiting today';
  if (days === 1) return 'waiting 1 day';
  if (days < 14) return `waiting ${days} days`;

  const weeks = Math.floor(days / 7);
  return `waiting ${weeks} weeks`;
}

/**
 * Fields that could carry a message TO the pharmacy, as opposed to an answer
 * about the patient.
 *
 * Matched on id because ids are stable by design — relabelling a question in
 * the designer never changes one — so this survives the pharmacy rewording its
 * own form, which it does often.
 */
const QUESTION_FIELDS = [
  'questionsForPharmacist', 'questions', 'patientQuestion',
  'notesForPharmacist', 'anythingElse',
  /*
   * Where the prose actually is. `anythingElse` is a yes/no on both weight
   * management forms and the text sits in the field it reveals - so checking
   * only the yes/no both counted every "no" as a question AND missed every
   * patient who had genuinely written something.
   */
  'anythingElseDetail', 'priorSideEffectsDetail',
];

/**
 * Answers that mean "nothing to add".
 *
 * `anythingElse` is a yes/no question on the current GLP-1 form, so every
 * patient who answered "no" was being counted as having asked something: the
 * queue read "2 asked" on three requests, none of which carried a question.
 * A badge whose job is "the counter must raise this" is worse than useless
 * when it is usually wrong — it gets ignored, including on the one that counts.
 */
const NOTHING_TO_ADD = new Set([
  'no', 'none', 'nope', 'nothing', 'n/a', 'na', 'nil', '-', '',
]);

/**
 * Does this request carry something a human wrote for the pharmacy? — §6.4
 *
 * `freeTextIds` narrows it to fields that can actually hold a message. Pass the
 * ids of the questionnaire's free-text fields where the schema is available;
 * omit it and every candidate field is considered, which is the old behaviour
 * minus the yes/no false positives.
 */
export function hasQuestionFor(
  answers: Record<string, unknown>,
  freeTextIds?: ReadonlySet<string>,
): boolean {
  return QUESTION_FIELDS.some((key) => {
    if (freeTextIds && !freeTextIds.has(key)) return false;
    const value = answers[key];
    if (typeof value !== 'string') return false;
    return !NOTHING_TO_ADD.has(value.trim().toLowerCase());
  });
}

/** Ids of fields a patient can type prose into, read off a questionnaire. */
export function freeTextFieldIds(schema: {
  steps: { fields: { id: string; type: string }[] }[];
}): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: unknown): void => {
    if (Array.isArray(nodes)) { nodes.forEach(walk); return; }
    if (nodes && typeof nodes === 'object') {
      const node = nodes as { id?: unknown; type?: unknown };
      if (typeof node.id === 'string' && (node.type === 'longText' || node.type === 'shortText')) {
        ids.add(node.id);
      }
      Object.values(nodes).forEach(walk);
    }
  };
  walk(schema.steps);
  return ids;
}
