/**
 * Turning a stored answer into something a person can read.
 *
 * There were two of these — one in the consultation review screen, one in the
 * PDF builder — and they had drifted apart in ways that mattered:
 *
 *   · the review printed `[object Object] cm` for every measurement, because it
 *     interpolated the `raw` CONTAINER instead of the numbers inside it;
 *   · the PDF printed the SI value, so a patient who entered 12 stone read
 *     back "76.2";
 *   · neither computed a derived value, so BMI was a dash on the review screen,
 *     on the printed record, and in the GP's copy — while being shown correctly
 *     on the form the patient had just filled in.
 *
 * One implementation, used by both. A second renderer is how the first two
 * disagreed, and a clinical record and the document made from it disagreeing
 * about a patient's weight is not a cosmetic problem.
 */

import { calculateBmi } from '@/lib/units';
import { ageInYears } from '@/lib/clinical/derived';
import type { Answers, FormField } from '@/types/form-schema';

/** What a measurement answer looks like once `MeasurementInput` has stored it. */
interface MeasurementValue {
  si: number | null;
  unit: string;
  raw: Record<string, number | ''>;
}

function isMeasurement(value: Record<string, unknown>): boolean {
  return 'unit' in value && 'raw' in value;
}

/**
 * The SI number behind a measurement answer, for arithmetic rather than display.
 *
 * Every measurement is stored as `{ si, unit, raw }`, so reading one with
 * `Number(answers.weight)` yields NaN. There were two identical private copies
 * of this — in the submit path and in the amend path — and a third was about to
 * be written for the enrolment baseline. Three private copies of "how do you
 * read a weight" is how the units drift apart.
 *
 * Returns null rather than 0 for a missing value: a baseline weight of zero
 * would be read by the rules engine as a real measurement.
 */
export function siValue(answers: Answers, key: string): number | null {
  const value = answers[key];
  if (typeof value === 'object' && value !== null && 'si' in value) {
    const si = (value as { si: unknown }).si;
    return typeof si === 'number' ? si : null;
  }
  return typeof value === 'number' ? value : null;
}

/**
 * A measurement in the units the patient chose, not the units we store.
 *
 * Storage is always SI so the rules engine has one number to compare. Reading
 * it back in SI is a different claim from the one the patient made: somebody
 * who typed 12 stone 4 has not asserted "78.0 kg", and showing that back makes
 * the record look altered.
 */
export function formatMeasurement(value: MeasurementValue): string {
  const { unit, raw, si } = value;
  const n = (key: string): number | null => {
    const v = raw?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  if (unit === 'st_lb') {
    const stones = n('stones');
    const pounds = n('pounds');
    if (stones !== null || pounds !== null) {
      return [
        stones !== null ? `${stones} st` : null,
        pounds !== null ? `${pounds} lb` : null,
      ].filter(Boolean).join(' ');
    }
  }

  if (unit === 'ft_in') {
    const feet = n('feet');
    const inches = n('inches');
    if (feet !== null || inches !== null) {
      return [
        feet !== null ? `${feet} ft` : null,
        inches !== null ? `${inches} in` : null,
      ].filter(Boolean).join(' ');
    }
  }

  const single = n('value');
  if (single !== null) return `${single} ${unit}`;

  // Nothing usable in `raw` — fall back to the stored SI rather than a dash,
  // because an answer that exists should not read as unanswered.
  if (typeof si === 'number' && Number.isFinite(si)) {
    return unit === 'kg' || unit === 'st_lb' ? `${si} kg` : `${si} cm`;
  }

  return '—';
}

/**
 * A calculated field's value, worked out the way the patient's own form does.
 *
 * These are never stored: `DerivedValue` computes them at render time from the
 * answers around them. Everything downstream therefore saw nothing at all,
 * which is why BMI printed as a dash on a weight-management prescription.
 */
export function derivedValue(field: FormField, answers: Answers): string | null {
  const si = (key: string | undefined): number | null => {
    if (!key) return null;
    const raw = answers[key] as { si?: number | null } | undefined;
    return typeof raw?.si === 'number' ? raw.si : null;
  };

  if (field.calculation === 'bmi') {
    const [weightKey, heightKey] = field.calculationInputs ?? [];
    const weight = si(weightKey);
    const height = si(heightKey);
    if (weight === null || height === null) return null;
    const bmi = calculateBmi(weight, height);
    return bmi === null ? null : String(bmi);
  }

  if (field.calculation === 'age') {
    const [dobKey] = field.calculationInputs ?? [];
    const dob = dobKey ? answers[dobKey] : null;
    if (typeof dob !== 'string' || !dob) return null;
    const years = ageInYears(dob);
    return years === null ? null : `${years}`;
  }

  return null;
}

/** True for answers that are a picture rather than text. */
export function isImageAnswer(field: FormField, value: unknown): boolean {
  if (field.type === 'signature') return typeof value === 'string' && value.startsWith('data:image');
  return false;
}

export interface PresentOptions {
  /** Rendered instead of an empty answer. */
  empty?: string;
}

/**
 * One answer, as a string.
 *
 * Images are NOT handled here — a signature is a picture, and flattening it to
 * `data:image/png;base64,iVBOR…` is what the review screen was doing. Callers
 * that can draw an image should check `isImageAnswer` first; this returns a
 * short placeholder for them rather than three kilobytes of base64.
 */
export function presentAnswer(
  field: FormField,
  value: unknown,
  answers: Answers = {},
  options: PresentOptions = {},
): string {
  const empty = options.empty ?? '—';

  // Calculated fields hold no answer of their own.
  if (field.type === 'derived') return derivedValue(field, answers) ?? empty;

  if (value === null || value === undefined || value === '') return empty;

  if (field.type === 'signature') {
    return typeof value === 'string' && value.startsWith('data:image') ? 'Signed' : empty;
  }

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (Array.isArray(value)) {
    if (value.length === 0) return empty;
    return value
      .map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v))
      .join(', ');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    // An uploaded file: its name is the useful part, not its storage path.
    if (typeof record.name === 'string' && typeof record.path === 'string') {
      return record.name;
    }

    if (isMeasurement(record)) return formatMeasurement(record as unknown as MeasurementValue);

    const address = ['addressLine1', 'town', 'postcode']
      .map((k) => record[k])
      .filter((v) => typeof v === 'string' && v.trim());
    if (address.length) return address.join(', ');

    // Better than "[object Object]", and rare enough to be worth seeing.
    return JSON.stringify(value);
  }

  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  if (value === 'na') return 'N/A';

  return field.options?.find((o) => o.value === value)?.label ?? String(value);
}
