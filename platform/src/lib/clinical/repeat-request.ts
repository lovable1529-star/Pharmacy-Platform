/**
 * Repeat request logic: what a patient may ask for, and what we suggest.
 *
 * Three things from the specification live here because all three are decided
 * before the decision engine ever runs, and two of them are the patient's own
 * screen rather than a triage outcome.
 *
 *   §4.3  the dose dropdown offers only the same strength or one step either
 *         way, so an impossible request cannot be made in the first place
 *   §4.3  a read-only System Recommendation is shown BEFORE the patient
 *         chooses, so they are choosing against advice rather than in a vacuum
 *   §5.5  holiday supply, which the earlier scope of work never covered
 *
 * Pure functions, no database, so they can be tested against the specification
 * tables directly and reused by the internal pharmacy form (§6.5) without
 * dragging a request context along.
 */

import { DOSE_LADDERS, type DoseLadders } from './derived';

export type DoseDirection = 'same' | 'increase' | 'decrease';
export type Recommendation = DoseDirection | 'book';

// ─────────────────────────────────────────────────────────────
// What may be requested
// ─────────────────────────────────────────────────────────────

export interface DoseOption {
  value: string;
  label: string;
  direction: DoseDirection;
}

/**
 * The strengths a patient on `currentValue` may request.
 *
 * §4.3 limits this to the same strength or one step. Constraining the OPTIONS
 * rather than only rejecting a bad answer afterwards matters: a patient who is
 * offered 15mg and then told they cannot have it has been given a worse
 * experience than one who was never offered it, and the rule is not a clinical
 * judgement about them — it is a property of the ladder.
 *
 * The RED rule still exists and still fires, because this list is a
 * convenience and the safety check must not depend on the browser having
 * honoured it.
 */
export function allowedDoseOptions(
  currentValue: string | null,
  ladders: DoseLadders = DOSE_LADDERS,
): DoseOption[] {
  if (!currentValue || !currentValue.includes('_')) return [];

  const [brandKey, strength] = currentValue.split('_');
  if (!brandKey || !strength) return [];

  const brand = brandKey.charAt(0).toUpperCase() + brandKey.slice(1);
  const ladder = ladders[brand];
  if (!ladder) return [];

  const index = ladder.indexOf(strength);
  if (index === -1) return [];

  const options: DoseOption[] = [];

  if (index > 0) {
    const down = ladder[index - 1]!;
    options.push({
      value: `${brandKey}_${down}`,
      label: `${brand} ${down} — one step down`,
      direction: 'decrease',
    });
  }

  options.push({
    value: currentValue,
    label: `${brand} ${strength} — stay the same`,
    direction: 'same',
  });

  if (index < ladder.length - 1) {
    const up = ladder[index + 1]!;
    options.push({
      value: `${brandKey}_${up}`,
      label: `${brand} ${up} — one step up`,
      direction: 'increase',
    });
  }

  return options;
}

// ─────────────────────────────────────────────────────────────
// What we suggest
// ─────────────────────────────────────────────────────────────

export interface RecommendationInput {
  appetiteSuppression?: string | null;
  snacking?: string | null;
  adverseEffects?: string | null;
  weightLossPercent?: number | null;
  bmi?: number | null;
  missedDoses?: number | null;
  pregnancy?: string | null;
  weeksOnDose?: number | null;
}

export interface RecommendationResult {
  recommendation: Recommendation;
  /** Shown to the patient. Never phrased as an instruction. */
  reason: string;
}

const POOR_SUPPRESSION = new Set(['wearing_off', 'poor']);
const HEAVY_SNACKING = new Set(['daily', 'frequent']);
const GOOD_SUPPRESSION = new Set(['full', 'mostly']);
const LIGHT_SNACKING = new Set(['controlled', 'occasional']);

/**
 * The read-only suggestion shown before the patient chooses — §4.3.
 *
 * Deliberately NOT the triage outcome. This answers "what does the picture
 * suggest?"; the engine answers "is this safe to supply automatically?". They
 * usually agree, and where they do not it is because the engine knows about
 * things the suggestion has no business commenting on.
 *
 * "Book an appointment" wins outright wherever it applies, because a
 * suggestion to change dose sitting next to a safety block would read as
 * permission.
 */
