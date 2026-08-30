/**
 * Getting a prescription from the shelf to the patient.
 *
 * The prescription is the legal authorisation; this is what physically
 * happened to the box. Kept apart so the authorisation does not grow a carrier
 * and a tracking number, and so "was it sent?" and "was it authorised?" stay
 * separate questions.
 *
 * Migration 21 enforces the same rules in the database with a check constraint
 * and a trigger. This is not a substitute for that — a constraint is what makes
 * the rule true, whoever writes the row. It exists so a pharmacist gets a
 * sentence explaining what is missing rather than a Postgres exception, and so
 * the rules can be tested without a database.
 */

export type FulfilmentMethod = 'COLLECTION' | 'DELIVERY';

export type FulfilmentStatus =
  | 'PENDING'
  | 'ASSEMBLING'
  | 'READY'
  | 'DISPATCHED'
  | 'COLLECTED'
  | 'SUPPLIED'
  | 'CANCELLED';

/** Nothing leaves the pharmacy at these without a batch and an expiry. */
const NEEDS_BATCH: FulfilmentStatus[] = ['READY', 'DISPATCHED', 'COLLECTED', 'SUPPLIED'];

export function needsBatch(status: FulfilmentStatus): boolean {
  return NEEDS_BATCH.includes(status);
}

/**
 * Where each status can go next, before method is considered.
 *
 * SUPPLIED and CANCELLED are terminal: a supply that has happened cannot
 * un-happen, and correcting one is an amendment against the record rather than
 * a status moved backwards.
 */
const NEXT: Record<FulfilmentStatus, FulfilmentStatus[]> = {
  PENDING: ['ASSEMBLING', 'CANCELLED'],
  ASSEMBLING: ['READY', 'CANCELLED'],
  READY: ['DISPATCHED', 'COLLECTED', 'CANCELLED'],
  DISPATCHED: ['SUPPLIED'],
  COLLECTED: ['SUPPLIED'],
  SUPPLIED: [],
  CANCELLED: [],
};

export interface FulfilmentState {
  method: FulfilmentMethod;
  status: FulfilmentStatus;
  batchNumber: string | null;
  /** ISO `YYYY-MM-DD`. */
  expiryDate: string | null;
  deliveryAddressSnapshot: string | null;
}

/**
 * Why this move cannot be made, or null.
 *
 * `asOf` is the date the supply is treated as happening on, injectable so the
 * expiry rule is testable against a fixed day.
 */
export function transitionProblem(
  state: FulfilmentState,
  target: FulfilmentStatus,
  asOf: Date = new Date(),
): string | null {
  if (state.status === target) return null;

  if (!NEXT[state.status].includes(target)) {
    if (state.status === 'SUPPLIED') {
      return 'This has already been supplied. Record a correction against the prescription '
        + 'rather than changing its status.';
    }
    if (state.status === 'CANCELLED') return 'This fulfilment was cancelled.';
    return `A ${state.status.toLowerCase()} supply cannot go straight to `
      + `${target.toLowerCase()}.`;
  }

  /*
   * A collection is a handover at the counter and a delivery is a parcel. They
   * are not interchangeable, and recording one as the other misreports where
   * the medicine physically went.
   */
  if (state.method === 'COLLECTION' && target === 'DISPATCHED') {
    return 'This patient chose to collect, so it cannot be dispatched.';
  }
  if (state.method === 'DELIVERY' && target === 'COLLECTED') {
    return 'This patient chose delivery, so it cannot be marked collected.';
  }

  if (needsBatch(target)) {
    if (!state.batchNumber?.trim()) {
      return 'Record the batch number before this can leave the pharmacy — it is what a '
        + 'recall is traced through.';
    }
    if (!state.expiryDate) {
      return 'Record the pack expiry date before this can leave the pharmacy.';
    }

    const expiry = new Date(`${state.expiryDate}T00:00:00Z`);
    if (Number.isNaN(expiry.getTime())) return 'That expiry date is not a real date.';

    const today = new Date(Date.UTC(
      asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(),
    ));

    /*
     * Strictly later, matching the database trigger. A pack expiring today is
     * not fit to hand to somebody who will take it over the coming weeks.
     */
    if (expiry.getTime() <= today.getTime()) {
      return `That pack expires on ${state.expiryDate}, which is not after the supply date. `
        + 'It cannot be supplied.';
    }
  }

  if (state.method === 'DELIVERY' && (target === 'DISPATCHED' || target === 'SUPPLIED')) {
    if (!state.deliveryAddressSnapshot?.trim()) {
      return 'Record the delivery address before dispatch, so the record says where it went.';
    }
  }

  return null;
}

/** What a pharmacist can do next, for the buttons to offer. */
export function availableTransitions(state: FulfilmentState): FulfilmentStatus[] {
  return NEXT[state.status].filter((target) => {
    if (state.method === 'COLLECTION' && target === 'DISPATCHED') return false;
    if (state.method === 'DELIVERY' && target === 'COLLECTED') return false;
    return true;
  });
}

/** Reads the patient's own answer. Collection unless they asked for post. */
export function methodFromAnswers(answers: Record<string, unknown>): FulfilmentMethod {
  return answers.fulfilmentMethod === 'delivery' ? 'DELIVERY' : 'COLLECTION';
}
