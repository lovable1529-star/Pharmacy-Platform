/**
 * Stock movements.
 *
 * The kinds were free text with the intended values in a comment, so a typo
 * could become a seventh kind no report would count. These pin the two things
 * that actually protect the count: direction belongs to the kind, and stock
 * cannot go below zero.
 */

import { describe, it, expect } from 'vitest';
import {
  movementDelta, checkMovement, projectQuantity, isMovementKind, isWriteOff,
  MOVEMENT_KINDS, MOVEMENT_LABELS, type MovementKind,
} from '../src/lib/inventory/movements';

describe('direction belongs to the kind', () => {
  it('adds for anything coming in', () => {
    expect(movementDelta('RECEIPT', 10)).toBe(10);
    expect(movementDelta('RETURN_IN', 3)).toBe(3);
    expect(movementDelta('TRANSFER_IN', 5)).toBe(5);
  });

  it('subtracts for anything going out', () => {
    expect(movementDelta('ADMINISTRATION', 1)).toBe(-1);
    expect(movementDelta('TRANSFER_OUT', 4)).toBe(-4);
    expect(movementDelta('RETURN_OUT', 2)).toBe(-2);
  });

  it('subtracts for a write-off', () => {
    expect(movementDelta('EXPIRED', 6)).toBe(-6);
    expect(movementDelta('DAMAGED', 2)).toBe(-2);
    expect(movementDelta('WASTE', 1)).toBe(-1);
  });

  it('ignores a sign the caller got wrong', () => {
    // A damaged vial passed as -3 must still remove three, not add them.
    expect(movementDelta('DAMAGED', -3)).toBe(-3);
    expect(movementDelta('RECEIPT', -10)).toBe(10);
  });

  it('lets an adjustment go either way', () => {
    // A count that found three too many and two too few is one count, not two
    // movements in opposite directions.
    expect(movementDelta('ADJUSTMENT', 3)).toBe(3);
    expect(movementDelta('ADJUSTMENT', -2)).toBe(-2);
  });
});

describe('stock cannot go below zero — §28.4', () => {
  it('allows taking out what is there', () => {
    expect(checkMovement('ADMINISTRATION', 1, 5)).toMatchObject({ ok: true, resulting: 4 });
  });

  it('allows taking out the last one', () => {
    expect(checkMovement('ADMINISTRATION', 5, 5)).toMatchObject({ ok: true, resulting: 0 });
  });

  it('refuses taking out more than there is', () => {
    const result = checkMovement('ADMINISTRATION', 6, 5);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('only 5');
  });

  it('refuses an adjustment that would go negative', () => {
    expect(checkMovement('ADJUSTMENT', -10, 4).ok).toBe(false);
  });

  it('says "is" for one and "are" for several', () => {
    expect(checkMovement('ADMINISTRATION', 2, 1).error).toContain('is only 1');
    expect(checkMovement('ADMINISTRATION', 9, 3).error).toContain('are only 3');
  });

  it('refuses a zero quantity', () => {
    expect(checkMovement('RECEIPT', 0, 10).ok).toBe(false);
  });

  it('refuses a negative quantity on a directional kind', () => {
    // The kind already carries the direction, so a negative here means the
    // caller has described the movement twice and one of them is wrong.
    const result = checkMovement('EXPIRED', -2, 10);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('positive');
  });
});

describe('projection', () => {
  it('replays a batch life into a count', () => {
    const movements: { kind: MovementKind; quantity: number }[] = [
      { kind: 'RECEIPT', quantity: 100 },
      { kind: 'ADMINISTRATION', quantity: 1 },
      { kind: 'ADMINISTRATION', quantity: 1 },
      { kind: 'DAMAGED', quantity: 2 },
      { kind: 'TRANSFER_OUT', quantity: 10 },
      { kind: 'ADJUSTMENT', quantity: -1 },
    ];
    expect(projectQuantity(movements)).toBe(85);
  });

  it('is zero for no movements', () => {
    expect(projectQuantity([])).toBe(0);
  });
});

describe('the kinds themselves', () => {
  it('covers everything §9.2 asks for', () => {
    for (const kind of ['RECEIPT', 'ADMINISTRATION', 'ADJUSTMENT', 'RETURN_IN', 'EXPIRED', 'DAMAGED']) {
      expect(isMovementKind(kind)).toBe(true);
    }
  });

  it('rejects anything not on the list', () => {
    expect(isMovementKind('RECIEPT')).toBe(false);
    expect(isMovementKind('')).toBe(false);
  });

  it('labels every kind', () => {
    for (const kind of MOVEMENT_KINDS) expect(MOVEMENT_LABELS[kind]).toBeTruthy();
  });

  it('separates write-offs from supply', () => {
    // Expired stock and stock given to a patient both reduce the count, but
    // only one of them is loss.
    expect(isWriteOff('EXPIRED')).toBe(true);
    expect(isWriteOff('DAMAGED')).toBe(true);
    expect(isWriteOff('ADMINISTRATION')).toBe(false);
    expect(isWriteOff('TRANSFER_OUT')).toBe(false);
  });
});
