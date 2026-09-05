/**
 * What must be true before a repeat request can be authorised.
 *
 * ── What changed, and why it matters ─────────────────────────────────────
 *
 * The README said "GREEN auto-approves", and that is no longer the model. The
 * client's newest workflow is explicit: GREEN may be fast-tracked but it still
 * requires the legally required prescriber authorisation. A rules engine can
 * say a request looks routine; it cannot prescribe.
 *
 * So the three bands now mean three different amounts of human work, not
 * "none, some, and stop":
 *
 *   GREEN  a compact authorisation. No telephone call required — the client is
 *          explicit that a routine repeat should not need one.
 *   AMBER  a documented assessment. The pharmacist must record WHY they are
 *          content, and a contact where they made one.
 *   RED    a safety stop. It cannot reach payment or a prescription at all.
 *
 * Pure and tested, and called by the server action rather than trusted to a
 * disabled button.
 */

import { verifiedCall, type VerificationCall } from '@/lib/clinical/new-patient-gate';

export type RepeatOutcome = 'GREEN' | 'AMBER' | 'RED' | null;

export interface RepeatAuthorisation {
  outcome: RepeatOutcome;
  /** Whether the patient holds an ACTIVE enrolment for this service. */
  enrolmentStatus: string | null;
  /** The pharmacist's own reasoning. Required to override an AMBER. */
  note: string;
  /** Contacts recorded against this request, if any. */
  calls: VerificationCall[];
  /**
   * Whether the measurements the engine judged this on could have come from a
   * person.
   *
   * Optional, defaulting to true, so a caller that does not know is unchanged.
   */
  measurementsUsable?: boolean;
}

/**
 * Everything standing between this request and an authorisation.
 *
 * Empty means it can be authorised. Every blocker is returned at once, so a
 * pharmacist is not told about them one at a time.
 */
export function repeatAuthorisationBlockers(input: RepeatAuthorisation): string[] {
  const blockers: string[] = [];

  /*
   * RED is a stop, not a strongly worded amber. The client's workflow puts it
   * plainly: RED cannot proceed to payment. Overriding it is not a note away.
   */
  if (input.outcome === 'RED') {
    blockers.push(
      'This request was stopped on safety grounds and cannot be supplied from here. '
      + 'Deal with it through the urgent list, or decline it with a reason.',
    );
  }

  /*
   * Repeat supply is a privilege a pharmacist granted. Someone whose enrolment
   * was paused must be seen before the next supply — that is the entire point
   * of pausing rather than deleting it.
   */
  if (input.enrolmentStatus === null) {
    blockers.push(
      'This patient is not enrolled in repeat care, so a repeat cannot be authorised. '
      + 'They need the new-patient pathway.',
    );
  } else if (input.enrolmentStatus !== 'ACTIVE') {
    blockers.push(
      `Their repeat care enrolment is ${input.enrolmentStatus.toLowerCase()}. `
      + 'It must be active again before a repeat is supplied.',
    );
  }

  /*
   * An AMBER means the engine could not satisfy itself. Approving one without
   * writing down why is exactly the gap the old system left — his
   * specification is explicit that a pharmacist must document why an amber was
   * approved.
   *
   * A recorded contact is not a substitute for the reasoning, but its absence
   * is not a blocker either: some ambers are resolved by reading, not ringing.
   */
  if (input.outcome === 'AMBER' && input.note.trim().length === 0) {
    blockers.push(
      'This request was flagged for review. Record why you are content to supply it.',
    );
  }

  /*
   * A colour computed from measurements that cannot be real is not a colour.
   *
   * A height typed in metres used to produce a BMI near 290,000, which did not
   * trip a safety rule — it cleared the eligibility floor and came back GREEN.
   * `calculateBmi` now refuses figures like that, so the BMI rules skip; but
   * skipping is not enough on its own, because an unrelated green rule (good
   * fluid intake, say) still matches and the request is still GREEN. Verified
   * against the live ruleset, not assumed.
   *
   * So the gate refuses it here. This is the last thing between a colour and a
   * supply, and it is the right place to say "whatever the engine concluded, it
   * was working from a number nobody could weigh".
   */
  if (input.measurementsUsable === false) {
    blockers.push(
      'The height or weight on this request could not be read as a real measurement, '
      + 'so the BMI checks did not run. Confirm the figures with the patient and '
      + 'record what you checked.',
    );
  }

  /*
   * No evaluation at all is not a quiet GREEN. It means no ruleset ran, so the
   * pharmacist's own reading is the only check — and they should say what they
   * checked.
   */
  if (input.outcome === null && input.note.trim().length === 0) {
    blockers.push(
      'Nothing triaged this request, so no safety checks ran. Record what you checked.',
    );
  }

  return blockers;
}

/**
 * Whether a telephone call is required before authorising.
 *
 * Never, for a repeat. The client's stated aim is to reduce human input except
 * where safety needs it, and a routine repeat is precisely where it does not.
 * Kept as a named function rather than an absence so the rule is findable, and
 * so a later change is a change to one line.
 */
export function repeatNeedsCall(): boolean {
  return false;
}

/** Whether a contact has been recorded, for display beside an AMBER. */
export function repeatHasContact(calls: VerificationCall[]): boolean {
  return verifiedCall(calls) !== null || calls.some((c) => c.outcome === 'COMPLETED');
}
