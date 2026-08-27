import { describe, it, expect } from 'vitest';
import {
  normaliseGrid, toggleCell, setModuleRow, effectivePermissions,
  parsePermission, permKey, SYSTEM_ROLES, SUGGESTED_ROLES,
  type Permission,
} from '@/lib/tenancy/permissions';
import {
  can, assertCan, isAdmin, buildGrant, accessibleBranches, displayRole,
  permissionsFor, AuthorisationError, type Actor,
} from '@/lib/tenancy/scope';

const NOW = new Date('2026-09-10T10:00:00Z');

function actor(over: Partial<Actor> = {}): Actor {
  return {
    userId: 'u1',
    organisationId: 'org1',
    fullName: 'Test User',
    email: 'test@example.im',
    disabledAt: null,
    grants: [],
    ...over,
  };
}

function grant(over: Partial<Parameters<typeof buildGrant>[0]> = {}) {
  return buildGrant({
    roleId: 'r1',
    roleName: 'Pharmacist',
    permissions: ['patients:view', 'patients:edit'],
    companyId: null,
    branchId: null,
    validFrom: new Date('2026-01-01'),
    validTo: null,
    ...over,
  });
}

// ─────────────────────────────────────────────────────────────

describe('rule 1 — any non-view action implies view', () => {
  it('adds view when a non-view action is ticked', () => {
    const next = toggleCell(new Set(), 'patients', 'edit');
    expect(next.has('patients:view')).toBe(true);
    expect(next.has('patients:edit')).toBe(true);
  });

  it('clears the whole row when view is unticked', () => {
    let grid = new Set<Permission>();
    for (const a of ['view', 'add', 'edit', 'delete'] as const) {
      grid = toggleCell(grid, 'inventory', a);
    }
    expect(grid.size).toBe(4);

    grid = toggleCell(grid, 'inventory', 'view');
    expect([...grid].filter((p) => p.startsWith('inventory:'))).toEqual([]);
  });

  it('leaves other modules alone when clearing a row', () => {
    let grid = new Set<Permission>(['patients:view', 'inventory:view', 'inventory:edit']);
    grid = toggleCell(grid, 'inventory', 'view');
    expect(grid.has('patients:view')).toBe(true);
  });

  it('normalises a grid that arrives without view', () => {
    const grid = normaliseGrid(['reports:export']);
    expect(grid.has('reports:view')).toBe(true);
  });

  it('drops a stored non-view action that has no view — even from the database', () => {
    // A grid edited directly in SQL must not grant behaviour the editor cannot show.
    const effective = effectivePermissions(['patients:edit', 'patients:delete']);
    expect(effective.size).toBe(0);
  });

  it('keeps a module whose view is present', () => {
    const effective = effectivePermissions(['patients:view', 'patients:edit']);
    expect(effective.has('patients:edit')).toBe(true);
  });
});

describe('grid editing helpers', () => {
  it('ticks a whole row', () => {
    const grid = setModuleRow(new Set(), 'users', true);
    expect(grid.size).toBe(6);
  });

  it('clears a whole row', () => {
    const full = setModuleRow(new Set(), 'users', true);
    expect(setModuleRow(full, 'users', false).size).toBe(0);
  });

  it('rejects an unknown module', () => {
    expect(parsePermission('wormholes:view')).toBeNull();
  });

  it('rejects an unknown action', () => {
    expect(parsePermission('patients:teleport')).toBeNull();
  });

  it('round-trips a valid cell', () => {
    expect(parsePermission(permKey('patients', 'view'))).toEqual({
      module: 'patients', action: 'view',
    });
  });
});

// ─────────────────────────────────────────────────────────────

describe('a disabled account holds nothing', () => {
  const disabled = actor({
    disabledAt: new Date('2026-09-01'),
    grants: [grant({ permissions: SYSTEM_ROLES.admin.permissions })],
  });

  it('is refused even with a full admin grid', () => {
    expect(can(disabled, 'patients:view', {}, NOW)).toBe(false);
    expect(can(disabled, 'users:edit', {}, NOW)).toBe(false);
  });

  it('is not an administrator', () => {
    expect(isAdmin(disabled, NOW)).toBe(false);
  });

  it('has no permissions at any scope', () => {
    expect(permissionsFor(disabled, {}, NOW).size).toBe(0);
  });

  it('can reach no branches', () => {
    expect(accessibleBranches(disabled, [{ id: 'b1', companyId: 'c1' }], NOW)).toEqual([]);
  });
});

describe('where — branch scoping', () => {
  const locum = actor({
    grants: [grant({ roleName: 'Locum', branchId: 'kirk', companyId: 'co1' })],
  });

  it('grants at the branch they cover', () => {
    expect(can(locum, 'patients:view', { branchId: 'kirk', companyId: 'co1' }, NOW)).toBe(true);
  });

  it('refuses at another branch', () => {
    expect(can(locum, 'patients:view', { branchId: 'onchan', companyId: 'co1' }, NOW)).toBe(false);
  });

  it('refuses when no branch is supplied, since the grant is branch-scoped', () => {
    expect(can(locum, 'patients:view', {}, NOW)).toBe(false);
  });

  it('a company-scoped grant covers every branch in that company', () => {
    const areaManager = actor({ grants: [grant({ companyId: 'co1', branchId: null })] });
    expect(can(areaManager, 'patients:view', { branchId: 'kirk', companyId: 'co1' }, NOW)).toBe(true);
    expect(can(areaManager, 'patients:view', { branchId: 'x', companyId: 'co2' }, NOW)).toBe(false);
  });

  it('an organisation-wide grant covers everything', () => {
    const owner = actor({ grants: [grant()] });
    expect(can(owner, 'patients:view', { branchId: 'anywhere' }, NOW)).toBe(true);
    expect(can(owner, 'patients:view', {}, NOW)).toBe(true);
  });

  it('lists only the branches actually covered', () => {
    const branches = [
      { id: 'onchan', companyId: 'co1' },
      { id: 'kirk', companyId: 'co1' },
    ];
    expect(accessibleBranches(locum, branches, NOW)).toEqual(['kirk']);
  });
});

