/**
 * Database schema — Karsons Pharmacy platform.
 *
 * Tenancy is four levels, and what lives at each level is the whole design:
 *
 *   Organisation   Karsons Pharmacy Group — owns patients, services, reference data
 *     └── Company  a legal entity — own GPhC premises registration, own contracts
 *           └── Branch    a physical site — address, stock, appointments, inbox
 *                 └── Resource   a consultation room, clinician or tablet
 *
 * Rules that fall out of that, enforced throughout:
 *
 *   1. Patients belong to the ORGANISATION, never a branch. A patient attending
 *      either site must be found instantly. This is what the legacy system made
 *      structurally impossible by modelling branches as separate tenants.
 *   2. Stock belongs to the BRANCH. Decrementing the wrong site is a real error.
 *   3. A prescription carries both — the Company as legal issuer, the Branch as
 *      collection point.
 *   4. No hard deletes on clinical data. Version it, or set archivedAt.
 *   5. Every clinical table carries organisationId so row-level security has
 *      something to filter on.
 */

import {
  pgTable, pgEnum, uuid, text, timestamp, jsonb, integer,
  boolean, date, index, uniqueIndex, primaryKey,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────

export const outcomeEnum = pgEnum('outcome', ['GREEN', 'AMBER', 'RED']);

export const submissionStatusEnum = pgEnum('submission_status', [
  'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'COMPLETED',
]);

export const consultationStatusEnum = pgEnum('consultation_status', [
  'BOOKED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'DID_NOT_ATTEND', 'CANCELLED',
]);

export const serviceKindEnum = pgEnum('service_kind', [
  'VACCINATION', 'REPEAT_SUPPLY', 'CONSULTATION',
]);

// ─────────────────────────────────────────────────────────────
// TENANCY
// ─────────────────────────────────────────────────────────────

export const organisation = pgTable('organisation', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /** Cascading defaults: branding, consent text, retention periods. */
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const company = pgTable('company', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  name: text('name').notNull(),
  /** Trading name where it differs — Kirk Michael may trade as Village Pharmacy. */
  tradingName: text('trading_name'),
  /** GPhC premises registration for this legal entity. Prints on prescriptions. */
  gphcNumber: text('gphc_number'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  town: text('town'),
  postcode: text('postcode'),
  /** Overrides organisation.settings. */
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('company_org_idx').on(t.organisationId)]);

export const branch = pgTable('branch', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  companyId: uuid('company_id').notNull().references(() => company.id),
  name: text('name').notNull(),
  /** Short code shown in the branch switcher and on prescription numbers. */
  code: text('code').notNull(),
  addressLine1: text('address_line1'),
  town: text('town'),
  postcode: text('postcode'),
  phone: text('phone'),
  /** Where approved prescriptions for this site are delivered. */
  inboxEmail: text('inbox_email'),
  /** Overrides company.settings. */
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('branch_org_idx').on(t.organisationId),
  index('branch_company_idx').on(t.companyId),
]);

// ─────────────────────────────────────────────────────────────
// IDENTITY & ACCESS
// ─────────────────────────────────────────────────────────────

export const appUser = pgTable('app_user', {
  /** Mirrors auth.users.id from Supabase Auth. */
  id: uuid('id').primaryKey(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  /**
   * Accounts are DISABLED, never deleted. Historical consultations, audit
   * entries and prescriptions all reference their author, and those references
   * must stay valid. A disabled user is treated as having NO permissions at
   * all, enforced in has_perm() rather than only in the interface — so
   * disabling cuts off access even with a still-valid session token.
   */
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  disabledBy: uuid('disabled_by'),
  disabledReason: text('disabled_reason'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('app_user_email_idx').on(t.organisationId, t.email)]);

/**
 * A role: a name plus a grid of permissions, editable by an administrator.
 *
 * System roles (Admin, Viewer) cannot be deleted, renamed, or have their
 * is_system flag cleared. That is enforced by a database trigger, so the
 * protection survives a direct API call rather than living only in the UI.
 */
export const role = pgTable('role', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('role_name_idx').on(t.organisationId, t.name)]);

/**
 * One cell of a role's permission grid.
 *
 * module and action are constrained to the vocabulary in
 * src/lib/tenancy/permissions.ts by a CHECK constraint, so a typo becomes a
 * failed insert rather than a permission that silently never matches.
 */
export const rolePermission = pgTable('role_permission', {
  roleId: uuid('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
  module: text('module').notNull(),
  action: text('action').notNull(),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.module, t.action] }),
  index('role_permission_role_idx').on(t.roleId),
]);

