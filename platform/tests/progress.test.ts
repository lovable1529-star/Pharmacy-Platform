/**
 * What a patient is told about their own request.
 *
 * Two properties matter more than the wording: the page never leaks clinical
 * detail, and it never claims something has happened when it has not.
 */

import { describe, it, expect } from 'vitest';
import {
  PROGRESS_ORDER, progressOf, reached, STEP_LABEL,
} from '../src/lib/submissions/progress';

describe('before a decision', () => {
  it('acknowledges a submitted form and asks nothing of them', () => {
    const p = progressOf({ status: 'SUBMITTED' });
    expect(p.step).toBe('RECEIVED');
    expect(p.needsPatient).toBe(false);
    expect(p.finished).toBe(false);
  });

  it('says a pharmacist is reading it', () => {
    expect(progressOf({ status: 'IN_REVIEW' }).step).toBe('REVIEW');
  });

  it('tells them plainly when the pharmacy needs something back', () => {
    const p = progressOf({ status: 'INFO_REQUESTED' });
    expect(p.needsPatient).toBe(true);
    expect(p.finished).toBe(false);
  });

  it('tells an unfinished form it has not been sent', () => {
    // The worst outcome here is a patient waiting for a call on a form still
    // sitting in draft.
    const p = progressOf({ status: 'DRAFT' });
    expect(p.step).toBe('RECEIVED');
    expect(p.needsPatient).toBe(true);
    expect(p.headline).toContain('not been sent');
  });

  it('errs towards "received" for a status it does not recognise', () => {
    // Claiming nothing that has not happened is the safe default.
    expect(progressOf({ status: 'SOMETHING_NEW' }).step).toBe('RECEIVED');
    expect(progressOf({ status: 'RESUBMITTED' }).step).toBe('RECEIVED');
  });
});

describe('once something has been dispensed', () => {
  it('reports approval as soon as a prescription exists', () => {
    const p = progressOf({ status: 'IN_REVIEW', prescriptionStatus: 'ISSUED' });
    expect(p.step).toBe('DECIDED');
    expect(p.headline).toContain('approved');
  });

  it('does not leave a posted patient being told a pharmacist has it', () => {
    // The submission may still read IN_REVIEW; the box has gone out, and that
    // is the more interesting fact.
    const p = progressOf({
      status: 'IN_REVIEW',
      prescriptionStatus: 'ISSUED',
      fulfilmentStatus: 'DISPATCHED',
    });
    expect(p.step).toBe('ON_ITS_WAY');
  });

  it('asks a collection patient to come in, and a delivery patient to wait', () => {
    const collect = progressOf({ status: 'IN_REVIEW', fulfilmentStatus: 'READY', fulfilmentMethod: 'COLLECTION' });
    expect(collect.needsPatient).toBe(true);
    expect(collect.headline).toContain('collect');

    const post = progressOf({ status: 'IN_REVIEW', fulfilmentStatus: 'READY', fulfilmentMethod: 'DELIVERY' });
    expect(post.needsPatient).toBe(false);
    expect(post.headline).toContain('posted');
  });

  it('closes once supplied or collected', () => {
    expect(progressOf({ status: 'IN_REVIEW', fulfilmentStatus: 'SUPPLIED' }).finished).toBe(true);
    expect(progressOf({ status: 'IN_REVIEW', fulfilmentStatus: 'COLLECTED' }).step).toBe('COMPLETE');
  });
});

describe('a request that was not approved', () => {
  it('is closed, and does not explain itself on a web page', () => {
    const p = progressOf({ status: 'REJECTED' });
    expect(p.step).toBe('DECIDED');
    expect(p.finished).toBe(true);
    // A reason belongs in a conversation with a pharmacist, not here.
    expect(p.detail).toContain('in touch');
  });
});

describe('what the page can never say', () => {
  const everyOutcome = [
    progressOf({ status: 'SUBMITTED' }),
    progressOf({ status: 'IN_REVIEW' }),
    progressOf({ status: 'INFO_REQUESTED' }),
    progressOf({ status: 'REJECTED' }),
    progressOf({ status: 'COMPLETED' }),
    progressOf({ status: 'DRAFT' }),
    progressOf({ status: 'IN_REVIEW', prescriptionStatus: 'ISSUED' }),
    progressOf({ status: 'IN_REVIEW', fulfilmentStatus: 'DISPATCHED' }),
    progressOf({ status: 'IN_REVIEW', fulfilmentStatus: 'SUPPLIED' }),
  ];

  it('never names a medicine, a dose or a RAG colour', () => {
    // The page is reached by holding a link, and links get forwarded, left
    // open on shared computers and read over shoulders.
    const forbidden = /mounjaro|wegovy|tirzepatide|semaglutide|\bmg\b|amber|\bred\b|\bgreen\b|bmi/i;

    for (const p of everyOutcome) {
      expect(`${p.headline} ${p.detail}`).not.toMatch(forbidden);
    }
  });

  it('always says something, in both fields', () => {
    for (const p of everyOutcome) {
      expect(p.headline.length).toBeGreaterThan(0);
      expect(p.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('the timeline', () => {
  it('runs in order', () => {
    expect(PROGRESS_ORDER).toEqual(['RECEIVED', 'REVIEW', 'DECIDED', 'ON_ITS_WAY', 'COMPLETE']);
  });

  it('marks everything up to the current step as reached', () => {
    expect(reached('DECIDED', 'RECEIVED')).toBe(true);
    expect(reached('DECIDED', 'DECIDED')).toBe(true);
    expect(reached('DECIDED', 'ON_ITS_WAY')).toBe(false);
  });

  it('labels every step', () => {
    for (const step of PROGRESS_ORDER) {
      expect(STEP_LABEL[step]).toBeTruthy();
    }
  });
});
