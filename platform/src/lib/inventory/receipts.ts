/**
 * Receiving stock into a branch.
 *
 * The rules for accepting a batch, kept apart from both the server action and
 * the form so they can be tested without a database or a browser — and so the
 * same answer is given wherever a receipt is entered.
 *
 * This moved out of Settings deliberately. Receiving a delivery is something a
 * pharmacist does on an ordinary Tuesday morning; the product catalogue is
 * something an administrator sets up once. Putting the two together meant the
 * daily task lived behind a menu nobody opens, and the client asked for stock
 * to be where the stock is.
 */

export interface BatchReceipt {
  productId: string;
  batchNumber: string;
  /** ISO `YYYY-MM-DD`. */
  expiryDate: string;
  quantity: number;
}

/**
 * Why this receipt cannot be accepted, or null.
 *
 * `asOf` is injectable so the expiry rule can be tested against a fixed date
 * rather than against whenever the suite happens to run.
 */
export function receiptProblem(input: BatchReceipt, asOf: Date = new Date()): string | null {
  if (!input.productId) {
    return 'Choose which product this batch is.';
  }

  if (!input.batchNumber.trim()) {
    return 'A batch number is needed — it is what a recall is traced through.';
  }

  if (!input.expiryDate) {
    return 'An expiry date is needed.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) {
    return 'That expiry date is not a real date.';
  }

  /*
   * Compared at day resolution, not by timestamp.
   *
   * `new Date('2026-09-01') <= new Date()` is true for most of the day the
   * stock actually expires, because the parsed date is midnight UTC and "now"
   * is some hours later. A batch expiring today has not expired yet, and
   * refusing it sends the pharmacist looking for a fault that is not there.
   */
  const expiry = new Date(`${input.expiryDate}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) {
    return 'That expiry date is not a real date.';
  }

  const today = new Date(Date.UTC(
    asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(),
  ));

  if (expiry.getTime() < today.getTime()) {
    return 'That expiry date has already passed — this stock cannot be received.';
  }

  if (!Number.isInteger(input.quantity)) {
    return 'Quantity must be a whole number of doses.';
  }

  if (input.quantity < 1) {
    // Zero is not a receipt. An adjustment to zero is a different movement with
    // a different reason, and recording it as a delivery would make the ledger
    // claim stock arrived when none did.
    return 'A receipt needs at least one dose. To correct a count, use an adjustment.';
  }

  return null;
}

/**
 * Batches expiring soon enough to be used first.
 *
 * Ninety days, matching the warning already shown on the inventory screen.
 */
export const EXPIRING_SOON_DAYS = 90;

export function isExpiringSoon(expiryDate: string, asOf: Date = new Date()): boolean {
  const expiry = new Date(`${expiryDate}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) return false;
  const days = (expiry.getTime() - asOf.getTime()) / 86_400_000;
  return days >= 0 && days <= EXPIRING_SOON_DAYS;
}