/**
 * Which role a user holds, WHERE, and WHEN.
 *
 * This is the dimension a plain RBAC model does not have and Karsons needs: the
 * grid says what the role may do; this says at which branch, and between which
 * dates. Null company AND null branch means organisation-wide.
 *
 * A locum holds Pharmacist at Kirk Michael from the 8th to the 22nd, and their
 * access lapses on its own without anyone remembering to remove it.
 */
export const roleAssignment = pgTable('role_assignment', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  userId: uuid('user_id').notNull().references(() => appUser.id),
  roleId: uuid('role_id').notNull().references(() => role.id),
  companyId: uuid('company_id').references(() => company.id),
  branchId: uuid('branch_id').references(() => branch.id),
  validFrom: timestamp('valid_from', { withTimezone: true }).defaultNow().notNull(),
  /** Null means it does not expire. */
  validTo: timestamp('valid_to', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('role_assignment_user_idx').on(t.userId),
  index('role_assignment_role_idx').on(t.roleId),
]);

// ─────────────────────────────────────────────────────────────
// REFERENCE DATA — all editable by the client, no code required
// ─────────────────────────────────────────────────────────────

/** GP surgeries. Selecting one silently attaches its prescription mailbox. */
export const gpSurgery = pgTable('gp_surgery', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  name: text('name').notNull(),
  email: text('email').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => [index('gp_surgery_org_idx').on(t.organisationId)]);

/** Registered pharmacists. Selecting one auto-fills their GPhC number. */
export const clinician = pgTable('clinician', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  /** Links to a login where the clinician also uses the system. */
  userId: uuid('user_id').references(() => appUser.id),
  fullName: text('full_name').notNull(),
  gphcNumber: text('gphc_number').notNull(),
  signatureUrl: text('signature_url'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => [index('clinician_org_idx').on(t.organisationId)]);

/** A vaccine or medicine. */
export const product = pgTable('product', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  name: text('name').notNull(),
  category: text('category'),
  /** Allergens carried by this product — drives the safety check. */
  allergens: jsonb('allergens').$type<string[]>().default([]).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
}, (t) => [index('product_org_idx').on(t.organisationId)]);

/** Selecting a batch auto-fills its number and expiry onto the record. */
export const batch = pgTable('batch', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  productId: uuid('product_id').notNull().references(() => product.id),
  batchNumber: text('batch_number').notNull(),
  expiryDate: date('expiry_date').notNull(),
  recalledAt: timestamp('recalled_at', { withTimezone: true }),
  recallReason: text('recall_reason'),
}, (t) => [index('batch_product_idx').on(t.productId)]);

/**
 * Stock is a cached projection of stock_movement. The movements are the truth;
 * this exists so reads are fast. Drift between the two is detectable.
 */
export const stockLevel = pgTable('stock_level', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  branchId: uuid('branch_id').notNull().references(() => branch.id),
  batchId: uuid('batch_id').notNull().references(() => batch.id),
  quantity: integer('quantity').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('stock_level_branch_batch_idx').on(t.branchId, t.batchId)]);

export const stockMovement = pgTable('stock_movement', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  branchId: uuid('branch_id').notNull().references(() => branch.id),
  batchId: uuid('batch_id').notNull().references(() => batch.id),
  /** RECEIPT | ADMINISTRATION | ADJUSTMENT | WASTE | TRANSFER_IN | TRANSFER_OUT */
  kind: text('kind').notNull(),
  quantity: integer('quantity').notNull(),
  reason: text('reason'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('stock_movement_batch_idx').on(t.batchId)]);

// ─────────────────────────────────────────────────────────────
// PATIENTS — organisation-scoped, findable at any branch
// ─────────────────────────────────────────────────────────────

export const patient = pgTable('patient', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  dateOfBirth: date('date_of_birth').notNull(),
  /** Free text so modern designations are supported, per his feedback. */
  gender: text('gender'),
  genderSelfDescribed: text('gender_self_described'),
  email: text('email'),
  phone: text('phone'),
  addressLine1: text('address_line1'),
  town: text('town'),
  postcode: text('postcode'),
  gpSurgeryId: uuid('gp_surgery_id').references(() => gpSurgery.id),
  /** Branch where the record was created — for reporting only, never for access. */
  registeredBranchId: uuid('registered_branch_id').references(() => branch.id),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('patient_org_idx').on(t.organisationId),
  index('patient_name_idx').on(t.organisationId, t.lastName, t.firstName),
  index('patient_dob_idx').on(t.organisationId, t.dateOfBirth),
]);

