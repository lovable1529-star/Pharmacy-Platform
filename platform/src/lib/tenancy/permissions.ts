/**
 * Permission vocabulary.
 *
 * A permission is a MODULE × ACTION cell — `patients:view`, `inventory:disable`.
 * Roles are grids of these cells, stored in the database and editable by an
 * administrator, so adding a role never means a deployment.
 *
 * Two rules hold everywhere, in the UI and in Postgres:
 *
 *   1. Any non-view action implies view. You cannot edit what you cannot see,
 *      so `patients:edit` without `patients:view` grants nothing.
 *   2. A disabled user has no permissions at all, regardless of their role or
 *      how valid their session token still is.
 *
 * This file is the single source the UI, the server checks and the database
 * CHECK constraint are all generated from. Adding a module means changing this
 * list and shipping a migration that widens the constraint — the alternative,
 * a module the database silently rejects, is a worse failure.
 *
 * Karsons adds one dimension FiTech's model does not have: WHERE and WHEN. The
 * grid says what a role may do; the assignment says at which branch and between
 * which dates. A locum holding Pharmacist at Kirk Michael for a fortnight is a
 * real requirement from the client's documents, so both layers are enforced.
 */

export const PERM_MODULES = [
  { key: 'patients', label: 'Patients' },
  { key: 'consultations', label: 'Consultations' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'repeat_care', label: 'Repeat Care' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'services', label: 'Services & Forms' },
  { key: 'communications', label: 'Communications' },
  { key: 'reports', label: 'Reports' },
  { key: 'compliance', label: 'Compliance & Audit' },
  { key: 'settings', label: 'Settings & Reference Data' },
  { key: 'users', label: 'Users & Roles' },
] as const;

export type PermModule = (typeof PERM_MODULES)[number]['key'];

export const PERM_ACTIONS = [
  { key: 'view', label: 'View', hint: 'See the screen and its records' },
  { key: 'add', label: 'Add', hint: 'Create new records' },
  { key: 'edit', label: 'Edit', hint: 'Change existing records' },
  { key: 'delete', label: 'Delete', hint: 'Archive or remove' },
  { key: 'disable', label: 'Disable', hint: 'Withdraw without deleting' },
  { key: 'export', label: 'Export', hint: 'Download as CSV or PDF' },
] as const;

export type PermAction = (typeof PERM_ACTIONS)[number]['key'];

/** `patients:view`. The string form used everywhere. */
export type Permission = `${PermModule}:${PermAction}`;

export const MODULE_KEYS = PERM_MODULES.map((m) => m.key);
export const ACTION_KEYS = PERM_ACTIONS.map((a) => a.key);

export function permKey(module: PermModule, action: PermAction): Permission {
  return `${module}:${action}`;
}

export function parsePermission(
  value: string,
): { module: PermModule; action: PermAction } | null {
  const [module, action] = value.split(':');
  if (!module || !action) return null;
  if (!MODULE_KEYS.includes(module as PermModule)) return null;
  if (!ACTION_KEYS.includes(action as PermAction)) return null;
  return { module: module as PermModule, action: action as PermAction };
}

export function moduleLabel(key: PermModule): string {
  return PERM_MODULES.find((m) => m.key === key)?.label ?? key;
}

/**
 * Applies rule 1 to a draft grid: ticking any action ticks view, and clearing
 * view clears the whole module row.
 *
 * The permission editor calls this on every change so what the administrator
 * sees on screen is exactly what the database will store — no silent
 * normalisation at save time, which is how a grid ends up disagreeing with
 * itself.
 */
export function normaliseGrid(permissions: Iterable<string>): Set<Permission> {
  const grid = new Set<Permission>();
  const byModule = new Map<PermModule, Set<PermAction>>();

  for (const raw of permissions) {
    const parsed = parsePermission(raw);
    if (!parsed) continue;
    const actions = byModule.get(parsed.module) ?? new Set<PermAction>();
    actions.add(parsed.action);
    byModule.set(parsed.module, actions);
  }

  for (const [module, actions] of byModule) {
    // A row with only non-view actions is meaningless; grant view too.
    if (actions.size > 0) actions.add('view');
    for (const action of actions) grid.add(permKey(module, action));
  }

  return grid;
}

