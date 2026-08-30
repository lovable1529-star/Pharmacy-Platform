/**
 * Getting the medicine to the patient.
 *
 * The batch and expiry gate is the one that matters clinically: without a
 * batch number a recall cannot find who received it, and the pack expiry is
 * the last check before it leaves the building.
 */

import { describe, expect, it } from 'vitest';
import {
  transitionProblem, availableTransitions, needsBatch, methodFromAnswers,
  type FulfilmentState,
} from '@/lib/fulfilment/transitions';

const TODAY = new Date(Date.UTC(2026, 7, 31, 15, 0));

const READY_TO_GO: FulfilmentState = {
  method: 'COLLECTION',
  status: 'ASSEMBLING',
  batchNumber: 'MJ24-118',
  expiryDate: '2027-06-30',
  deliveryAddressSnapshot: null,
};

const ok = (state: FulfilmentState, target: Parameters<typeof transitionProblem>[1]) =>
  transitionProblem(state, target, TODAY);

describe('the batch and expiry gate', () => {
  it('lets a fully recorded pack become ready', () => {
    expect(ok(READY_TO_GO, 'READY')).toBeNull();
  });

  it('blocks without a batch number, and says why it matters', () => {
    const problem = ok({ ...READY_TO_GO, batchNumber: null }, 'READY');
    expect(problem).toMatch(/batch number/);
    expect(problem).toMatch(/recall/);
  });

  it('blocks on a blank batch number, not just a missing one', () => {
    expect(ok({ ...READY_TO_GO, batchNumber: '   ' }, 'READY')).not.toBeNull();
  });

  it('blocks without an expiry', () => {
    expect(ok({ ...READY_TO_GO, expiryDate: null }, 'READY')).toMatch(/expiry date/);
  });

  /*
   * Strictly later, matching the database trigger. A pack expiring today is
   * not fit to give somebody who will take it over the coming weeks.
   */
  it('refuses a pack expiring today', () => {
    expect(ok({ ...READY_TO_GO, expiryDate: '2026-08-31' }, 'READY')).toMatch(/not after/);
  });

  it('refuses a pack already expired', () => {
    expect(ok({ ...READY_TO_GO, expiryDate: '2026-08-01' }, 'READY')).not.toBeNull();
  });

  it('accepts a pack expiring tomorrow', () => {
    expect(ok({ ...READY_TO_GO, expiryDate: '2026-09-01' }, 'READY')).toBeNull();
  });

  /* Nothing is required to start assembling — that is picking it off a shelf. */
  it('does not demand a batch to begin assembling', () => {
    expect(needsBatch('ASSEMBLING')).toBe(false);
    expect(ok(
      { ...READY_TO_GO, status: 'PENDING', batchNumber: null, expiryDate: null },
      'ASSEMBLING',
    )).toBeNull();
  });
});

describe('collection and delivery do not mix', () => {
  it('will not dispatch something the patient is collecting', () => {
    expect(ok({ ...READY_TO_GO, status: 'READY' }, 'DISPATCHED'))
      .toMatch(/chose to collect/);
  });

  it('will not mark a delivery collected', () => {
    const delivery: FulfilmentState = {
      ...READY_TO_GO,
      method: 'DELIVERY',
      status: 'READY',
      deliveryAddressSnapshot: '12 Main Road, Onchan',
    };
    expect(ok(delivery, 'COLLECTED')).toMatch(/chose delivery/);
  });

  it('offers only the moves that apply to the method', () => {
    expect(availableTransitions({ ...READY_TO_GO, status: 'READY' }))
      .toEqual(['COLLECTED', 'CANCELLED']);
    expect(availableTransitions({ ...READY_TO_GO, method: 'DELIVERY', status: 'READY' }))
      .toEqual(['DISPATCHED', 'CANCELLED']);
  });

  /*
   * The address is snapshotted at dispatch. Reading the patient's current
   * address months later would misreport where a historical parcel went.
   */
  it('will not dispatch without an address on the record', () => {
    const delivery: FulfilmentState = {
      ...READY_TO_GO, method: 'DELIVERY', status: 'READY', deliveryAddressSnapshot: null,
    };
    expect(ok(delivery, 'DISPATCHED')).toMatch(/delivery address/);
  });
});

describe('moves that are not allowed at all', () => {
  it('will not skip from pending straight to supplied', () => {
    expect(ok({ ...READY_TO_GO, status: 'PENDING' }, 'SUPPLIED')).not.toBeNull();
  });

  /*
   * A supply that has happened cannot un-happen. Correcting one is an
   * amendment against the record, not a status moved backwards.
   */
  it('refuses to change anything already supplied', () => {
    const problem = ok({ ...READY_TO_GO, status: 'SUPPLIED' }, 'READY');
    expect(problem).toMatch(/already been supplied/);
    expect(problem).toMatch(/correction/);
  });

  it('refuses to revive a cancelled fulfilment', () => {
    expect(ok({ ...READY_TO_GO, status: 'CANCELLED' }, 'ASSEMBLING')).toMatch(/cancelled/);
  });

  it('treats a move to its current status as a no-op', () => {
    expect(ok({ ...READY_TO_GO, status: 'READY' }, 'READY')).toBeNull();
  });

  it('has nothing after supplied or cancelled', () => {
    expect(availableTransitions({ ...READY_TO_GO, status: 'SUPPLIED' })).toEqual([]);
    expect(availableTransitions({ ...READY_TO_GO, status: 'CANCELLED' })).toEqual([]);
  });
});

describe('reading the patient choice', () => {
  it('posts it only when they asked for post', () => {
    expect(methodFromAnswers({ fulfilmentMethod: 'delivery' })).toBe('DELIVERY');
    expect(methodFromAnswers({ fulfilmentMethod: 'collection' })).toBe('COLLECTION');
  });

  /*
   * Collection is the safer default: it waits for somebody to come in, rather
   * than putting a medicine in the post against an address nobody confirmed.
   */
  it('defaults to collection when they did not say', () => {
    expect(methodFromAnswers({})).toBe('COLLECTION');
  });
});
