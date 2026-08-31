/**
 * Withdrawing a service.
 *
 * Nothing is deleted. Fourteen tables point at a service and most of them are
 * clinical — every submission, consultation, prescription and enrolment made
 * through it. "Delete this service" reads as tidying a list; what it would
 * mean is erasing the justification for medicine somebody already took.
 */

import { describe, expect, it } from 'vitest';
import { canArchiveService, type ServiceUsage } from '@/lib/services/archive';

const UNUSED: ServiceUsage = {
  openSubmissions: 0,
  openPrescriptions: 0,
  activeEnrolments: 0,
  futureAppointments: 0,
  totalSubmissions: 0,
};

describe('a service nobody is using', () => {
  it('can be archived', () => {
    const verdict = canArchiveService(UNUSED);
    expect(verdict.can).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  /*
   * Even with nothing attached, the person clicking should be told the public
   * link stops working — that is the part with an outside effect.
   */
  it('still says the public link will stop working', () => {
    expect(canArchiveService(UNUSED).consequences.join(' ')).toMatch(/public link/);
  });
});

describe('work that would be stranded', () => {
  it('blocks on requests still waiting for a decision', () => {
    const verdict = canArchiveService({ ...UNUSED, openSubmissions: 3 });
    expect(verdict.can).toBe(false);
    expect(verdict.blockers.join(' ')).toMatch(/3 requests are still waiting/);
    expect(verdict.blockers.join(' ')).toMatch(/never comes/);
  });

  it('blocks on prescriptions raised but not supplied', () => {
    const verdict = canArchiveService({ ...UNUSED, openPrescriptions: 1 });
    expect(verdict.can).toBe(false);
    expect(verdict.blockers.join(' ')).toMatch(/1 prescription has been raised/);
  });

  /* Patients are expecting to be seen. Somebody has to tell them. */
  it('blocks on appointments booked in the future', () => {
    const verdict = canArchiveService({ ...UNUSED, futureAppointments: 2 });
    expect(verdict.can).toBe(false);
    expect(verdict.blockers.join(' ')).toMatch(/2 appointments are booked/);
  });

  it('lists every blocker rather than the first', () => {
    const verdict = canArchiveService({
      ...UNUSED, openSubmissions: 1, openPrescriptions: 1, futureAppointments: 1,
    });
    expect(verdict.blockers).toHaveLength(3);
  });

  it('counts one and many correctly', () => {
    expect(canArchiveService({ ...UNUSED, openSubmissions: 1 }).blockers.join(' '))
      .toMatch(/1 request is/);
    expect(canArchiveService({ ...UNUSED, openSubmissions: 2 }).blockers.join(' '))
      .toMatch(/2 requests are/);
  });
});

describe('things that are true but do not block', () => {
  /*
   * A pharmacy may legitimately want to withdraw a service its existing
   * patients are on. But the effect is immediate and completely silent from
   * the patient's side, so it has to be said before they confirm.
   */
  it('warns about enrolled patients without stopping the archive', () => {
    const verdict = canArchiveService({ ...UNUSED, activeEnrolments: 12 });
    expect(verdict.can).toBe(true);
    expect(verdict.consequences.join(' ')).toMatch(/12 patients are enrolled/);
    expect(verdict.consequences.join(' ')).toMatch(/nothing will tell them why/);
  });

  it('reassures that answered forms are kept', () => {
    const verdict = canArchiveService({ ...UNUSED, totalSubmissions: 40 });
    expect(verdict.can).toBe(true);
    expect(verdict.consequences.join(' ')).toMatch(/40 forms/);
    expect(verdict.consequences.join(' ')).toMatch(/deletes nothing/);
  });

  /*
   * History is not an obstacle. A service used two hundred times last season
   * and finished with is exactly the one somebody wants to withdraw.
   */
  it('does not block on history alone', () => {
    expect(canArchiveService({ ...UNUSED, totalSubmissions: 200 }).can).toBe(true);
  });
});

describe('keeping the two apart', () => {
  /*
   * A blocker is work that would be stranded. A consequence is something worth
   * knowing. Merged into one list, a real obstacle hides among the notes.
   */
  it('does not put consequences in the blockers', () => {
    const verdict = canArchiveService({
      ...UNUSED, openSubmissions: 2, activeEnrolments: 5, totalSubmissions: 30,
    });
    expect(verdict.blockers).toHaveLength(1);
    expect(verdict.blockers.join(' ')).not.toMatch(/enrolled|kept/);
    expect(verdict.consequences.length).toBeGreaterThan(1);
  });
});