export const allergy = pgTable('allergy', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  patientId: uuid('patient_id').notNull().references(() => patient.id),
  substance: text('substance').notNull(),
  reaction: text('reaction'),
  severity: text('severity'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('allergy_patient_idx').on(t.patientId)]);

// ─────────────────────────────────────────────────────────────
// SERVICES, FORMS AND RULES — the configurable core
// ─────────────────────────────────────────────────────────────

export const service = pgTable('service', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  kind: serviceKindEnum('kind').notNull(),
  description: text('description'),
  /** Integer pence. Never floats. */
  priceMinor: integer('price_minor'),
  /** Which branches offer it. Empty means all. */
  branchIds: jsonb('branch_ids').$type<string[]>().default([]).notNull(),
  publishedFormVersionId: uuid('published_form_version_id'),
  publishedRulesetVersionId: uuid('published_ruleset_version_id'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('service_slug_idx').on(t.organisationId, t.slug)]);

/**
 * A published form version is IMMUTABLE. Editing creates a new version, so a
 * form edited next year never changes what a patient answered last year.
 */
export const formVersion = pgTable('form_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  serviceId: uuid('service_id').notNull().references(() => service.id),
  version: integer('version').notNull(),
  /** The FormSchema emitted by the Service Designer. */
  schema: jsonb('schema').$type<Record<string, unknown>>().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by').references(() => appUser.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('form_version_idx').on(t.serviceId, t.version)]);

export const rulesetVersion = pgTable('ruleset_version', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  serviceId: uuid('service_id').notNull().references(() => service.id),
  version: integer('version').notNull(),
  /** The RulesetDefinition emitted by the rule builder. */
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by').references(() => appUser.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('ruleset_version_idx').on(t.serviceId, t.version)]);

/** A completed form, permanently bound to the version it was answered against. */
export const submission = pgTable('submission', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  serviceId: uuid('service_id').notNull().references(() => service.id),
  formVersionId: uuid('form_version_id').notNull().references(() => formVersion.id),
  patientId: uuid('patient_id').references(() => patient.id),
  /** Branch the patient chose, or where the tablet was. */
  branchId: uuid('branch_id').references(() => branch.id),
  status: submissionStatusEnum('status').default('DRAFT').notNull(),
  answers: jsonb('answers').$type<Record<string, unknown>>().default({}).notNull(),
  /** Values computed from answers — BMI, age, weeks on dose. */
  derived: jsonb('derived').$type<Record<string, unknown>>().default({}).notNull(),
  /** Exact consent wording agreed to, captured at submit time. */
  consentVersion: text('consent_version'),
  signatureUrl: text('signature_url'),
  /**
   * Lets a patient return to a half-finished questionnaire.
   *
   * A health form has no account behind it, so this token IS the credential —
   * it is 32 random bytes, never sequential, and grants access to exactly one
   * submission. Someone holding it can finish that one form and nothing else.
   */
  resumeToken: text('resume_token'),
  resumeExpiresAt: timestamp('resume_expires_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('submission_org_idx').on(t.organisationId),
  index('submission_patient_idx').on(t.patientId),
  index('submission_status_idx').on(t.organisationId, t.status),
]);

/** The triage result, with the full trace of how it was reached. */
export const ruleEvaluation = pgTable('rule_evaluation', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  submissionId: uuid('submission_id').notNull().references(() => submission.id),
  rulesetVersionId: uuid('ruleset_version_id').notNull().references(() => rulesetVersion.id),
  outcome: outcomeEnum('outcome').notNull(),
  decidingRuleId: text('deciding_rule_id'),
  /** Every rule considered, whether it fired, and why not. Stored for audit. */
  trace: jsonb('trace').$type<unknown[]>().default([]).notNull(),
  advice: jsonb('advice').$type<string[]>().default([]).notNull(),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('rule_evaluation_submission_idx').on(t.submissionId)]);

// ─────────────────────────────────────────────────────────────
// CONSULTATIONS
// ─────────────────────────────────────────────────────────────

export const consultation = pgTable('consultation', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  companyId: uuid('company_id').notNull().references(() => company.id),
  branchId: uuid('branch_id').notNull().references(() => branch.id),
  patientId: uuid('patient_id').notNull().references(() => patient.id),
  serviceId: uuid('service_id').notNull().references(() => service.id),
  submissionId: uuid('submission_id').references(() => submission.id),
  clinicianId: uuid('clinician_id').references(() => clinician.id),
  status: consultationStatusEnum('status').default('BOOKED').notNull(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  /** Clinician-completed fields — site of administration, NHS/paid, notes. */
  clinicalData: jsonb('clinical_data').$type<Record<string, unknown>>().default({}).notNull(),
  batchId: uuid('batch_id').references(() => batch.id),
  identityVerified: boolean('identity_verified').default(false).notNull(),
  declarationsAccepted: jsonb('declarations_accepted').$type<string[]>().default([]).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('consultation_branch_idx').on(t.branchId, t.scheduledFor),
  index('consultation_patient_idx').on(t.patientId),
]);

/** Discrete, attributable review events — never one accumulating text blob. */
export const reviewEvent = pgTable('review_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  submissionId: uuid('submission_id').notNull().references(() => submission.id),
  userId: uuid('user_id').references(() => appUser.id),
  /** APPROVED | REJECTED | INFO_REQUESTED | NOTE */
  action: text('action').notNull(),
  /** Mandatory when approving an AMBER — he requires the reasoning documented. */
  note: text('note'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('review_event_submission_idx').on(t.submissionId)]);

// ─────────────────────────────────────────────────────────────
// AUDIT — append-only, hash-chained
// ─────────────────────────────────────────────────────────────

export const auditEvent = pgTable('audit_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  userId: uuid('user_id').references(() => appUser.id),
  /** Which branch the action was performed at — required for GDPR access logs. */
  branchId: uuid('branch_id').references(() => branch.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  /** Hash of the preceding entry for this organisation. Tamper-evident. */
  previousHash: text('previous_hash'),
  hash: text('hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('audit_event_org_idx').on(t.organisationId, t.occurredAt)]);

// ─────────────────────────────────────────────────────────────
// SCHEDULING
// ─────────────────────────────────────────────────────────────

/**
 * A recurring window in which a branch offers appointments.
 *
 * Stored as weekday plus minutes-from-midnight rather than timestamps, because
 * "Tuesdays, 9am to 5pm" is the thing the pharmacy actually decides. Concrete
 * slots are generated from these on demand — materialising every future slot as
 * a row means a table that grows forever and needs regenerating whenever hours
 * change.
 *
 * A null serviceId means the window is open to every service, which is the
 * normal case: his GLP-1 document requires repeat-care appointments to share
 * the vaccination calendar, so per-service calendars were never an option.
 */
export const availability = pgTable('availability', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  branchId: uuid('branch_id').notNull().references(() => branch.id),
  serviceId: uuid('service_id').references(() => service.id),
  /** 0 = Sunday, matching JavaScript's getDay(). */
  weekday: integer('weekday').notNull(),
  /** Minutes from midnight, local time. 540 = 09:00. */
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  slotMinutes: integer('slot_minutes').default(15).notNull(),
  /** How many patients can be seen in the same slot. */
  capacity: integer('capacity').default(1).notNull(),
  effectiveFrom: date('effective_from'),
  effectiveTo: date('effective_to'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('availability_branch_idx').on(t.branchId, t.weekday)]);

export const appointmentStatusEnum = pgEnum('appointment_status', [
  'BOOKED', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'DID_NOT_ATTEND',
]);

/**
 * A booked slot.
 *
 * Deliberately separate from `consultation`, and deliberately allows a null
 * patientId: somebody booking from the website at 11pm does not have a patient
 * record yet, and forcing one to exist would mean creating half-populated
 * records for appointments that may never be attended.
 *
 * The record is created when they arrive; the appointment links to it then.
 */
export const appointment = pgTable('appointment', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  companyId: uuid('company_id').notNull().references(() => company.id),
  branchId: uuid('branch_id').notNull().references(() => branch.id),
  serviceId: uuid('service_id').notNull().references(() => service.id),
  patientId: uuid('patient_id').references(() => patient.id),
  submissionId: uuid('submission_id').references(() => submission.id),
  consultationId: uuid('consultation_id').references(() => consultation.id),
  status: appointmentStatusEnum('status').default('BOOKED').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  /** Captured at booking, before any patient record exists. */
  bookedName: text('booked_name').notNull(),
  bookedEmail: text('booked_email'),
  bookedPhone: text('booked_phone'),
  /** Short human reference, quoted in confirmation emails. */
  reference: text('reference').notNull(),
  notes: text('notes'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('appointment_branch_start_idx').on(t.branchId, t.startsAt),
  index('appointment_org_idx').on(t.organisationId, t.startsAt),
  uniqueIndex('appointment_reference_idx').on(t.organisationId, t.reference),
]);
