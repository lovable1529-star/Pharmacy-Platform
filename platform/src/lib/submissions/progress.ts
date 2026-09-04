/**
 * What a patient is told about their own request.
 *
 * They submit a ten-minute health questionnaire and then hear nothing until
 * somebody telephones them. The predictable result is a phone call to the
 * pharmacy asking whether it arrived — the single most avoidable call this
 * service will generate.
 *
 * Two rules govern everything here.
 *
 * It shows STAGE, never clinical detail. Not the RAG colour, not the medicine,
 * not a rule that fired, not an answer. The page is reached by holding a link,
 * and a link can be forwarded, left open on a shared computer, or read over
 * somebody's shoulder. "We are reviewing your request" is safe in all of those
 * places; "amber — BMI between 23 and 24.9" is not.
 *
 * It never promises. A patient told "approved" who is then declined has been
 * misled by us rather than disappointed by a pharmacist, so the wording stops
 * at what has happened and says who acts next.
 */

export type ProgressStep = 'RECEIVED' | 'REVIEW' | 'DECIDED' | 'ON_ITS_WAY' | 'COMPLETE';

export const PROGRESS_ORDER: readonly ProgressStep[] = [
  'RECEIVED', 'REVIEW', 'DECIDED', 'ON_ITS_WAY', 'COMPLETE',
] as const;

export interface ProgressInput {
  /** The submission's own status. */
  status: string;
  /** Whether a prescription has been raised, and where it has got to. */
  prescriptionStatus?: string | null;
  /** Where the box has got to, if one exists. */
  fulfilmentStatus?: string | null;
  fulfilmentMethod?: string | null;
}

export interface Progress {
  step: ProgressStep;
  /** The heading, in the patient's own terms. */
  headline: string;
  /** What happens next, and who does it. */
  detail: string;
  /** True when nothing further will move — the request is closed. */
  finished: boolean;
  /** True when the pharmacy needs something from THEM. */
  needsPatient: boolean;
}

/**
 * Where a request has got to.
 *
 * Read from the furthest point reached rather than from the submission alone:
 * once a prescription exists the submission's own status stops being the most
 * interesting fact about it, and a patient whose medicine was posted this
 * morning should not be told it is "with a pharmacist".
 */
export function progressOf(input: ProgressInput): Progress {
  const fulfilment = input.fulfilmentStatus?.toUpperCase() ?? null;
  const prescription = input.prescriptionStatus?.toUpperCase() ?? null;
  const delivery = input.fulfilmentMethod?.toUpperCase() === 'DELIVERY';

  /* ── Furthest first ───────────────────────────────────────────────── */

  if (fulfilment === 'SUPPLIED' || fulfilment === 'COLLECTED') {
    return {
      step: 'COMPLETE',
      headline: 'Your medicine has been supplied',
      detail:
        'If anything about it does not seem right, contact the pharmacy before '
        + 'taking it.',
      finished: true,
      needsPatient: false,
    };
  }

  if (fulfilment === 'DISPATCHED') {
    return {
      step: 'ON_ITS_WAY',
      headline: 'Your medicine is on its way',
      detail: 'It has been posted. Keep it refrigerated as soon as it arrives.',
      finished: false,
      needsPatient: false,
    };
  }

  if (fulfilment === 'READY') {
    return {
      step: 'ON_ITS_WAY',
      headline: delivery ? 'Your medicine is ready to be posted' : 'Ready to collect',
      detail: delivery
        ? 'It goes out with the next post.'
        : 'You can collect it from the pharmacy. Bring photo ID.',
      finished: false,
      needsPatient: !delivery,
    };
  }

  if (fulfilment === 'PENDING' || fulfilment === 'ASSEMBLING' || prescription) {
    return {
      step: 'DECIDED',
      headline: 'A pharmacist has approved your request',
      detail: 'It is being prepared. We will tell you when it is on its way.',
      finished: false,
      needsPatient: false,
    };
  }

  /* ── Nothing dispensed yet, so the submission's own state governs ──── */

  switch (input.status.toUpperCase()) {
    case 'DRAFT':
      return {
        step: 'RECEIVED',
        headline: 'Your form has not been sent yet',
        detail:
          'Your answers are saved. Open the form again and finish it when you '
          + 'are ready — nothing reaches the pharmacy until you do.',
        finished: false,
        needsPatient: true,
      };

    case 'INFO_REQUESTED':
      return {
        step: 'REVIEW',
        headline: 'The pharmacy needs something from you',
        detail:
          'A pharmacist has asked for more information before they can decide. '
          + 'Check your email and phone — they will have been in touch.',
        finished: false,
        needsPatient: true,
      };

    case 'IN_REVIEW':
      return {
        step: 'REVIEW',
        headline: 'A pharmacist is reviewing your answers',
        detail: 'They will telephone you on the number you gave us.',
        finished: false,
        needsPatient: false,
      };

    case 'REJECTED':
    case 'DECLINED':
      return {
        step: 'DECIDED',
        headline: 'This request was not approved',
        detail:
          'A pharmacist has been in touch, or will be shortly, to explain why '
          + 'and to talk about what else might help.',
        finished: true,
        needsPatient: false,
      };

    case 'COMPLETED':
      return {
        step: 'COMPLETE',
        headline: 'This request is closed',
        detail: 'Contact the pharmacy if you think that is wrong.',
        finished: true,
        needsPatient: false,
      };

    default:
      // SUBMITTED, RESUBMITTED, and anything a future status adds. Erring
      // towards "received" is safe: it claims nothing that has not happened.
      return {
        step: 'RECEIVED',
        headline: 'We have your answers',
        detail:
          'A pharmacist will read them and telephone you, usually within one '
          + 'working day. There is nothing else for you to do.',
        finished: false,
        needsPatient: false,
      };
  }
}

/** The label for each step on the timeline. */
export const STEP_LABEL: Record<ProgressStep, string> = {
  RECEIVED: 'Received',
  REVIEW: 'Being reviewed',
  DECIDED: 'Decision made',
  ON_ITS_WAY: 'On its way',
  COMPLETE: 'Complete',
};

/** Has the timeline reached this step? */
export function reached(current: ProgressStep, step: ProgressStep): boolean {
  return PROGRESS_ORDER.indexOf(step) <= PROGRESS_ORDER.indexOf(current);
}
