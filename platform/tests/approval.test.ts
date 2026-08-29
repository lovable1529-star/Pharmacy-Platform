/**
 * An approval must not half-complete.
 *
 * `raisePrescription` is gated on a patient and a branch. When either was
 * missing it did nothing, silently, while the rest of the approval went ahead —
 * so a request could leave the queue marked APPROVED with no prescription
 * behind it and nothing recording why.
 */

import { describe, expect, it } from 'vitest';
import { approvalBlocker } from '@/lib/prescriptions/approval';

const READY = {
  patientId: 'p1',
  branchId: 'b1',
  answers: { requestedMedicine: 'mounjaro_5mg' },
};

describe('an approval that can complete', () => {
  it('is not blocked', () => {
    expect(approvalBlocker(READY)).toBeNull();
  });

  /*
   * A vaccination questionnaire names no medicine, so there is no prescription
   * number to allocate and no branch to allocate it against.
   */
  it('does not demand a branch when no medicine is being supplied', () => {
    expect(approvalBlocker({ patientId: 'p1', branchId: null, answers: {} })).toBeNull();
  });

  it('treats a blank medicine as no medicine', () => {
    expect(
      approvalBlocker({ patientId: 'p1', branchId: null, answers: { requestedMedicine: '   ' } }),
    ).toBeNull();
  });
});

describe('an approval that cannot', () => {
  /*
   * The live case. Two of the three requests in the queue had no patient record
   * at all, because the first-consultation form never asked who they were.
   */
  it('refuses without a patient record, whatever the service', () => {
    const blocked = approvalBlocker({ ...READY, patientId: null });
    expect(blocked).toMatch(/not linked to a patient record/);
  });

  it('refuses a medicine request with no branch', () => {
    const blocked = approvalBlocker({ ...READY, branchId: null });
    expect(blocked).toMatch(/prescription number cannot be allocated/);
  });

  it('reports the missing patient first, as the more fundamental gap', () => {
    const blocked = approvalBlocker({ ...READY, patientId: null, branchId: null });
    expect(blocked).toMatch(/patient record/);
  });

  /*
   * The message is for a pharmacist deciding what to do next, not a developer
   * reading a log. It has to say which action clears it.
   */
  it('tells them what to do rather than what was null', () => {
    for (const subject of [{ ...READY, patientId: null }, { ...READY, branchId: null }]) {
      const blocked = approvalBlocker(subject)!;
      expect(blocked).not.toMatch(/null|undefined|Id\b/);
      expect(blocked.length).toBeGreaterThan(40);
    }
  });
});