/** Toggling one cell, with rule 1 applied. Returns a new set. */
export function toggleCell(
  current: Set<Permission>,
  module: PermModule,
  action: PermAction,
): Set<Permission> {
  const next = new Set(current);
  const key = permKey(module, action);

  if (next.has(key)) {
    // Unticking view clears the entire row — you cannot act on what you cannot see.
    if (action === 'view') {
      for (const a of ACTION_KEYS) next.delete(permKey(module, a));
    } else {
      next.delete(key);
    }
  } else {
    next.add(key);
    if (action !== 'view') next.add(permKey(module, 'view'));
  }

  return next;
}

/** Every cell for a module — the "tick the whole row" affordance. */
export function setModuleRow(
  current: Set<Permission>,
  module: PermModule,
  enabled: boolean,
): Set<Permission> {
  const next = new Set(current);
  for (const action of ACTION_KEYS) {
    const key = permKey(module, action);
    if (enabled) next.add(key);
    else next.delete(key);
  }
  return next;
}

/**
 * The permissions a role grants, given its stored grid.
 *
 * Rule 1 is applied on read as well as on write. A grid edited directly in the
 * database — bypassing the editor — must not be able to grant `edit` without
 * `view` and produce behaviour the interface never shows.
 */
export function effectivePermissions(stored: Iterable<string>): Set<Permission> {
  const grid = new Set<Permission>();

  for (const raw of stored) {
    const parsed = parsePermission(raw);
    if (!parsed) continue;
    grid.add(permKey(parsed.module, parsed.action));
  }

  for (const module of MODULE_KEYS) {
    const hasView = grid.has(permKey(module, 'view'));
    if (hasView) continue;
    // No view: drop everything else for that module.
    for (const action of ACTION_KEYS) grid.delete(permKey(module, action));
  }

  return grid;
}

/**
 * The two built-in roles, created by migration and protected from deletion or
 * renaming by a database trigger.
 *
 * Admin is defined by holding `users:edit` rather than by being named "Admin".
 * FiTech's guide flags this ambiguity explicitly, so the choice is made once
 * here: administration is a CAPABILITY. A custom role granted `users:edit` is
 * genuinely an administrator, and the last-administrator guard counts it.
 */
export const SYSTEM_ROLES = {
  admin: {
    name: 'Admin',
    description: 'Full access to every module, including users and roles.',
    permissions: MODULE_KEYS.flatMap((m) => ACTION_KEYS.map((a) => permKey(m, a))),
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only across every screen. The safe default for a new account.',
    permissions: MODULE_KEYS.map((m) => permKey(m, 'view')),
  },
} as const;

/**
 * Suggested starting roles for a pharmacy, created alongside the system roles
 * but fully editable and deletable — these are a sensible default, not a
 * constraint.
 *
 * Note what a pharmacist deliberately does NOT get: `services:edit`. Authoring
 * clinical rules and forms is an administrative act with its own audit trail,
 * separate from using them.
 */
export const SUGGESTED_ROLES = [
  {
    name: 'Pharmacist',
    description: 'Full clinical access — consultations, repeat care, inventory.',
    permissions: [
      'patients:view', 'patients:add', 'patients:edit',
      'consultations:view', 'consultations:add', 'consultations:edit', 'consultations:export',
      'appointments:view', 'appointments:add', 'appointments:edit',
      'repeat_care:view', 'repeat_care:edit',
      'inventory:view', 'inventory:add', 'inventory:edit', 'inventory:disable',
      'services:view',
      'communications:view',
      'reports:view', 'reports:export',
      'compliance:view',
    ] as Permission[],
  },
  {
    name: 'Technician',
    description: 'Supports the clinical team. Cannot review repeat requests.',
    permissions: [
      'patients:view', 'patients:add', 'patients:edit',
      'consultations:view',
      'appointments:view', 'appointments:add', 'appointments:edit',
      'inventory:view', 'inventory:add', 'inventory:edit',
      'services:view',
      'reports:view',
    ] as Permission[],
  },
  {
    name: 'Reception',
    description: 'Front of house — booking and patient records only.',
    permissions: [
      'patients:view', 'patients:add', 'patients:edit',
      'appointments:view', 'appointments:add', 'appointments:edit',
      'services:view',
    ] as Permission[],
  },
] as const;
