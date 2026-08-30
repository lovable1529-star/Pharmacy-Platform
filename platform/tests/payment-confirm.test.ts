/**
 * Confirming a payment is what releases the prescription.
 *
 * There is no provider in this phase, so a member of staff ticks a box and the
 * system allocates a prescription number on the strength of it. That makes the
 * tick a clinical gate, not bookkeeping.
 */

import { describe, expect, it } from 'vitest';
import { canConfirmPayment } from '@/lib/payments/confirm';

describe('a payment that can be confirmed', () => {
  it('is pending, against an approved request', () => {
    expect(canConfirmPayment({ status: 'PENDING', submissionStatus: 'APPROVED' }))
      .toEqual({ can: true, alreadySettled: false });
  });

  it('allows one still under review, since money may be taken before the decision lands', () => {
    expect(canConfirmPayment({ status: 'PENDING', submissionStatus: 'IN_REVIEW' }).can).toBe(true);
  });

  it('allows a payment with no request behind it', () => {
    expect(canConfirmPayment({ status: 'PENDING', submissionStatus: null }).can).toBe(true);
  });
});

describe('confirming twice', () => {
  /*
   * Two people ticking the same box, or one double-click, must leave one
   * payment and one prescription — and must not show a failure for something
   * that actually worked.
   */
  it('succeeds and reports that nothing changed', () => {
    expect(canConfirmPayment({ status: 'PAID', submissionStatus: 'APPROVED' }))
      .toEqual({ can: true, alreadySettled: true });
  });
});

describe('a payment that must not be confirmed', () => {
  it('refuses a cancelled payment and says what to do', () => {
    const verdict = canConfirmPayment({ status: 'CANCELLED', submissionStatus: 'APPROVED' });
    expect(verdict.can).toBe(false);
    expect(verdict.can === false && verdict.reason).toMatch(/Raise a new one/);
  });

  /* Taking money for a supply that was refused is the worst case here. */
  it('refuses against a rejected request', () => {
    const verdict = canConfirmPayment({ status: 'PENDING', submissionStatus: 'REJECTED' });
    expect(verdict.can).toBe(false);
    expect(verdict.can === false && verdict.reason).toMatch(/rejected/);
  });

  it('refuses against a request still in draft', () => {
    expect(canConfirmPayment({ status: 'PENDING', submissionStatus: 'DRAFT' }).can).toBe(false);
  });

  it('refuses against one already completed', () => {
    expect(canConfirmPayment({ status: 'PENDING', submissionStatus: 'COMPLETED' }).can).toBe(false);
  });

  it('writes the status in words a pharmacist reads, not an enum', () => {
    const verdict = canConfirmPayment({ status: 'PENDING', submissionStatus: 'INFO_REQUESTED' });
    expect(verdict.can === false && verdict.reason).toMatch(/info requested/);
  });
});
