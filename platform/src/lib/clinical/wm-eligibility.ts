/**
 * Which route a new Weight Management patient is on, and whether they meet the
 * criterion the client gave for it.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * It does not stop anybody. The client supplied the route criteria but has not
 * yet said what happens to somebody who falls outside them — refuse at the
 * form, or accept and let a pharmacist decide. Those are very different
 * products and it is not our call, so this reports and the staff queue shows
 * it. Nobody is silently passed as eligible, which is the part that matters.
 *
 * ── Why it is not in the rules engine ────────────────────────────────────
 *
 * The rules engine triages a submitted request against a published ruleset,
 * and the NEW service has none. This runs earlier and answers a different
 * question: which set of questions applies, and does the patient clear the
 * threshold for it. Once the client settles the policy, this becomes the input
 * to a rule rather than a replacement for one.
 */

import { calculateBmi } from '@/lib/units';

export type OnboardingRoute = 'new-treatment' | 'transfer' | 'unknown';

export interface EligibilityAssessment {
  route: OnboardingRoute;
  bmi: number | null;
  /**
   * True when the client's stated criterion for this route is met, false when
   * it is not, and null when it cannot be judged — either because a value is
   * missing or because the client has not specified a rule for this case.
   *
   * Null is not a pass. It is the difference between "this is fine" and "we do
   * not know", and collapsing the two is how an ineligible patient slips
   * through looking approved.
   */
  meetsRouteCriterion: boolean | null;
  /** Set on the transfer route when BMI falls in the 20–<25 band. */
  needsVerifiedContinuation: boolean;
  /** Plain sentences for the staff queue. Written to be read, not parsed. */
  reasons: string[];
}

/** The client's threshold for somebody starting treatment for the first time. */
export const NEW_TREATMENT_BMI = 30;
/** The lower threshold, which needs a weight-related condition alongside it. */
export const NEW_TREATMENT_BMI_WITH_COMORBIDITY = 27;
/** The transfer band that may only proceed as a verified continuation. */
export const CONTINUATION_BMI_MIN = 20;
export const CONTINUATION_BMI_MAX = 25;

interface Answers {
  [key: string]: unknown;
}

function si(answers: Answers, key: string): number | null {
  const value = answers[key];
  if (typeof value === 'object' && value !== null && 'si' in value) {
    const raw = (value as { si: unknown }).si;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Did they tick a weight-related condition?
 *
 * "None of the above" is an answer, not an absence — a patient who ticked it
 * has told us there is no comorbidity, and must not clear the lower threshold.
 */
export function hasWeightRelatedCondition(answers: Answers): boolean {
  const value = answers.weightConditions;
  if (!Array.isArray(value)) return false;
  return value.some((v) => typeof v === 'string' && v !== 'none' && v.trim() !== '');
}

export function readRoute(answers: Answers): OnboardingRoute {
  const answer = answers.otherClinic;
  if (answer === 'yes' || answer === true) return 'transfer';
  if (answer === 'no' || answer === false) return 'new-treatment';
  return 'unknown';
}

export function assessEligibility(answers: Answers): EligibilityAssessment {
  const route = readRoute(answers);
  const heightCm = si(answers, 'height');
  const weightKg = si(answers, 'weight');
  const bmi = heightCm !== null && weightKg !== null ? calculateBmi(weightKg, heightCm) : null;

  const reasons: string[] = [];

  if (route === 'unknown') {
    reasons.push('They have not said whether they are already being treated elsewhere.');
    return { route, bmi, meetsRouteCriterion: null, needsVerifiedContinuation: false, reasons };
  }

  if (bmi === null) {
    reasons.push('BMI could not be calculated — height or weight is missing.');
    return { route, bmi, meetsRouteCriterion: null, needsVerifiedContinuation: false, reasons };
  }

  const rounded = Math.round(bmi * 10) / 10;

  if (route === 'new-treatment') {
    if (bmi >= NEW_TREATMENT_BMI) {
      reasons.push(`BMI ${rounded} is at or above ${NEW_TREATMENT_BMI}.`);
      return { route, bmi, meetsRouteCriterion: true, needsVerifiedContinuation: false, reasons };
    }

    if (bmi >= NEW_TREATMENT_BMI_WITH_COMORBIDITY) {
      if (hasWeightRelatedCondition(answers)) {
        reasons.push(
          `BMI ${rounded} is at or above ${NEW_TREATMENT_BMI_WITH_COMORBIDITY}, `
          + 'and a weight-related condition was reported.',
        );
        return { route, bmi, meetsRouteCriterion: true, needsVerifiedContinuation: false, reasons };
      }
      reasons.push(
        `BMI ${rounded} is below ${NEW_TREATMENT_BMI} and no weight-related condition was `
        + 'reported, so the lower threshold does not apply.',
      );
      return { route, bmi, meetsRouteCriterion: false, needsVerifiedContinuation: false, reasons };
    }

    reasons.push(`BMI ${rounded} is below ${NEW_TREATMENT_BMI_WITH_COMORBIDITY}.`);
    return { route, bmi, meetsRouteCriterion: false, needsVerifiedContinuation: false, reasons };
  }

  // ── Transfer / continuation ───────────────────────────────────────────
  if (bmi >= CONTINUATION_BMI_MIN && bmi < CONTINUATION_BMI_MAX) {
    reasons.push(
      `BMI ${rounded} is in the ${CONTINUATION_BMI_MIN}–${CONTINUATION_BMI_MAX} band, so this `
      + 'may only proceed as a verified continuation of their existing treatment.',
    );
    return { route, bmi, meetsRouteCriterion: null, needsVerifiedContinuation: true, reasons };
  }

  if (bmi < CONTINUATION_BMI_MIN) {
    /*
     * Deliberately null rather than false. The client gave a rule for 20–<25
     * and said nothing about below 20, and inventing a refusal is as wrong as
     * inventing a pass.
     */
    reasons.push(
      `BMI ${rounded} is below ${CONTINUATION_BMI_MIN}. No rule has been supplied for transfers `
      + 'in this range — a pharmacist must decide.',
    );
    return { route, bmi, meetsRouteCriterion: null, needsVerifiedContinuation: true, reasons };
  }

  reasons.push(`BMI ${rounded} is at or above ${CONTINUATION_BMI_MAX}.`);
  return { route, bmi, meetsRouteCriterion: true, needsVerifiedContinuation: false, reasons };
}

/** True when the patient chose to be seen face to face and left this pathway. */
export function choseFaceToFace(answers: Answers): boolean {
  return answers.pathwayChoice === 'in_person';
}
