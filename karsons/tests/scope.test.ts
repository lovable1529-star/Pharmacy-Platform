import { describe, expect, it } from 'vitest';
import {
  accessibleBranches,
  assertCan,
  AuthorisationError,
  can,
  displayRole,
  permissionsFor,
  type Actor,
  type RoleAssignment,
} from '@/lib/auth/scope';

const NOW = new Date('2026-08-27T10:00:00Z');

function assignment(overrides: Partial<RoleAssignment> = {}): RoleAssignment {
  return {
    role: 'PHARMACIST',
    companyId: null,
    branchId: null,
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: null,
    ...overrides,
  };
}

function actor(assignments: RoleAssignment[]): Actor {
  return { userId: 'user_1', organisationId: 'org_1', assignments };
}

const ONCHAN = { companyId: 'co_1', branchId: 'br_onchan' };
const KIRK_MICHAEL = { companyId: 'co_1', branchId: 'br_kirk' };
const OTHER_COMPANY = { companyId: 'co_2', branchId: 'br_other' };

describe('organisation-wide assignments', () => {
  const owner = actor([assignment({ role: 'OWNER' })]);

  it('grants access at every branch', () => {
    expect(can(owner, 'consultation.perform', ONCHAN, NOW)).toBe(true);
    expect(can(owner, 'consultation.perform', OTHER_COMPANY, NOW)).toBe(true);
  });

  it('grants billing only to the owner', () => {
    const admin = actor([assignment({ role: 'ADMIN' })]);
    expect(can(owner, 'billing.manage', ONCHAN, NOW)).toBe(true);
    expect(can(admin, 'billing.manage', ONCHAN, NOW)).toBe(false);
  });
});

describe('branch-scoped assignments', () => {
  const locum = actor([assignment({ role: 'PHARMACIST', companyId: 'co_1', branchId: 'br_kirk' })]);

  it('grants access at the assigned branch only', () => {
    expect(can(locum, 'consultation.perform', KIRK_MICHAEL, NOW)).toBe(true);
    expect(can(locum, 'consultation.perform', ONCHAN, NOW)).toBe(false);
  });

  it('denies access at another company entirely', () => {
    expect(can(locum, 'patient.read', OTHER_COMPANY, NOW)).toBe(false);
  });
});

describe('company-scoped assignments', () => {
  const manager = actor([assignment({ role: 'ADMIN', companyId: 'co_1', branchId: null })]);

  it('covers every branch within that company', () => {
    expect(can(manager, 'inventory.write', ONCHAN, NOW)).toBe(true);
    expect(can(manager, 'inventory.write', KIRK_MICHAEL, NOW)).toBe(true);
  });

  it('does not cover a different company', () => {
    expect(can(manager, 'inventory.write', OTHER_COMPANY, NOW)).toBe(false);
  });
});

describe('time-limited access', () => {
  it('denies access before the start date', () => {
    const future = actor([assignment({ validFrom: new Date('2026-12-01T00:00:00Z') })]);
    expect(can(future, 'patient.read', ONCHAN, NOW)).toBe(false);
  });

  it('denies access after expiry — a locum loses access automatically', () => {
    const expired = actor([assignment({ validTo: new Date('2026-08-01T00:00:00Z') })]);
    expect(can(expired, 'patient.read', ONCHAN, NOW)).toBe(false);
  });

  it('grants access inside the window', () => {
    const current = actor([assignment({
      validFrom: new Date('2026-08-01T00:00:00Z'),
      validTo: new Date('2026-09-01T00:00:00Z'),
    })]);
    expect(can(current, 'patient.read', ONCHAN, NOW)).toBe(true);
  });
});

describe('role permissions', () => {
  it('stops reception issuing prescriptions', () => {
    const reception = actor([assignment({ role: 'RECEPTION' })]);
    expect(can(reception, 'appointment.write', ONCHAN, NOW)).toBe(true);
    expect(can(reception, 'prescription.issue', ONCHAN, NOW)).toBe(false);
    expect(can(reception, 'consultation.perform', ONCHAN, NOW)).toBe(false);
  });

  it('stops a pharmacist publishing clinical rulesets', () => {
    // Authoring clinical rules is an administrative act with its own audit
    // trail, deliberately separated from using them.
    const pharmacist = actor([assignment({ role: 'PHARMACIST' })]);
    expect(can(pharmacist, 'prescription.issue', ONCHAN, NOW)).toBe(true);
    expect(can(pharmacist, 'ruleset.publish', ONCHAN, NOW)).toBe(false);
  });

  it('gives read-only users no write permissions at all', () => {
    const readOnly = actor([assignment({ role: 'READ_ONLY' })]);
    const permissions = permissionsFor(readOnly, ONCHAN, NOW);
    expect([...permissions].every((p) => p.endsWith('.read'))).toBe(true);
  });

  it('combines permissions across multiple assignments', () => {
    const combined = actor([
      assignment({ role: 'RECEPTION' }),
      assignment({ role: 'PHARMACIST', companyId: 'co_1', branchId: 'br_onchan' }),
    ]);
    expect(can(combined, 'prescription.issue', ONCHAN, NOW)).toBe(true);
    expect(can(combined, 'prescription.issue', OTHER_COMPANY, NOW)).toBe(false);
  });
});

describe('assertCan', () => {
  it('throws for an unauthorised action', () => {
    const reception = actor([assignment({ role: 'RECEPTION' })]);
    expect(() => assertCan(reception, 'prescription.issue', ONCHAN, NOW)).toThrow(AuthorisationError);
  });

  it('passes silently when authorised', () => {
    const pharmacist = actor([assignment({ role: 'PHARMACIST' })]);
    expect(() => assertCan(pharmacist, 'prescription.issue', ONCHAN, NOW)).not.toThrow();
  });
});

describe('accessibleBranches', () => {
  const branches = [
    { id: 'br_onchan', companyId: 'co_1' },
    { id: 'br_kirk', companyId: 'co_1' },
    { id: 'br_other', companyId: 'co_2' },
  ];

  it('returns every branch for an organisation-wide role', () => {
    expect(accessibleBranches(actor([assignment({ role: 'OWNER' })]), branches, NOW)).toHaveLength(3);
  });

  it('returns only the assigned branch for a branch-scoped role', () => {
    const locum = actor([assignment({ companyId: 'co_1', branchId: 'br_kirk' })]);
    expect(accessibleBranches(locum, branches, NOW)).toEqual(['br_kirk']);
  });

  it('returns nothing when access has expired', () => {
    const expired = actor([assignment({ validTo: new Date('2026-01-01T00:00:00Z') })]);
    expect(accessibleBranches(expired, branches, NOW)).toEqual([]);
  });
});

describe('displayRole', () => {
  it('returns the highest role held', () => {
    const mixed = actor([assignment({ role: 'RECEPTION' }), assignment({ role: 'PHARMACIST' })]);
    expect(displayRole(mixed, NOW)).toBe('PHARMACIST');
  });

  it('ignores expired assignments', () => {
    const mixed = actor([
      assignment({ role: 'RECEPTION' }),
      assignment({ role: 'OWNER', validTo: new Date('2026-01-01T00:00:00Z') }),
    ]);
    expect(displayRole(mixed, NOW)).toBe('RECEPTION');
  });
});
