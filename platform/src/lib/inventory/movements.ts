/**
 * Stock movements.
 *
 * §9.2 asks for stock in, stock out, adjustment, return, expired and damaged,
 * each recording item, quantity, type, date, user, reference and notes. The
 * kinds were previously a free-text column with the intended values written in
 * a comment above it, which is a convention rather than a rule — nothing
 * stopped a typo becoming a seventh kind that no report would ever count.
 *
 * Two things matter more than the list itself.
 *
 * DIRECTION belongs to the kind, not to the caller. A caller that has to
 * remember whether to pass 5 or -5 will eventually pass the wrong one, and a
 * damaged vial recorded as a receipt is a stock count that silently drifts up.
 * Quantities here are always positive; the kind decides the sign.
 *
 * MOVEMENTS ARE THE TRUTH. `stock_level` is a cached projection of them, so
 * every change is recorded as a movement and the level is recalculated —
 * never edited directly. That is what makes a discrepancy detectable rather
 * than invisible.
 */

export const MOVEMENT_KINDS = [
  'RECEIPT', 'RETURN_IN', 'TRANSFER_IN',
  'ADMINISTRATION', 'TRANSFER_OUT', 'RETURN_OUT',
  'EXPIRED', 'DAMAGED', 'WASTE',
  'ADJUSTMENT',
] as const;

export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/**
 * How each kind moves the count.
 *
 * ADJUSTMENT is the only signed one: a stock count correction can go either
 * way, and forcing it into two kinds would mean a reconciliation that found
 * three too many and two too few produced two rows describing one count.
 */
const DIRECTION: Record<MovementKind, 1 | -1 | 0> = {
  RECEIPT: 1,
  RETURN_IN: 1,
  TRANSFER_IN: 1,
  ADMINISTRATION: -1,
  TRANSFER_OUT: -1,
  RETURN_OUT: -1,
  EXPIRED: -1,
  DAMAGED: -1,
  WASTE: -1,
  ADJUSTMENT: 0,
};

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  RECEIPT: 'Stock in',
  RETURN_IN: 'Returned to us',
  TRANSFER_IN: 'Transferred in',
  ADMINISTRATION: 'Given to a patient',
  TRANSFER_OUT: 'Transferred out',
  RETURN_OUT: 'Returned to supplier',
  EXPIRED: 'Expired',
  DAMAGED: 'Damaged',
  WASTE: 'Wasted',
  ADJUSTMENT: 'Count adjustment',
};

/** Kinds that are a write-off rather than a supply — reported separately. */
export const WRITE_OFF_KINDS: readonly MovementKind[] = ['EXPIRED', 'DAMAGED', 'WASTE'];

export function isMovementKind(value: string): value is MovementKind {
  return (MOVEMENT_KINDS as readonly string[]).includes(value);
}

export function isWriteOff(kind: MovementKind): boolean {
  return WRITE_OFF_KINDS.includes(kind);
}

/**
 * The signed effect of one movement on a stock count.
 *
 * `quantity` is always positive except for an adjustment, where the sign is
 * the correction itself.
 */
export function movementDelta(kind: MovementKind, quantity: number): number {
  if (kind === 'ADJUSTMENT') return Math.trunc(quantity);

  const magnitude = Math.abs(Math.trunc(quantity));
  return magnitude * DIRECTION[kind];
}

export interface MovementCheck {
  ok: boolean;
  /** What the count would become. Present even when refused, so a message can say so. */
  resulting: number;
  error?: string;
}

/**
 * Would this movement be legal against the current count?
 *
 * §28.4 — stock cannot go below zero. Enforced here rather than left to a
 * database constraint alone, because the useful version of this answer is a
 * sentence a person can act on, not a constraint violation.
 */
export function checkMovement(
  kind: MovementKind,
  quantity: number,
  currentQuantity: number,
): MovementCheck {
  const magnitude = Math.trunc(Math.abs(quantity));

  if (magnitude === 0) {
    return { ok: false, resulting: currentQuantity, error: 'Enter a quantity.' };
  }

  if (kind !== 'ADJUSTMENT' && quantity < 0) {
    // The kind already carries the direction. A negative quantity means the
    // caller is describing the same movement twice and one of them is wrong.
    return {
      ok: false,
      resulting: currentQuantity,
      error: `Enter a positive quantity — "${MOVEMENT_LABELS[kind]}" already takes stock out.`,
    };
  }

  const resulting = currentQuantity + movementDelta(kind, quantity);

  if (resulting < 0) {
    return {
      ok: false,
      resulting,
      error:
        `There ${currentQuantity === 1 ? 'is' : 'are'} only ${currentQuantity} left, ` +
        `so ${magnitude} cannot be taken out.`,
    };
  }

  return { ok: true, resulting };
}

/**
 * Replay movements into a count.
 *
 * The projection in `stock_level` should always equal this. Having it as a
 * function means a drift between the two is something we can measure rather
 * than something we assume has not happened.
 */
export function projectQuantity(
  movements: readonly { kind: MovementKind; quantity: number }[],
): number {
  return movements.reduce((total, m) => total + movementDelta(m.kind, m.quantity), 0);
}
