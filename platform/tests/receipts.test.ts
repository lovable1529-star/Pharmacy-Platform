/**
 * Accepting a batch into stock.
 *
 * Every one of these rules protects something downstream: the batch number is
 * how a recall finds patients, the expiry is what the administration screen
 * filters on, and the quantity is what the ledger reconciles against.
 */

import { describe, expect, it } from 'vitest';
import { receiptProblem, isExpiringSoon } from '@/lib/inventory/receipts';

const TODAY = new Date(Date.UTC(2026, 7, 31, 14, 30));

const GOOD = {
  productId: 'p1',
  batchNumber: 'FLU24-881',
  expiryDate: '2027-03-31',
  quantity: 40,
};

describe('a receipt that should be accepted', () => {
  it('passes', () => {
    expect(receiptProblem(GOOD, TODAY)).toBeNull();
  });

  /*
   * The bug the old validation had. It compared the parsed date — midnight UTC
   * — against `new Date()`, so from 00:01 onward a batch expiring today was
   * rejected as already expired. It has not expired until the day is over.
   */
  it('accepts a batch that expires today', () => {
    expect(receiptProblem({ ...GOOD, expiryDate: '2026-08-31' }, TODAY)).toBeNull();
  });

  it('accepts a batch that expires tomorrow', () => {
    expect(receiptProblem({ ...GOOD, expiryDate: '2026-09-01' }, TODAY)).toBeNull();
  });
});

describe('a receipt that should be refused', () => {
  it('refuses stock that has already expired', () => {
    expect(receiptProblem({ ...GOOD, expiryDate: '2026-08-30' }, TODAY))
      .toMatch(/already passed/);
  });

  it('needs a product', () => {
    expect(receiptProblem({ ...GOOD, productId: '' }, TODAY)).toMatch(/which product/);
  });

  /* The batch number is the thread a recall is pulled by. */
  it('needs a batch number, and says why', () => {
    const problem = receiptProblem({ ...GOOD, batchNumber: '   ' }, TODAY);
    expect(problem).toMatch(/batch number/);
    expect(problem).toMatch(/recall/);
  });

  it('needs an expiry date', () => {
    expect(receiptProblem({ ...GOOD, expiryDate: '' }, TODAY)).toMatch(/expiry date is needed/);
  });

  it('refuses a date that is not a date', () => {
    for (const bad of ['31/03/2027', '2027-3-1', 'soon', '2027-13-01']) {
      expect(receiptProblem({ ...GOOD, expiryDate: bad }, TODAY)).not.toBeNull();
    }
  });

  it('refuses a fractional quantity', () => {
    expect(receiptProblem({ ...GOOD, quantity: 4.5 }, TODAY)).toMatch(/whole number/);
  });

  /*
   * Zero is not a delivery. Recording it as one would make the movement ledger
   * assert that stock arrived when none did — and the correct instrument for
   * fixing a miscount is an adjustment, which carries a reason.
   */
  it('refuses a receipt of nothing and points at adjustments instead', () => {
    const problem = receiptProblem({ ...GOOD, quantity: 0 }, TODAY);
    expect(problem).toMatch(/at least one dose/);
    expect(problem).toMatch(/adjustment/);
  });

  it('refuses a negative quantity', () => {
    expect(receiptProblem({ ...GOOD, quantity: -5 }, TODAY)).not.toBeNull();
  });
});

describe('use-me-first warning', () => {
  it('flags stock inside ninety days', () => {
    expect(isExpiringSoon('2026-10-01', TODAY)).toBe(true);
  });

  it('does not flag stock well beyond it', () => {
    expect(isExpiringSoon('2027-06-01', TODAY)).toBe(false);
  });

  it('does not flag stock that has already gone', () => {
    expect(isExpiringSoon('2026-08-01', TODAY)).toBe(false);
  });
});
