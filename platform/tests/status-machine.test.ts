/**
 * The submission state machine.
 *
 * Status used to be a column any caller could set to anything, so nothing
 * stopped a completed consultation returning to draft or an approval being
 * written over a rejection with neither leaving a trace. These tests pin the
 * pathway the specification draws in §7.1, and the two additions it makes to
 * it: pending as a deliberate destination rather than only a starting point,
 * and a rejected case that can come back corrected.
 */

import { describe, it, expect } from 'vitest';
import {
  canTransition, assertTransition, nextStatuses, isLocked,
  IllegalTransitionError, SUBMISSION_STATUSES, PLAIN_ENGLISH,
  type SubmissionStatus,
} from '../src/lib/workflow/status';

describe('the pathway in the specification', () => {
  it('goes draft, pending, approved', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransition('SUBMITTED', 'APPROVED')).toBe(true);
  });

  it('lets a pharmacist reject from review', () => {
    expect(canTransition('IN_REVIEW', 'REJECTED')).toBe(true);
  });

  it('lets a rejected case come back corrected', () => {
    // §7.4 — resubmission, with the rejection preserved.
    expect(canTransition('REJECTED', 'RESUBMITTED')).toBe(true);
    expect(canTransition('RESUBMITTED', 'IN_REVIEW')).toBe(true);
  });

  it('lets a pharmacist push a reviewed case back to pending', () => {
    // §7.2 — pending is not only an initial status.
    expect(canTransition('IN_REVIEW', 'SUBMITTED')).toBe(true);
    expect(canTransition('IN_REVIEW', 'INFO_REQUESTED')).toBe(true);
  });

  it('returns an answered information request to the queue', () => {
    expect(canTransition('INFO_REQUESTED', 'RESUBMITTED')).toBe(true);
  });
});

describe('the moves that must not be possible', () => {
  it('never sends a finished record backwards', () => {
    expect(canTransition('COMPLETED', 'DRAFT')).toBe(false);
    expect(canTransition('COMPLETED', 'IN_REVIEW')).toBe(false);
    expect(canTransition('APPROVED', 'DRAFT')).toBe(false);
  });

  it('does not let an approval overwrite a rejection', () => {
    // The corrected case has to come back through RESUBMITTED, so the
    // rejection stays on the record instead of being erased by the approval.
    expect(canTransition('REJECTED', 'APPROVED')).toBe(false);
  });

  it('does not approve straight from draft', () => {
    // A questionnaire nobody has sent cannot be clinically approved. This is
    // the same defect that once let a settled payment approve a draft.
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false);
  });

  it('leaves cancelled and completed terminal', () => {
    expect(nextStatuses('CANCELLED')).toHaveLength(0);
    expect(nextStatuses('COMPLETED')).toHaveLength(0);
  });
});

describe('assertTransition', () => {
  it('allows re-entering the same state', () => {
    // A pharmacist reopening a case they already had open is not an error, and
    // recording it is more useful than refusing it.
    expect(() => assertTransition('IN_REVIEW', 'IN_REVIEW')).not.toThrow();
  });

  it('throws a sentence a person can act on', () => {
    try {
      assertTransition('COMPLETED', 'DRAFT');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      expect((error as Error).message).toContain('completed');
      expect((error as Error).message).toContain('draft');
    }
  });
});

describe('record locking', () => {
  it('freezes the answers once a decision has been made', () => {
    // §20 — after approval the questionnaire is historical clinical data.
    expect(isLocked('APPROVED')).toBe(true);
    expect(isLocked('COMPLETED')).toBe(true);
    expect(isLocked('REJECTED')).toBe(true);
    expect(isLocked('CANCELLED')).toBe(true);
  });

  it('leaves a case still being worked on editable', () => {
    expect(isLocked('DRAFT')).toBe(false);
    expect(isLocked('SUBMITTED')).toBe(false);
    expect(isLocked('IN_REVIEW')).toBe(false);
    expect(isLocked('INFO_REQUESTED')).toBe(false);
  });
});

describe('completeness', () => {
  it('defines transitions for every status', () => {
    // A status with no entry would silently allow nothing, which reads as a
    // locked record rather than as the missing definition it actually is.
    for (const status of SUBMISSION_STATUSES) {
      expect(Array.isArray(nextStatuses(status))).toBe(true);
    }
  });

  it('names every status in the specification vocabulary', () => {
    for (const status of SUBMISSION_STATUSES) {
      expect(PLAIN_ENGLISH[status as SubmissionStatus]).toBeTruthy();
    }
  });

  it('only ever points at statuses that exist', () => {
    for (const status of SUBMISSION_STATUSES) {
      for (const next of nextStatuses(status)) {
        expect(SUBMISSION_STATUSES).toContain(next);
      }
    }
  });

  it('leaves every non-terminal status reachable', () => {
    // An unreachable state is dead code that looks like a feature.
    const reachable = new Set<string>(['DRAFT']);
    for (const status of SUBMISSION_STATUSES) {
      for (const next of nextStatuses(status)) reachable.add(next);
    }
    for (const status of SUBMISSION_STATUSES) {
      expect(reachable.has(status)).toBe(true);
    }
  });
});
