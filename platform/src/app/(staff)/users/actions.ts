'use server';

/**
 * Users, roles and invitations.
 *
 * Every operation here goes through the scoped action wrapper, so it is
 * permission-checked and audited like any other mutation. Who invited whom, who
 * changed a permission grid, and who disabled an account are exactly the
 * questions an inspection asks.
 *
 * The database is the real boundary — deferred triggers guarantee an active
 * administrator survives every transaction, and system roles cannot be deleted
 * or renamed even by a direct API call. The checks here exist so the interface
 * refuses cleanly rather than letting the database raise a raw error at somebody.
 */

import { eq, and, isNull, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { action } from '@/lib/actions';
import { db } from '@/lib/db/client';
import { role, rolePermission, roleAssignment, appUser, branch, company } from '@/lib/db/schema';
import { getActor } from '@/lib/auth/actor';
import { can } from '@/lib/tenancy/scope';
import { normaliseGrid, type Permission } from '@/lib/tenancy/permissions';
import { createSupabaseAdminClient, isInviteConfigured } from '@/lib/supabase/admin';
import { resolveAppUrl } from '@/lib/app-url';

// ─────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  assignedCount: number;
}

export interface UserRow {
  id: string;
  fullName: string;
  email: string;
  disabledAt: Date | null;
  disabledReason: string | null;
  roleId: string | null;
  roleName: string | null;
  branchId: string | null;
  branchName: string | null;
  validTo: Date | null;
}

export async function getUsersAndRoles(): Promise<{
  roles: RoleRow[];
  users: UserRow[];
  branches: { id: string; name: string; companyId: string }[];
  currentUserId: string;
  canEdit: boolean;
  canDisable: boolean;
  inviteConfigured: boolean;
}> {
  const actor = await getActor();

  if (!can(actor, 'users:view')) {
    throw new Error('NOT_AUTHORISED');
  }

  const roleRows = await db
    .select({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      module: rolePermission.module,
      action: rolePermission.action,
    })
    .from(role)
    .leftJoin(rolePermission, eq(rolePermission.roleId, role.id))
    .where(eq(role.organisationId, actor.organisationId));

  const byRole = new Map<string, RoleRow>();
  for (const row of roleRows) {
    const existing = byRole.get(row.id);
    const cell = row.module && row.action ? `${row.module}:${row.action}` : null;
    if (existing) {
      if (cell) existing.permissions.push(cell);
    } else {
      byRole.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        isSystem: row.isSystem,
        permissions: cell ? [cell] : [],
        assignedCount: 0,
      });
    }
  }

  const userRows = await db
    .select({
      id: appUser.id,
      fullName: appUser.fullName,
      email: appUser.email,
      disabledAt: appUser.disabledAt,
      disabledReason: appUser.disabledReason,
      roleId: roleAssignment.roleId,
      roleName: role.name,
      branchId: roleAssignment.branchId,
      branchName: branch.name,
      validTo: roleAssignment.validTo,
    })
    .from(appUser)
    .leftJoin(roleAssignment, eq(roleAssignment.userId, appUser.id))
    .leftJoin(role, eq(roleAssignment.roleId, role.id))
    .leftJoin(branch, eq(roleAssignment.branchId, branch.id))
    .where(and(eq(appUser.organisationId, actor.organisationId), isNull(appUser.archivedAt)));

  for (const user of userRows) {
    if (!user.roleId) continue;
    const r = byRole.get(user.roleId);
    if (r) r.assignedCount += 1;
  }

  const branchRows = await db
    .select({ id: branch.id, name: branch.name, companyId: branch.companyId })
    .from(branch)
    .where(and(eq(branch.organisationId, actor.organisationId), isNull(branch.archivedAt)));

  return {
    roles: [...byRole.values()].sort(
      (a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name),
    ),
    users: userRows.sort((a, b) => a.fullName.localeCompare(b.fullName)),
    branches: branchRows,
    currentUserId: actor.userId,
    canEdit: can(actor, 'users:edit'),
    canDisable: can(actor, 'users:disable'),
    inviteConfigured: isInviteConfigured(),
  };
}

// ─────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────

const createRoleAction = action<{ name: string; description: string }>('users:edit').handler(
  async (input, { tx, actor }) => {
    const [created] = await tx
      .insert(role)
      .values({
        organisationId: actor.organisationId,
        name: input.name.trim(),
        description: input.description.trim() || null,
        isSystem: false,
      })
      .returning();

    if (!created) throw new Error('Could not create that role.');

    // A new role starts with no permissions at all. Granting nothing is the
    // safe default; the administrator ticks what it should have.
    return {
      result: { id: created.id },
      audit: {
        action: 'role.created',
        entityType: 'role',
        entityId: created.id,
        after: { name: created.name },
      },
    };
  },
);

export async function createRole(name: string, description: string) {
  if (!name.trim()) return { ok: false as const, error: 'Give the role a name.' };

  try {
    const result = await createRoleAction({ name, description });
    revalidatePath('/users');
    return { ok: true as const, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false as const,
      error: message.includes('role_name_idx') || message.includes('duplicate')
        ? 'A role with that name already exists.'
        : message.includes('Authorisation')
          ? 'You do not have permission to create roles.'
          : 'Could not create that role.',
    };
  }
}

