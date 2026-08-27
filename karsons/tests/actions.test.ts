/**
 * These tests exist to prove the two guarantees the wrapper makes:
 *   1. No handler runs before authorisation passes.
 *   2. No mutation commits without its audit entry.
 *
 * Both are regulatory requirements, so they are tested rather than trusted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { action, configureActions, type ActionDependencies } from '@/lib/actions';
import { AuthorisationError, type Actor } from '@/lib/auth/scope';

const pharmacist: Actor = {
  userId: 'user_1',
  organisationId: 'org_1',
  assignments: [{
    role: 'PHARMACIST',
    companyId: 'co_1',
    branchId: 'br_onchan',
    validFrom: new Date('2020-01-01'),
    validTo: null,
  }],
};

const receptionist: Actor = {
  userId: 'user_2',
  organisationId: 'org_1',
  assignments: [{
    role: 'RECEPTION',
    companyId: null,
    branchId: null,
    validFrom: new Date('2020-01-01'),
    validTo: null,
  }],
};

let auditEntries: unknown[] = [];
let transactionRolledBack = false;

function wire(actor: Actor, options: { failAudit?: boolean } = {}): ActionDependencies {
  return {
    getActor: async () => actor,
    transaction: async (fn) => {
      try {
        return await fn({ fake: 'tx' });
      } catch (error) {
        transactionRolledBack = true;
        throw error;
      }
    },
    appendAudit: async (_tx, _orgId, build) => {
      if (options.failAudit) throw new Error('audit store unavailable');
      auditEntries.push(build(null, 'aud_1', new Date('2026-08-27T10:00:00Z')));
    },
    getRequestMeta: () => ({ ipAddress: '10.0.0.1', userAgent: 'test' }),
  };
}

beforeEach(() => {
  auditEntries = [];
  transactionRolledBack = false;
});

describe('authorisation', () => {
  it('runs the handler when authorised', async () => {
    configureActions(wire(pharmacist));
    const handler = vi.fn(async () => ({ result: 'done' }));

    const issue = action<{ branchId: string; companyId: string }>('prescription.issue')
      .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
      .handler(handler);

    await expect(issue({ branchId: 'br_onchan', companyId: 'co_1' })).resolves.toBe('done');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('never calls the handler when unauthorised', async () => {
    configureActions(wire(receptionist));
    const handler = vi.fn(async () => ({ result: 'done' }));

    const issue = action<{ branchId: string; companyId: string }>('prescription.issue')
      .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
      .handler(handler);

    await expect(issue({ branchId: 'br_onchan', companyId: 'co_1' }))
      .rejects.toThrow(AuthorisationError);

    // The critical assertion: nothing was read or written.
    expect(handler).not.toHaveBeenCalled();
  });

  it('denies an authorised role at the wrong branch', async () => {
    configureActions(wire(pharmacist));
    const handler = vi.fn(async () => ({ result: 'done' }));

    const issue = action<{ branchId: string; companyId: string }>('prescription.issue')
      .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
      .handler(handler);

    await expect(issue({ branchId: 'br_kirk', companyId: 'co_1' }))
      .rejects.toThrow(AuthorisationError);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('audit', () => {
  it('writes an audit entry for a mutation', async () => {
    configureActions(wire(pharmacist));

    const update = action<{ branchId: string; companyId: string }>('patient.write')
      .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
      .handler(async () => ({
        result: { id: 'pat_1' },
        audit: {
          action: 'patient.updated',
          entityType: 'Patient',
          entityId: 'pat_1',
          before: { phone: '07624 100200' },
          after: { phone: '07624 999888' },
        },
      }));

    await update({ branchId: 'br_onchan', companyId: 'co_1' });

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      action: 'patient.updated',
      organisationId: 'org_1',
      userId: 'user_1',
      ipAddress: '10.0.0.1',
    });
  });

  it('seals the entry with a hash', async () => {
    configureActions(wire(pharmacist));

    const update = action<{ branchId: string; companyId: string }>('patient.write')
      .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
      .handler(async () => ({
        result: null,
        audit: { action: 'patient.updated', entityType: 'Patient', entityId: 'pat_1' },
      }));

    await update({ branchId: 'br_onchan', companyId: 'co_1' });
    expect(auditEntries[0]).toHaveProperty('hash');
    expect((auditEntries[0] as { hash: string }).hash).toHaveLength(64);
  });

  it('rolls the mutation back if the audit write fails', async () => {
    // An unlogged change is worse than no change at all.
    configureActions(wire(pharmacist, { failAudit: true }));

    const update = action<{ branchId: string; companyId: string }>('patient.write')
      .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
      .handler(async () => ({
        result: null,
        audit: { action: 'patient.updated', entityType: 'Patient', entityId: 'pat_1' },
      }));

    await expect(update({ branchId: 'br_onchan', companyId: 'co_1' })).rejects.toThrow();
    expect(transactionRolledBack).toBe(true);
  });

  it('allows an action to declare no audit for read-only work', async () => {
    configureActions(wire(pharmacist));

    const read = action<{ branchId: string; companyId: string }>('patient.read')
      .scopedTo((input) => ({ branchId: input.branchId, companyId: input.companyId }))
      .handler(async () => ({ result: ['pat_1'] }));

    await read({ branchId: 'br_onchan', companyId: 'co_1' });
    expect(auditEntries).toHaveLength(0);
  });
});