describe('when — validity dates', () => {
  it('refuses before the assignment starts', () => {
    const future = actor({ grants: [grant({ validFrom: new Date('2026-12-01') })] });
    expect(can(future, 'patients:view', {}, NOW)).toBe(false);
  });

  it('refuses after it expires — the locum fortnight lapsing on its own', () => {
    const expired = actor({
      grants: [grant({
        validFrom: new Date('2026-09-08'),
        validTo: new Date('2026-09-09T23:59:59Z'),
      })],
    });
    expect(can(expired, 'patients:view', {}, NOW)).toBe(false);
  });

  it('grants inside the window', () => {
    const current = actor({
      grants: [grant({
        validFrom: new Date('2026-09-08'),
        validTo: new Date('2026-09-22'),
      })],
    });
    expect(can(current, 'patients:view', {}, NOW)).toBe(true);
  });

  it('treats a null end date as never expiring', () => {
    expect(can(actor({ grants: [grant({ validTo: null })] }), 'patients:view', {}, NOW)).toBe(true);
  });
});

describe('administration is a capability, not a role name', () => {
  it('treats any role holding users:edit as an administrator', () => {
    const custom = actor({
      grants: [grant({ roleName: 'Practice Manager', permissions: ['users:view', 'users:edit'] })],
    });
    expect(isAdmin(custom, NOW)).toBe(true);
  });

  it('does not treat a role merely named Admin as one', () => {
    const impostor = actor({
      grants: [grant({ roleName: 'Admin', permissions: ['patients:view'] })],
    });
    expect(isAdmin(impostor, NOW)).toBe(false);
  });
});

describe('assertCan', () => {
  it('throws a typed error naming the permission', () => {
    const viewer = actor({ grants: [grant({ permissions: ['patients:view'] })] });
    try {
      assertCan(viewer, 'patients:delete', {}, NOW);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorisationError);
      expect((error as AuthorisationError).permission).toBe('patients:delete');
    }
  });

  it('is silent when permitted', () => {
    const owner = actor({ grants: [grant({ permissions: SYSTEM_ROLES.admin.permissions })] });
    expect(() => assertCan(owner, 'patients:delete', {}, NOW)).not.toThrow();
  });
});

describe('combining several grants', () => {
  it('unions permissions across roles at the same branch', () => {
    const dual = actor({
      grants: [
        grant({ roleId: 'a', permissions: ['patients:view'] }),
        grant({ roleId: 'b', permissions: ['inventory:view', 'inventory:edit'] }),
      ],
    });
    expect(can(dual, 'patients:view', {}, NOW)).toBe(true);
    expect(can(dual, 'inventory:edit', {}, NOW)).toBe(true);
  });

  it('does not leak a branch-scoped permission to another branch', () => {
    const mixed = actor({
      grants: [
        grant({ roleId: 'a', permissions: ['patients:view'], branchId: null, companyId: null }),
        // view is required alongside disable — rule 1 would otherwise drop the
        // whole row, which is what a first draft of this fixture discovered.
        grant({
          roleId: 'b',
          permissions: ['inventory:view', 'inventory:disable'],
          branchId: 'kirk',
          companyId: 'co1',
        }),
      ],
    });
    expect(can(mixed, 'inventory:disable', { branchId: 'kirk', companyId: 'co1' }, NOW)).toBe(true);
    expect(can(mixed, 'inventory:disable', { branchId: 'onchan', companyId: 'co1' }, NOW)).toBe(false);
    expect(can(mixed, 'patients:view', { branchId: 'onchan', companyId: 'co1' }, NOW)).toBe(true);
  });

  it('shows the most privileged role name for display', () => {
    const dual = actor({
      grants: [
        grant({ roleId: 'a', roleName: 'Viewer', permissions: ['patients:view'] }),
        grant({ roleId: 'b', roleName: 'Admin', permissions: SYSTEM_ROLES.admin.permissions }),
      ],
    });
    expect(displayRole(dual, NOW)).toBe('Admin');
  });
});

describe('seeded roles', () => {
  it('gives Admin every cell', () => {
    expect(SYSTEM_ROLES.admin.permissions.length).toBe(11 * 6);
  });

  it('gives Viewer view on every module and nothing else', () => {
    expect(SYSTEM_ROLES.viewer.permissions.every((p) => p.endsWith(':view'))).toBe(true);
  });

  it('does not let a pharmacist author clinical rules', () => {
    const pharmacist = SUGGESTED_ROLES.find((r) => r.name === 'Pharmacist')!;
    expect(pharmacist.permissions).toContain('services:view');
    expect(pharmacist.permissions).not.toContain('services:edit');
  });

  it('does not let a technician review repeat requests', () => {
    const technician = SUGGESTED_ROLES.find((r) => r.name === 'Technician')!;
    expect(technician.permissions.some((p) => p.startsWith('repeat_care:'))).toBe(false);
  });

  it('gives nobody but Admin access to users', () => {
    for (const role of SUGGESTED_ROLES) {
      expect(role.permissions.some((p) => p.startsWith('users:'))).toBe(false);
    }
  });

  it('every seeded role satisfies rule 1', () => {
    for (const role of [...SUGGESTED_ROLES, SYSTEM_ROLES.admin, SYSTEM_ROLES.viewer]) {
      const effective = effectivePermissions(role.permissions);
      expect(effective.size).toBe(role.permissions.length);
    }
  });
});
