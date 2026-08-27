/**
 * Scoped, database-backed access control.
 *
 * Two layers, and a request must satisfy both:
 *
 *   WHAT   the role's permission grid — module × action cells, editable by an
 *          administrator without a deployment.
 *   WHERE  the assignment — which company or branch, and between which dates.
 *
 * Most RBAC models have only the first. Karsons needs the second because a
 * locum genuinely does hold Pharmacist at Kirk Michael for a fortnight, and
 * their access has to lapse without anybody remembering to remove it.
 *
 * This module is pure. Grants come in already loaded, and it answers whether a
 * request is permitted. Loading is the caller's job, which is what keeps every
 * rule here exhaustively testable.
 *
 * It is NOT the security boundary. Postgres row-level security and `has_perm()`
 * enforce the same model at the database, so a forged request that skips this
 * code still gets nothing. This layer exists so the interface agrees with what
 * the database will allow.
 */

import { effectivePermissions, type Permission } from './permissions';

export type { Permission } from './permissions';

export interface RoleGrant {
  roleId: string;
  roleName: string;
  /** Already normalised — a non-view action without view has been dropped. */
  permissions: Set<Permission>;
  /** null company AND null branch means organisation-wide. */
  companyId: string | null;
  branchId: string | null;
  validFrom: Date;
  /** null means it does not expire. */
  validTo: Date | null;
}

export interface Actor {
  userId: string;
  organisationId: string;
  fullName: string;
  email: string;
  /** A disabled account holds no permissions at all, whatever its role says. */
  disabledAt: Date | null;
  grants: RoleGrant[];
}

/** Where an action is being performed. */
export interface ScopeTarget {
  companyId?: string | null;
  branchId?: string | null;
}

export function buildGrant(input: {
  roleId: string;
  roleName: string;
  permissions: Iterable<string>;
  companyId: string | null;
  branchId: string | null;
  validFrom: Date;
  validTo: Date | null;
}): RoleGrant {
  return { ...input, permissions: effectivePermissions(input.permissions) };
}

export function isGrantActive(grant: RoleGrant, now: Date): boolean {
  if (grant.validFrom > now) return false;
  if (grant.validTo && grant.validTo < now) return false;
  return true;
}

/**
 * Does a grant cover the target?
 *
 * Organisation-wide covers everything. Company-scoped covers every branch in
 * that company. Branch-scoped covers only that branch.
 *
 * A target with no branch and no company means "somewhere in the organisation",
 * which any grant satisfies — used for questions like "may this person review
 * repeat requests at all", ahead of knowing where.
 */
export function grantCovers(grant: RoleGrant, target: ScopeTarget): boolean {
  if (grant.companyId === null && grant.branchId === null) return true;

  if (grant.branchId !== null) {
    if (!target.branchId) return false;
    return grant.branchId === target.branchId;
  }

  if (grant.companyId !== null) {
    if (!target.companyId) return false;
    return grant.companyId === target.companyId;
  }

  return false;
}

export function activeGrants(
  actor: Actor,
  target: ScopeTarget = {},
  now = new Date(),
): RoleGrant[] {
  if (actor.disabledAt) return [];
  return actor.grants.filter((g) => isGrantActive(g, now) && grantCovers(g, target));
}

/** Every permission the actor holds at the target scope. */
export function permissionsFor(
  actor: Actor,
  target: ScopeTarget = {},
  now = new Date(),
): Set<Permission> {
  const permissions = new Set<Permission>();
  for (const grant of activeGrants(actor, target, now)) {
    for (const permission of grant.permissions) permissions.add(permission);
  }
  return permissions;
}

export function can(
  actor: Actor,
  permission: Permission,
  target: ScopeTarget = {},
  now = new Date(),
): boolean {
  // Fail closed on a disabled account before anything else is considered.
  if (actor.disabledAt) return false;

  for (const grant of activeGrants(actor, target, now)) {
    if (grant.permissions.has(permission)) return true;
  }
  return false;
}

/**
 * Administration is a CAPABILITY, not a role name.
 *
 * A custom role granted `users:edit` is genuinely an administrator, and the
 * last-administrator guard counts it. FiTech's guide flags this as an ambiguity
 * worth deciding explicitly, so it is decided here and enforced the same way in
 * the database.
 */
export function isAdmin(actor: Actor, now = new Date()): boolean {
  return can(actor, 'users:edit', {}, now);
}

export class AuthorisationError extends Error {
  constructor(
    public readonly permission: Permission,
    public readonly target: ScopeTarget,
  ) {
    super(`Not authorised to ${permission} at this location.`);
    this.name = 'AuthorisationError';
  }
}

/** Throws unless permitted. Use at the top of every server action. */
export function assertCan(
  actor: Actor,
  permission: Permission,
  target: ScopeTarget = {},
  now = new Date(),
): void {
  if (!can(actor, permission, target, now)) {
    throw new AuthorisationError(permission, target);
  }
}

export interface BranchRef {
  id: string;
  companyId: string;
}

/**
 * Branches the actor may currently act at — this is what populates the branch
 * switcher. The caller supplies the branch list; this module does no I/O.
 */
export function accessibleBranches(
  actor: Actor,
  allBranches: BranchRef[],
  now = new Date(),
): string[] {
  return allBranches
    .filter(
      (b) => activeGrants(actor, { companyId: b.companyId, branchId: b.id }, now).length > 0,
    )
    .map((b) => b.id);
}

/**
 * Highest-privilege role name held anywhere, for display only.
 *
 * Never use this for an authorisation decision — a job title says nothing about
 * what somebody may do at a particular branch on a particular day.
 */
export function displayRole(actor: Actor, now = new Date()): string | null {
  const active = actor.grants.filter((g) => isGrantActive(g, now));
  if (active.length === 0) return null;

  // Most permissions wins; ties broken alphabetically so it is stable.
  return active
    .slice()
    .sort(
      (a, b) => b.permissions.size - a.permissions.size || a.roleName.localeCompare(b.roleName),
    )[0]!.roleName;
}