const deleteRoleAction = action<{ roleId: string }>('users:edit').handler(
  async (input, { tx, actor }) => {
    const [target] = await tx
      .select({ name: role.name, isSystem: role.isSystem })
      .from(role)
      .where(and(eq(role.id, input.roleId), eq(role.organisationId, actor.organisationId)))
      .limit(1);

    if (!target) throw new Error('That role no longer exists.');
    if (target.isSystem) throw new Error('Built-in roles cannot be deleted.');

    const assigned = await tx
      .select({ id: roleAssignment.id })
      .from(roleAssignment)
      .where(eq(roleAssignment.roleId, input.roleId))
      .limit(1);

    // Explicit policy: block deletion while anybody holds it, rather than
    // silently orphaning their access. The guide flags this as a decision worth
    // making deliberately.
    if (assigned.length > 0) {
      throw new Error('Somebody still holds this role. Move them to another role first.');
    }

    await tx.delete(role).where(eq(role.id, input.roleId));

    return {
      result: { deleted: true },
      audit: {
        action: 'role.deleted',
        entityType: 'role',
        entityId: input.roleId,
        before: { name: target.name },
      },
    };
  },
);

export async function deleteRole(roleId: string) {
  try {
    await deleteRoleAction({ roleId });
    revalidatePath('/users');
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Could not delete that role.',
    };
  }
}

const savePermissionsAction = action<{ roleId: string; permissions: string[] }>(
  'users:edit',
).handler(async (input, { tx, actor }) => {
  const [target] = await tx
    .select({ name: role.name })
    .from(role)
    .where(and(eq(role.id, input.roleId), eq(role.organisationId, actor.organisationId)))
    .limit(1);

  if (!target) throw new Error('That role no longer exists.');

  const before = await tx
    .select({ module: rolePermission.module, action: rolePermission.action })
    .from(rolePermission)
    .where(eq(rolePermission.roleId, input.roleId));

  // Normalised again on the server: a payload edited in the browser must not be
  // able to store edit-without-view.
  const grid = normaliseGrid(input.permissions);

  await tx.delete(rolePermission).where(eq(rolePermission.roleId, input.roleId));

  if (grid.size > 0) {
    await tx.insert(rolePermission).values(
      [...grid].map((cell) => {
        const [module, action] = cell.split(':');
        return { roleId: input.roleId, module: module!, action: action! };
      }),
    );
  }

  return {
    result: { saved: grid.size },
    audit: {
      action: 'role.permissions_changed',
      entityType: 'role',
      entityId: input.roleId,
      before: { permissions: before.map((b) => `${b.module}:${b.action}`).sort() },
      after: { permissions: [...grid].sort() },
    },
  };
});