export function systemRecommendation(input: RecommendationInput): RecommendationResult {
  // Absolutes first — anything below is a judgement, and a judgement must never
  // be able to outweigh one of these.
  if (input.pregnancy === 'yes') {
    return {
      recommendation: 'book',
      reason: 'Please speak to a pharmacist before your next supply.',
    };
  }

  if (input.adverseEffects === 'severe') {
    return {
      recommendation: 'book',
      reason: 'The side effects you have described need to be discussed with a pharmacist.',
    };
  }

  if ((input.missedDoses ?? 0) >= 2) {
    return {
      recommendation: 'book',
      reason: 'You have missed two or more doses, so a pharmacist should review your treatment.',
    };
  }

  if (input.bmi != null && input.bmi < 23) {
    return {
      recommendation: 'decrease',
      reason: 'You have reached a healthy weight. A lower strength may now be appropriate.',
    };
  }

  if (input.adverseEffects === 'moderate') {
    return {
      recommendation: 'decrease',
      reason: 'A lower strength may make the side effects easier to manage.',
    };
  }

  const suppression = String(input.appetiteSuppression ?? '');
  const snacking = String(input.snacking ?? '');

  if (POOR_SUPPRESSION.has(suppression) || HEAVY_SNACKING.has(snacking)) {
    // §5.3 — a step up needs three weeks on the current dose first.
    if ((input.weeksOnDose ?? 0) < 3) {
      return {
        recommendation: 'same',
        reason: 'It is a little early to change strength. Staying the same for now is usually best.',
      };
    }
    return {
      recommendation: 'increase',
      reason: 'Your appetite is not being controlled as well as it could be. A higher strength may help.',
    };
  }

  if (
    GOOD_SUPPRESSION.has(suppression)
    && LIGHT_SNACKING.has(snacking)
    && (input.weightLossPercent ?? 0) >= 2
  ) {
    return {
      recommendation: 'same',
      reason: 'Things are going well. Staying on the same strength is usually the right choice.',
    };
  }

  return {
    recommendation: 'same',
    reason: 'Staying on the same strength is usually the right choice while things settle.',
  };
}

// ─────────────────────────────────────────────────────────────
// Holiday supply — §5.5
// ─────────────────────────────────────────────────────────────

export type Outcome = 'GREEN' | 'AMBER' | 'RED';

export interface HolidaySupplyRequest {
  /** Is this an early or extra supply for travel? */
  isHoliday: boolean;
  /** Months requested — 1, 2 or more. */
  months: number;
  /** Are they asking to change strength at the same time? */
  changingStrength: boolean;
  /** Two different strengths in one request, which §5.5 blocks outright. */
  twoStrengths: boolean;
  weeksOnCurrentStrength: number | null;
}

export interface HolidaySupplyResult {
  outcome: Outcome | null;
  message: string | null;
}

/**
 * The three cases §5.5 sets out, and nothing else.
 *
 * Returns a null outcome when this is not a holiday request, so the caller can
 * fall through to the ordinary supply rules rather than having holiday logic
 * silently applied to every request.
 */
export function assessHolidaySupply(request: HolidaySupplyRequest): HolidaySupplyResult {
  if (!request.isHoliday) return { outcome: null, message: null };

  // Worst first: two strengths across a long supply is a stockpile, whatever
  // else is true about it.
  if (request.twoStrengths && request.months >= 2) {
    return {
      outcome: 'RED',
      message: 'Two months or more covering two different strengths cannot be supplied without seeing a pharmacist.',
    };
  }

  if (request.changingStrength && request.months >= 2) {
    return {
      outcome: 'AMBER',
      message: 'Changing strength and asking for two months at once needs a pharmacist to review.',
    };
  }

  if (
    !request.changingStrength
    && request.weeksOnCurrentStrength != null
    && request.weeksOnCurrentStrength >= 4
  ) {
    return {
      outcome: 'GREEN',
      message: 'Early or extra supply of the same strength, on a stable dose.',
    };
  }

  return {
    outcome: 'AMBER',
    message: 'Holiday supply outside the usual pattern — a pharmacist will review this.',
  };
}
