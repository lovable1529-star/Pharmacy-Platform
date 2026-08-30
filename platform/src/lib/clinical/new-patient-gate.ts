/**
 * What must be true before a new Weight Management patient can be approved.
 *
 * This journey has no face-to-face step. The safety that used to come from
 * meeting the patient now comes from four things: the questionnaire, the
 * identity and evidence uploads, a pharmacist telephone call, and a prescriber
 * deciding what to supply. Three of those can be skipped by clicking the wrong
 * button, so the rules live here — pure, tested, and called by the server
 * action rather than trusted to a disabled button in a browser.
 *
 * Every blocker is returned at once rather than the first one found. A
 * pharmacist who fixes one thing and is then told about the next has been made
 * to do the job twice; the screen should say everything that is missing.
 */

export interface VerificationCall {
  outcome: string;
  identityVerified: boolean;
  completedAt: Date | null;
}

/** What the prescriber decided to supply, as opposed to what was requested. */
export interface AuthorisedSupply {
  medicine: string | null;
  strength: string | null;
  quantity: string | null;
  directions: string | null;
}

export interface NewPatientApproval {
  patientId: string | null;
  branchId: string | null;
  answers: Record<string, unknown>;
  /** Every contact recorded against this request, newest first or not. */
  calls: VerificationCall[];
  authorised: AuthorisedSupply | null;
}

/** The one outcome that counts as having spoken to them. */
export const COMPLETED = 'COMPLETED';

/**
 * A call that satisfies the requirement: completed, and identity confirmed.
 *
 * Reaching somebody is not the same as verifying them. A call can be completed
 * with the identity check failed — that is a real outcome and it must not
 * unlock an approval.
 */
export function verifiedCall(calls: VerificationCall[]): VerificationCall | null {
  return calls.find(
    (c) => c.outcome === COMPLETED && c.identityVerified && c.completedAt !== null,
  ) ?? null;
}

function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Everything standing between this request and an approval.
 *
 * An empty array means it can be approved.
 */
export function newPatientApprovalBlockers(input: NewPatientApproval): string[] {
  const blockers: string[] = [];
  const { answers } = input;

  /*
   * Somebody who asked to be seen in person was told this service may not suit
   * them and sent to the face-to-face programme. If a submission carrying that
   * choice ever reaches the queue, approving it would supply against a form
   * the patient was told to abandon.
   */
  if (answers.pathwayChoice === 'in_person') {
    blockers.push(
      'This patient asked to be seen face to face and was directed to the Karsons '
      + 'programme. This request should not be supplied online.',
    );
  }

  if (!input.patientId) {
    blockers.push(
      'No patient record is linked, so nothing can be supplied against this request. '
      + 'Match it to a patient first.',
    );
  }

  if (!input.branchId) {
    blockers.push(
      'No branch is set, so a prescription number cannot be allocated. Confirm where '
      + 'this is being collected from or dispatched by.',
    );
  }

  const call = verifiedCall(input.calls);
  if (!call) {
    const attempted = input.calls.length > 0;
    const reached = input.calls.some((c) => c.outcome === COMPLETED);

    if (!attempted) {
      blockers.push('No verification call has been recorded. Call the patient before approving.');
    } else if (!reached) {
      blockers.push(
        'The patient has not been reached yet. Record a completed call before approving.',
      );
    } else {
      // Reached, but identity was not confirmed — the one case where a
      // completed call still does not unlock the decision.
      blockers.push(
        'The call was completed but identity was not verified. Confirm who you are '
        + 'speaking to before approving.',
      );
    }
  }

  /*
   * The prescriber's decision, not the patient's request.
   *
   * The approval path used to raise a prescription straight from
   * `answers.requestedMedicine`, so a pharmacist who changed the dose on the
   * phone still supplied what the patient originally asked for.
   */
  const authorised = input.authorised;
  if (!authorised) {
    blockers.push('Record what you are authorising — medicine, strength, quantity and directions.');
  } else {
    const missing: string[] = [];
    if (!filled(authorised.medicine)) missing.push('medicine');
    if (!filled(authorised.strength)) missing.push('strength');
    if (!filled(authorised.quantity)) missing.push('quantity');
    if (!filled(authorised.directions)) missing.push('directions');

    if (missing.length > 0) {
      blockers.push(`The authorisation is incomplete — add the ${missing.join(', ')}.`);
    }
  }

  return blockers;
}

/**
 * How far a new request has got, for the queue.
 *
 * `blocked` is not a state a patient is in; it is a state the WORK is in, and
 * the queue exists to show that.
 */
export type NewPatientStage =
  | 'awaiting-call'
  | 'call-attempted'
  | 'ready-to-decide'
  | 'exited-to-f2f';

export function newPatientStage(input: NewPatientApproval): NewPatientStage {
  if (input.answers.pathwayChoice === 'in_person') return 'exited-to-f2f';
  if (verifiedCall(input.calls)) return 'ready-to-decide';
  if (input.calls.length > 0) return 'call-attempted';
  return 'awaiting-call';
}
