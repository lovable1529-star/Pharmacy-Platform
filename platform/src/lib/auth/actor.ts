/**
 * Resolving the acting user.
 *
 * Turns a Supabase session into an Actor — the user, whether they are disabled,
 * and every role grant they hold with its permission grid already loaded.
 *
 * Nothing else in the application may invent an Actor. That matters: an
 * organisationId supplied by a client request must never be trusted, because it
 * would let anyone read another pharmacy group's records by editing a form post.
 */

import { cache } from 'react';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { appUser, roleAssignment, role, rolePermission, branch, company } from '@/lib/db/schema';
import { getSessionUser } from '@/lib/supabase/server';
import { buildGrant, type Actor, type RoleGrant } from '@/lib/tenancy/scope';

export class NotAuthenticatedError extends Error {
  constructor() {
    super('You are not signed in.');
    this.name = 'NotAuthenticatedError';
  }
}

export class NoAccountError extends Error {
  constructor(public readonly email: string) {
    super(`No staff account exists for ${email}. An administrator must invite you.`);
    this.name = 'NoAccountError';
  }
}

export class AccountDisabledError extends Error {
  constructor() {
    super('This account has been disabled. Please speak to an administrator.');
    this.name = 'AccountDisabledError';
  }
}

/**
 * Resolves the signed-in user and their grants. Throws if not signed in.
 *
 * Memoised per request. This runs two queries on top of the auth round-trip,
 * and the staff layout and the page it renders each need it — without `cache()`
 * every navigation resolves the same actor twice before doing any real work.
 *
 * Request-scoped and no wider: a permission decision that outlived its request
 * would keep answering after a role was revoked.
 */
export const getActor = cache(async function getActor(): Promise<Actor> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) throw new NotAuthenticatedError();

  const rows = await db
    .select()
    .from(appUser)
    .where(and(eq(appUser.id, sessionUser.id), isNull(appUser.archivedAt)))
    .limit(1);

  const user = rows[0];
  if (!user) throw new NoAccountError(sessionUser.email ?? 'this account');

  // A disabled account resolves to an Actor with no grants rather than an
  // error, so pages can render a clear message instead of a redirect loop.
  if (user.disabledAt) {
    return {
      userId: user.id,
      organisationId: user.organisationId,
      fullName: user.fullName,
      email: user.email,
      disabledAt: user.disabledAt,
      grants: [],
    };
  }

  const assignmentRows = await db
    .select({
      assignmentId: roleAssignment.id,
      roleId: role.id,
      roleName: role.name,
      companyId: roleAssignment.companyId,
      branchId: roleAssignment.branchId,
      validFrom: roleAssignment.validFrom,
      validTo: roleAssignment.validTo,
      module: rolePermission.module,
      action: rolePermission.action,
    })
    .from(roleAssignment)
    .innerJoin(role, eq(roleAssignment.roleId, role.id))
    .leftJoin(rolePermission, eq(rolePermission.roleId, role.id))
    .where(eq(roleAssignment.userId, user.id));

  // One row per permission cell, so fold them back into one grant per assignment.
  const byAssignment = new Map<string, {
    roleId: string; roleName: string;
    companyId: string | null; branchId: string | null;
    validFrom: Date; validTo: Date | null;
    permissions: string[];
  }>();

  for (const row of assignmentRows) {
    const existing = byAssignment.get(row.assignmentId);
    const cell = row.module && row.action ? `${row.module}:${row.action}` : null;

    if (existing) {
      if (cell) existing.permissions.push(cell);
    } else {
      byAssignment.set(row.assignmentId, {
        roleId: row.roleId,
        roleName: row.roleName,
        companyId: row.companyId,
        branchId: row.branchId,
        validFrom: row.validFrom,
        validTo: row.validTo,
        permissions: cell ? [cell] : [],
      });
    }
  }

  const grants: RoleGrant[] = [...byAssignment.values()].map(buildGrant);

  return {
    userId: user.id,
    organisationId: user.organisationId,
    fullName: user.fullName,
    email: user.email,
    disabledAt: null,
    grants,
  };
});

/** Same, but returns null instead of throwing — for pages that render either way. */
export const getActorOrNull = cache(async function getActorOrNull(): Promise<Actor | null> {
  try {
    return await getActor();
  } catch {
    return null;
  }
});

export interface BranchContext {
  id: string;
  name: string;
  code: string;
  companyId: string;
  companyName: string;
}

/**
 * Every branch in the actor's organisation, with its company. The caller filters
 * this through `accessibleBranches` to build the switcher — keeping the query
 * and the permission logic separate is what makes the permission logic testable.
 */
/**
 * Keyed on the actor object, which is stable because `getActor` is itself
 * memoised — the same request always gets the same reference back, so this
 * hits its cache rather than re-querying.
 */
export const getBranchesForActor = cache(async function getBranchesForActor(
  actor: Actor,
): Promise<BranchContext[]> {
  const rows = await db
    .select({
      id: branch.id,
      name: branch.name,
      code: branch.code,
      companyId: branch.companyId,
      companyName: company.name,
    })
    .from(branch)
    .innerJoin(company, eq(branch.companyId, company.id))
    .where(and(eq(branch.organisationId, actor.organisationId), isNull(branch.archivedAt)));

  return rows;
});
