/**
 * The approval gate for a remote new patient.
 *
 * This journey never meets the patient, so the call and the prescriber's own
 * decision are the safety. Both are a click away from being skipped, which is
 * why the rules are here and enforced on the server rather than by disabling
 * a button.
 */

import { describe, expect, it } from 'vitest';
import {
  newPatientApprovalBlockers, newPatientStage, verifiedCall,
} from '@/lib/clinical/new-patient-gate';

const CALLED = {
  outcome: 'COMPLETED',
  identityVerified: true,
  completedAt: new Date('2026-08-31T10:00:00Z'),
};

const AUTHORISED = {
  medicine: 'Mounjaro',
  strength: '2.5mg',
  quantity: '1 pen (4 weeks)',
  directions: 'Inject once weekly on the same day.',
};

const READY = {
  patientId: 'p1',
  branchId: 'b1',
  answers: { pathwayChoice: 'remote' },
  calls: [CALLED],
  authorised: AUTHORISED,
};

describe('a request that can be approved', () => {
  it('has nothing blocking it', () => {
    expect(newPatientApprovalBlockers(READY)).toEqual([]);
  });
});

describe('the verification call', () => {
  it('blocks when no call has been recorded at all', () => {
    const blockers = newPatientApprovalBlockers({ ...READY, calls: [] });
    expect(blockers.join(' ')).toMatch(/No verification call has been recorded/);
  });

  it('blocks when they were tried but not reached', () => {
    const blockers = newPatientApprovalBlockers({
      ...READY,
      calls: [{ outcome: 'NO_ANSWER', identityVerified: false, completedAt: null }],
    });
    expect(blockers.join(' ')).toMatch(/not been reached yet/);
  });

  /*
   * The distinction that matters. Reaching somebody is not verifying them, and
   * a completed call with the identity check failed is a real outcome that
   * must not unlock an approval.
   */
  it('blocks a completed call where identity was not verified', () => {
    const blockers = newPatientApprovalBlockers({
      ...READY,
      calls: [{ ...CALLED, identityVerified: false }],
    });
    expect(blockers.join(' ')).toMatch(/identity was not verified/);
  });

  it('blocks a call marked completed with no completion time', () => {
    const blockers = newPatientApprovalBlockers({
      ...READY,
      calls: [{ ...CALLED, completedAt: null }],
    });
    expect(blockers).not.toEqual([]);
  });

  it('accepts a good call among failed attempts', () => {
    const blockers = newPatientApprovalBlockers({
      ...READY,
      calls: [
        { outcome: 'NO_ANSWER', identityVerified: false, completedAt: null },
        { outcome: 'VOICEMAIL', identityVerified: false, completedAt: null },
        CALLED,
      ],
    });
    expect(blockers).toEqual([]);
  });

  it('finds the call that counts', () => {
    expect(verifiedCall([CALLED])).toBe(CALLED);
    expect(verifiedCall([{ ...CALLED, identityVerified: false }])).toBeNull();
    expect(verifiedCall([])).toBeNull();
  });
});

describe('who and where', () => {
  it('blocks without a patient record', () => {
    const blockers = newPatientApprovalBlockers({ ...READY, patientId: null });
    expect(blockers.join(' ')).toMatch(/No patient record is linked/);
  });

  it('blocks without a branch, because the number is allocated per branch', () => {
    const blockers = newPatientApprovalBlockers({ ...READY, branchId: null });
    expect(blockers.join(' ')).toMatch(/prescription number cannot be allocated/);
  });
});

describe('what the prescriber authorised', () => {
  /*
   * The approval path used to raise a prescription straight from
   * `answers.requestedMedicine`, so a pharmacist who changed the dose during
   * the call still supplied what the patient had originally asked for.
   */
  it('blocks when nothing has been authorised', () => {
    const blockers = newPatientApprovalBlockers({ ...READY, authorised: null });
    expect(blockers.join(' ')).toMatch(/Record what you are authorising/);
  });

  it('names exactly what is missing', () => {
    const blockers = newPatientApprovalBlockers({
      ...READY,
      authorised: { ...AUTHORISED, strength: null, directions: '   ' },
    });
    expect(blockers.join(' ')).toMatch(/strength/);
    expect(blockers.join(' ')).toMatch(/directions/);
    expect(blockers.join(' ')).not.toMatch(/medicine,/);
  });
});

describe('somebody who chose to be seen in person', () => {
  /*
   * They were told this service may not suit them and sent to the
   * face-to-face programme. Supplying against a form they were told to
   * abandon would be the worst possible outcome of that gate.
   */
  it('cannot be approved online', () => {
    const blockers = newPatientApprovalBlockers({
      ...READY,
      answers: { pathwayChoice: 'in_person' },
    });
    expect(blockers.join(' ')).toMatch(/should not be supplied online/);
  });
});

describe('reporting every problem at once', () => {
  it('lists them all rather than one at a time', () => {
    const blockers = newPatientApprovalBlockers({
      patientId: null,
      branchId: null,
      answers: {},
      calls: [],
      authorised: null,
    });
    expect(blockers).toHaveLength(4);
  });
});

describe('what stage the work is at', () => {
  it('reads the queue states', () => {
    expect(newPatientStage({ ...READY, calls: [] })).toBe('awaiting-call');
    expect(newPatientStage({
      ...READY,
      calls: [{ outcome: 'NO_ANSWER', identityVerified: false, completedAt: null }],
    })).toBe('call-attempted');
    expect(newPatientStage(READY)).toBe('ready-to-decide');
    expect(newPatientStage({ ...READY, answers: { pathwayChoice: 'in_person' } }))
      .toBe('exited-to-f2f');
  });
});
