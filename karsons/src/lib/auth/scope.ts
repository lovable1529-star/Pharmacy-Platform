/**
 * Scoped role-based access control.
 *
 * Users belong to an Organisation and hold role assignments scoped downward.
 * A locum may hold PHARMACIST at Kirk Michael only, valid for a fortnight.
 * The owner holds OWNER organisation-wide.
 *
 * Every server action begins by resolving scope. There is no code path that
 * touches tenant data without one — see `withAction()` in `src/lib/actions.ts`,
 * which makes that structurally impossible rather than merely conventional.
 *
 * This module is pure. It takes assignments and a request, and answers whether
 * the request is permitted. Loading the assignments is the caller's job.
 */

export type Role =
  | 'OWNER'
  | 'ADMIN'
  | 'PHARMACIST'
  | 'TECHNICIAN'
  | 'RECEPTION'
  | 'READ_ONLY';

export type Permission =
  // Patients
  | 'patient.read'
  | 'patient.write'
  | 'patient.merge'
  // Clinical
  | 'consultation.read'
  | 'consultation.perform'
  | 'prescription.issue'
  | 'repeat.review'
  // Scheduling
  | 'appointment.read'
  | 'appointment.write'
  // Inventory
  | 'inventory.read'
  | 'inventory.write'
  | 'inventory.recall'
  // Configuration
  | 'service.read'
  | 'service.write'
  | 'ruleset.publish'
  // Administration
  | 'staff.manage'
  | 'company.manage'
  | 'billing.manage'
  // Compliance
  | 'audit.read'
  | 'compliance.manage';

/**
 * Permissions granted by each role.
 *
 * Deliberately explicit rather than hierarchical. A hierarchy invites the
 * assumption that "higher" roles inherit everything, which is how a
 * receptionist quietly ends up able to issue prescriptions.
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [
    'patient.read', 'patient.write', 'patient.merge',
    'consultation.read', 'consultation.perform', 'prescription.issue', 'repeat.review',
    'appointment.read', 'appointment.write',
    'inventory.read', 'inventory.write', 'inventory.recall',
    'service.read', 'service.write', 'ruleset.publish',
    'staff.manage', 'company.manage', 'billing.manage',
    'audit.read', 'compliance.manage',
  ],
  ADMIN: [
    'patient.read', 'patient.write', 'patient.merge',
    'consultation.read', 'repeat.review',
    'appointment.read', 'appointment.write',
    'inventory.read', 'inventory.write', 'inventory.recall',
    'service.read', 'service.write', 'ruleset.publish',
    'staff.manage', 'company.manage',
    'audit.read', 'compliance.manage',
  ],
  // Note: a pharmacist cannot publish rulesets. Authoring clinical rules is an
  // administrative act with its own audit trail, separate from using them.
  PHARMACIST: [
    'patient.read', 'patient.write',
    'consultation.read', 'consultation.perform', 'prescription.issue', 'repeat.review',
    'appointment.read', 'appointment.write',
    'inventory.read', 'inventory.write', 'inventory.recall',
    'service.read',
    'audit.read',
  ],
  TECHNICIAN: [
    'patient.read', 'patient.write',
    'consultation.read',
    'appointment.read', 'appointment.write',
    'inventory.read', 'inventory.write',
    'service.read',
  ],
  RECEPTION: [
    'patient.read', 'patient.write',
    'appointment.read', 'appointment.write',
    'service.read',
  ],
  READ_ONLY: [
    'patient.read', 'consultation.read', 'appointment.read',
    'inventory.read', 'service.read',
  ],
};

export interface RoleAssignment {
  role: Role;
  /** null means the role applies across the whole organisation. */
  companyId: string | null;
  branchId: string | null;
  validFrom: Date;
  /** null means it does not expire. */
  validTo: Date | null;
}

export interface Actor {
  userId: string;
  organisationId: string;
  assignments: RoleAssignment[];
}

/** Where an action is being performed. */
export interface ScopeTarget {
  companyId?: string | null;
  branchId?: string | null;
}

export function isAssignmentActive(assignment: RoleAssignment, now: Date): boolean {
  if (assignment.validFrom > now) return false;
  if (assignment.validTo && assignment.validTo < now) return false;
  return true;
}

/**
 * Does an assignment cover the target?
 *
 * An organisation-wide assignment covers everything. A company-scoped
 * assignment covers every branch in that company. A branch-scoped assignment
 * covers only that branch.
 */
export function assignmentCovers(assignment: RoleAssignment, target: ScopeTarget): boolean {
  if (assignment.companyId === null && assignment.branchId === null) return true;

  if (assignment.branchId !== null) {
    return assignment.branchId === target.branchId;
  }

  if (assignment.companyId !== null) {
    // Company-scoped covers any branch within that company. The caller must
    // supply companyId for a branch-level target, which `withAction()` does.
    return assignment.companyId === target.companyId;
  }

  return false;
}

export function activeAssignments(actor: Actor, target: ScopeTarget, now = new Date()): RoleAssignment[] {
  return actor.assignments.filter(
    (a) => isAssignmentActive(a, now) && assignmentCovers(a, target),
  );
}

/** Every permission the actor holds at the target scope. */
export function permissionsFor(actor: Actor, target: ScopeTarget, now = new Date()): Set<Permission> {
  const permissions = new Set<Permission>();

  for (const assignment of activeAssignments(actor, target, now)) {
    for (const permission of ROLE_PERMISSIONS[assignment.role]) {
      permissions.add(permission);
    }
  }
  return permissions;
}

export function can(
  actor: Actor,
  permission: Permission,
  target: ScopeTarget = {},
  now = new Date(),
): boolean {
  return permissionsFor(actor, target, now).has(permission);
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

/**
 * Branches the actor may currently act at, for the branch switcher.
 * `allBranches` is supplied by the caller — this module does no I/O.
 */
export function accessibleBranches(
  actor: Actor,
  allBranches: { id: string; companyId: string }[],
  now = new Date(),
): string[] {
  return allBranches
    .filter((branch) =>
      activeAssignments(actor, { companyId: branch.companyId, branchId: branch.id }, now).length > 0,
    )
    .map((b) => b.id);
}

/**
 * Highest role held anywhere, for display only. Never use this for an
 * authorisation decision — a group-wide job title says nothing about what
 * someone may do at a particular branch.
 */
export function displayRole(actor: Actor, now = new Date()): Role | null {
  const order: Role[] = ['OWNER', 'ADMIN', 'PHARMACIST', 'TECHNICIAN', 'RECEPTION', 'READ_ONLY'];
  const held = actor.assignments.filter((a) => isAssignmentActive(a, now)).map((a) => a.role);
  return order.find((role) => held.includes(role)) ?? null;
}