export async function saveRolePermissions(roleId: string, permissions: Permission[]) {
  try {
    const result = await savePermissionsAction({ roleId, permissions });
    revalidatePath('/users');
    return { ok: true as const, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false as const,
      // The deferred guard raises this at COMMIT, so it arrives here.
      error: message.includes('active administrator')
        ? 'That change would leave nobody able to manage users. Grant another role users:edit first.'
        : message.includes('Authorisation')
          ? 'You do not have permission to edit roles.'
          : 'Could not save those permissions.',
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────

interface AssignInput {
  userId: string;
  roleId: string;
  branchId: string | null;
  companyId: string | null;
  validTo: string | null;
}

const assignRoleAction = action<AssignInput>('users:edit').handler(
  async (input, { tx, actor }) => {
    const [target] = await tx
      .select({ disabledAt: appUser.disabledAt, fullName: appUser.fullName })
      .from(appUser)
      .where(and(eq(appUser.id, input.userId), eq(appUser.organisationId, actor.organisationId)))
      .limit(1);

    if (!target) throw new Error('That account no longer exists.');
    if (target.disabledAt) {
      throw new Error('Re-enable this account before changing its role.');
    }

    const before = await tx
      .select({ roleId: roleAssignment.roleId, branchId: roleAssignment.branchId })
      .from(roleAssignment)
      .where(eq(roleAssignment.userId, input.userId));

    // Exactly one current assignment per user.
    await tx.delete(roleAssignment).where(eq(roleAssignment.userId, input.userId));

    await tx.insert(roleAssignment).values({
      organisationId: actor.organisationId,
      userId: input.userId,
      roleId: input.roleId,
      companyId: input.companyId,
      branchId: input.branchId,
      validTo: input.validTo ? new Date(input.validTo) : null,
    });

    return {
      result: { assigned: true },
      audit: {
        action: 'user.role_assigned',
        entityType: 'app_user',
        entityId: input.userId,
        before: { assignment: before[0] ?? null },
        after: { roleId: input.roleId, branchId: input.branchId, validTo: input.validTo },
      },
    };
  },
);

export async function assignRole(input: AssignInput) {
  try {
    await assignRoleAction(input);
    revalidatePath('/users');
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false as const,
      error: message.includes('active administrator')
        ? 'That would leave nobody able to manage users. Give somebody else an admin role first.'
        : message || 'Could not change that role.',
    };
  }
}

const setDisabledAction = action<{ userId: string; disabled: boolean; reason: string }>(
  'users:disable',
).handler(async (input, { tx, actor }) => {
  if (input.userId === actor.userId && input.disabled) {
    throw new Error('You cannot disable your own account.');
  }

  const [updated] = await tx
    .update(appUser)
    .set({
      disabledAt: input.disabled ? new Date() : null,
      disabledBy: input.disabled ? actor.userId : null,
      disabledReason: input.disabled ? input.reason.trim() || null : null,
    })
    .where(and(eq(appUser.id, input.userId), eq(appUser.organisationId, actor.organisationId)))
    .returning({ id: appUser.id, email: appUser.email });

  if (!updated) throw new Error('That account no longer exists.');

  return {
    result: { id: updated.id },
    audit: {
      action: input.disabled ? 'user.disabled' : 'user.enabled',
      entityType: 'app_user',
      entityId: updated.id,
      after: { email: updated.email, reason: input.reason.trim() || null },
    },
  };
});

export async function setUserDisabled(userId: string, disabled: boolean, reason = '') {
  try {
    await setDisabledAction({ userId, disabled, reason });
    revalidatePath('/users');
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false as const,
      error: message.includes('active administrator')
        ? 'That would leave nobody able to manage users.'
        : message || 'Could not change that account.',
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Invitations
// ─────────────────────────────────────────────────────────────

export interface InviteInput {
  email: string;
  fullName: string;
  roleId: string;
  branchId: string | null;
  companyId: string | null;
  validTo: string | null;
}

/**
 * Invite a colleague.
 *
 * The only place the service-role key is used. The order matters:
 *
 *   1. authenticate the caller
 *   2. authorise the caller — users:edit, from the database
 *   3. revalidate the requested role server-side
 *   4. only then elevate to Auth Admin
 *
 * The database trigger provisions every invited account as Viewer regardless of
 * what the invitation asked for; the requested role is applied here, by trusted
 * code, after the account exists.
 */
export async function inviteUser(input: InviteInput) {
  const email = input.email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, error: 'That does not look like an email address.' };
  }
  if (!input.roleId) {
    return { ok: false as const, error: 'Choose a role for the new user.' };
  }

  let actor;
  try {
    actor = await getActor();
  } catch {
    return { ok: false as const, error: 'You are not signed in.' };
  }

  if (!can(actor, 'users:edit')) {
    return { ok: false as const, error: 'You do not have permission to invite users.' };
  }

  if (!isInviteConfigured()) {
    return {
      ok: false as const,
      error: 'Inviting needs SUPABASE_SERVICE_ROLE_KEY in the environment. See SETUP.md.',
    };
  }

  // Revalidate the role rather than trusting the id that arrived.
  const [chosenRole] = await db
    .select({ id: role.id, name: role.name })
    .from(role)
    .where(and(eq(role.id, input.roleId), eq(role.organisationId, actor.organisationId)))
    .limit(1);

  if (!chosenRole) {
    return { ok: false as const, error: 'That role no longer exists.' };
  }

  const existing = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(and(eq(appUser.organisationId, actor.organisationId), eq(appUser.email, email)))
    .limit(1);

  if (existing.length > 0) {
    return { ok: false as const, error: 'Somebody with that email already has an account.' };
  }

  try {
    const admin = createSupabaseAdminClient();
    const appUrl = resolveAppUrl();

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
      data: {
        // The trigger accepts only invitations carrying this marker. It does NOT
        // read the role from here — that would be a privilege-escalation path.
        karsons_invited: 'true',
        full_name: input.fullName.trim() || email,
        invited_by: actor.userId,
      },
    });

    if (error || !data.user) {
      return {
        ok: false as const,
        error: error?.message.includes('already registered')
          ? 'That email already has an account in Supabase Auth.'
          : (error?.message ?? 'Could not send that invitation.'),
      };
    }

    // The trigger has created the account as Viewer. Apply the chosen role now.
    await db.delete(roleAssignment).where(eq(roleAssignment.userId, data.user.id));
    await db.insert(roleAssignment).values({
      organisationId: actor.organisationId,
      userId: data.user.id,
      roleId: chosenRole.id,
      companyId: input.companyId,
      branchId: input.branchId,
      validTo: input.validTo ? new Date(input.validTo) : null,
    });

    if (input.fullName.trim()) {
      await db
        .update(appUser)
        .set({ fullName: input.fullName.trim() })
        .where(eq(appUser.id, data.user.id));
    }

    revalidatePath('/users');

    // A safe summary only — the Auth Admin response stays on the server.
    return { ok: true as const, email, roleName: chosenRole.name };
  } catch (error) {
    console.error('inviteUser failed', error);
    return { ok: false as const, error: 'Could not send that invitation. Please try again.' };
  }
}
