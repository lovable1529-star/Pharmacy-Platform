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
  boolean, date, numeric, index, uniqueIndex, primaryKey,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────

export const outcomeEnum = pgEnum('outcome', ['GREEN', 'AMBER', 'RED']);

export const submissionStatusEnum = pgEnum('submission_status', [
  'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'COMPLETED',
  // Added for the specification's state machine: a rejected case that has been
  // corrected comes back as RESUBMITTED carrying its rejection, and a case can
  // be stopped outright without pretending it was rejected on clinical grounds.
  'RESUBMITTED', 'CANCELLED',
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
  /** §12's practice master: a practice is a place, not just a mailbox. */
  practiceCode: text('practice_code'),
  phone: text('phone'),
  address: text('address'),
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
  /**
   * Allocated once, by the database, and permanent thereafter.
   *
   * Was derived from digits in the consultation UUID, which collided. A
   * prescription number is how a supply is referred to afterwards — on a query,
   * a recall, an audit — so two supplies sharing one is a real problem.
   */
  prescriptionNumber: text('prescription_number'),
  /** When the GP practice was last told. Null means they have not been. */
  gpNotifiedAt: timestamp('gp_notified_at', { withTimezone: true }),
  /** Sends so far — a resend after a correction is a second send, not a first. */
  gpNotifyCount: integer('gp_notify_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('consultation_branch_idx').on(t.branchId, t.scheduledFor),
  index('consultation_patient_idx').on(t.patientId),
]);

/**
 * A correction to a consultation that is already complete.
 *
 * Appended, never applied in place. The answers behind an administered vaccine
 * are the justification for having administered it, so editing them afterwards
 * rewrites history — but "we recorded the wrong batch and noticed an hour
 * later" is a real event, and a recall list built from a wrong batch number is
 * dangerous. Both the original and the correction stand, which is how clinical
 * amendment works on paper.
 */
export const consultationAddendum = pgTable('consultation_addendum', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  consultationId: uuid('consultation_id').notNull().references(() => consultation.id),
  userId: uuid('user_id').references(() => appUser.id),
  reason: text('reason').notNull(),
  corrections: jsonb('corrections').$type<Record<string, unknown>>().default({}).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('consultation_addendum_idx').on(t.consultationId, t.occurredAt)]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'PENDING', 'PAID', 'CANCELLED', 'REFUNDED',
]);

/**
 * DEMO is a first-class provider rather than a flag.
 *
 * Keeping it in the enum means a demonstration payment can never be quietly
 * counted as a real one in a report or a reconciliation — the distinction
 * survives every query, rather than depending on somebody remembering a
 * boolean.
 */
export const paymentProviderEnum = pgEnum('payment_provider', [
  'DEMO', 'STRIPE', 'IN_PERSON',
]);

/**
 * A request for money.
 *
 * His GLP-1 flow is payment-gated: "GREEN/approved AMBER → secure payment link
 * sent. Rx generated after payment." The prescription is issued on the
 * transition to PAID, whichever provider reports it.
 */
export const payment = pgTable('payment', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  submissionId: uuid('submission_id').references(() => submission.id),
  patientId: uuid('patient_id').references(() => patient.id),
  branchId: uuid('branch_id').references(() => branch.id),
  /** Integer pence. Never floats — 0.1 + 0.2 has no place near money. */
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').default('GBP').notNull(),
  description: text('description').notNull(),
  status: paymentStatusEnum('status').default('PENDING').notNull(),
  provider: paymentProviderEnum('provider').default('DEMO').notNull(),
  providerRef: text('provider_ref'),
  /**
   * The unguessable half of the payment link. Same reasoning as the resume
   * token: the patient has no account, so the link IS the credential and must
   * not be derivable from anything printed on a receipt.
   */
  accessToken: text('access_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('payment_token_idx').on(t.accessToken),
  index('payment_submission_idx').on(t.submissionId),
  index('payment_org_status_idx').on(t.organisationId, t.status),
]);

export const repeatEnrolmentStatusEnum = pgEnum('repeat_enrolment_status', [
  'ACTIVE', 'PAUSED', 'STOPPED',
]);

/**
 * A patient authorised into Repeat Care.
 *
 * His GLP-1 workflow begins with a pharmacist enrolling someone and creating a
 * baseline, and the system had no such step. Two things depend on it:
 *
 *   · The rules are relative. "Weight loss of at least 2% since last supply",
 *     "three weeks on the current dose", "no skipping strengths" — none of them
 *     can be evaluated without a known starting point and a known current dose.
 *   · It is the safety gate. His first rule is that a patient not in the Repeat
 *     Care database is sent to book an appointment rather than served, which is
 *     what stops someone never assessed requesting a GLP-1 online.
 */
export const repeatEnrolment = pgTable('repeat_enrolment', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  patientId: uuid('patient_id').notNull().references(() => patient.id),
  serviceId: uuid('service_id').notNull().references(() => service.id),
  status: repeatEnrolmentStatusEnum('status').default('ACTIVE').notNull(),
  /** Their id in Pharmadoctor, which is how he identifies these patients. */
  externalRef: text('external_ref'),
  heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
  startingWeightKg: numeric('starting_weight_kg', { precision: 5, scale: 1 }),
  startingWaistCm: numeric('starting_waist_cm', { precision: 5, scale: 1 }),
  medicine: text('medicine'),
  strength: text('strength'),
  /** When the CURRENT strength started — the 3-week and 6-week rules. */
  strengthSince: date('strength_since'),
  lastSuppliedAt: timestamp('last_supplied_at', { withTimezone: true }),
  lastWeightKg: numeric('last_weight_kg', { precision: 5, scale: 1 }),
  notes: text('notes'),
  enrolledBy: uuid('enrolled_by').references(() => appUser.id),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('repeat_enrolment_unique_idx').on(t.patientId, t.serviceId),
  index('repeat_enrolment_org_idx').on(t.organisationId, t.status),
]);

export const notificationChannelEnum = pgEnum('notification_channel', [
  'EMAIL', 'SMS', 'WHATSAPP',
]);

export const notificationStatusEnum = pgEnum('notification_status', [
  'QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNAVAILABLE',
]);

/**
 * Outbox for anything the system sends.
 *
 * Email goes out through Resend today; his briefs also ask for WhatsApp alerts
 * to the pharmacist and SMS reminders to patients, neither of which has
 * credentials yet. Queueing everything here first means adding Twilio later is
 * one adapter rather than rewiring every call site — and until it exists,
 * messages for those channels queue as UNAVAILABLE rather than vanishing.
 */
export const notification = pgTable('notification', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  channel: notificationChannelEnum('channel').notNull(),
  /** Email address or E.164 number, depending on the channel. */
  recipient: text('recipient').notNull(),
  template: text('template').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  status: notificationStatusEnum('status').default('QUEUED').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastError: text('last_error'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('notification_due_idx').on(t.scheduledFor),
  index('notification_entity_idx').on(t.entityType, t.entityId),
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
  /** When they actually walked in. Status said THAT they had, never WHEN. */
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  /** Recorded here, not inferred from the mail log, so it sends exactly once. */
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
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

// ─────────────────────────────────────────────────────────────
// Status history
//
// The specification is emphatic that a status must never simply be
// overwritten: "who moved this to rejected, when, and why" has to be
// answerable, and rejection reasons, pharmacist decisions and signatures are
// listed among the things that must not be silently replaced.
//
// Until now every status lived in one column and each write destroyed the
// previous value. The audit log recorded that something changed, but the
// clinical question — what path did this case take — could only be
// reconstructed by inference.
//
// One table for every entity that has a lifecycle, rather than one per entity,
// because the questions asked of it are the same in each case and a rejection
// on an appointment reads exactly like a rejection on a submission.
// ─────────────────────────────────────────────────────────────

export const statusEntityEnum = pgEnum('status_entity', [
  'SUBMISSION', 'APPOINTMENT', 'CONSULTATION', 'PRESCRIPTION',
]);

export const statusHistory = pgTable('status_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  entityType: statusEntityEnum('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  /** Null on the first entry — nothing preceded the record being created. */
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  /**
   * Null where the actor is the patient or the system, both of which are real
   * and neither of which is an `app_user`. `changedByLabel` carries who it was.
   */
  changedBy: uuid('changed_by').references(() => appUser.id),
  changedByLabel: text('changed_by_label').notNull(),
  /** Required by the spec for a rejection; optional elsewhere. */
  reason: text('reason'),
  branchId: uuid('branch_id').references(() => branch.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('status_history_entity_idx').on(t.entityType, t.entityId, t.createdAt),
  index('status_history_org_idx').on(t.organisationId, t.createdAt),
]);

// ─────────────────────────────────────────────────────────────
// Medicine master
//
// §12 requires medicines to be configurable rather than coded: brand, generic
// name, strength, form, service, active. The strengths matter more than the
// list suggests — "only same or ±1 step" is a safety rule, and a step only
// means something against a ladder that knows which strength sits between
// which. So a strength carries a POSITION, and that ordering is the clinical
// content, not presentation.
//
// Held separately from `product`, which is the physical thing on a shelf with
// a batch and an expiry. A medicine is what may be prescribed; a product is
// what is dispensed. Flu vaccines are products; Mounjaro is both, and conflating
// them is how a strength ladder ends up attached to a box.
// ─────────────────────────────────────────────────────────────

export const medicine = pgTable('medicine', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  /** The name a patient recognises — Mounjaro, Wegovy. */
  brand: text('brand').notNull(),
  genericName: text('generic_name'),
  /** Injection, tablet, nasal spray. */
  form: text('form'),
  /** The service this belongs to, where it belongs to only one. */
  serviceId: uuid('service_id').references(() => service.id),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('medicine_org_idx').on(t.organisationId),
  uniqueIndex('medicine_brand_idx').on(t.organisationId, t.brand),
]);

export const medicineStrength = pgTable('medicine_strength', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  medicineId: uuid('medicine_id').notNull().references(() => medicine.id),
  /** As written on the box — "7.5mg". Matched against the answer value. */
  label: text('label').notNull(),
  /**
   * Rung number, ascending. The whole reason this table exists rather than a
   * text array: a step change is the distance between two positions.
   */
  position: integer('position').notNull(),
  active: boolean('active').default(true).notNull(),
}, (t) => [
  index('medicine_strength_medicine_idx').on(t.medicineId, t.position),
  uniqueIndex('medicine_strength_label_idx').on(t.medicineId, t.label),
  uniqueIndex('medicine_strength_position_idx').on(t.medicineId, t.position),
]);

// ─────────────────────────────────────────────────────────────
// Slot configuration — the parts availability could not express
//
// `availability` already carries working days, opening and closing times, slot
// length and maximum appointments per slot. §12 asks for two more, and they are
// genuinely different shapes rather than one flexible table:
//
//   a break recurs      — lunch, every weekday, forever
//   a closure is dated  — Christmas, a training afternoon, one branch only
//
// Collapsing them into a single table with half its columns null depending on
// which kind of row it is would make every query interrogate the row's type
// before it could trust a column.
// ─────────────────────────────────────────────────────────────

export const availabilityBreak = pgTable('availability_break', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  branchId: uuid('branch_id').notNull().references(() => branch.id),
  /** Null applies the break to every service at that branch. */
  serviceId: uuid('service_id').references(() => service.id),
  /** 0 = Sunday, matching `availability`. */
  weekday: integer('weekday').notNull(),
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  label: text('label'),
}, (t) => [index('availability_break_branch_idx').on(t.branchId, t.weekday)]);

export const scheduleClosure = pgTable('schedule_closure', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  /** Null closes every branch — a public holiday. */
  branchId: uuid('branch_id').references(() => branch.id),
  closedOn: date('closed_on').notNull(),
  /** Both null closes the whole day; set, they close part of it. */
  startMinute: integer('start_minute'),
  endMinute: integer('end_minute'),
  reason: text('reason'),
}, (t) => [index('schedule_closure_date_idx').on(t.closedOn, t.branchId)]);

// ─────────────────────────────────────────────────────────────
// Vaccination
//
// Built as a general vaccination engine rather than a flu one, because §28.2
// is explicit that COVID, hepatitis, shingles, varicella and the rest follow
// through the same machinery. Nothing here says "flu".
//
// §29.5's snapshot rule is the important part and it applies to every master
// this record touches: vaccine name, batch number, expiry, pharmacist name and
// registration number are COPIED IN at completion. Editing a master record next
// year must never change what a historical record says happened — a batch
// renumbered in 2027 cannot retroactively alter what went into someone's arm
// in 2026.
// ─────────────────────────────────────────────────────────────

export const injectionTypeEnum = pgEnum('injection_type', [
  'INTRAMUSCULAR', 'SUBCUTANEOUS', 'SUBDERMAL',
]);

export const administrationSiteEnum = pgEnum('administration_site', [
  'RIGHT_DELTOID', 'LEFT_DELTOID', 'RIGHT_THIGH', 'LEFT_THIGH',
  'ORAL', 'NASAL', 'TOPICAL', 'SELF_INJECTION',
]);

export const vaccineAdministration = pgTable('vaccine_administration', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  /** The questionnaire that justified it. */
  submissionId: uuid('submission_id').references(() => submission.id),
  consultationId: uuid('consultation_id').references(() => consultation.id),
  patientId: uuid('patient_id').notNull().references(() => patient.id),
  branchId: uuid('branch_id').notNull().references(() => branch.id),
  clinicianId: uuid('clinician_id').notNull().references(() => clinician.id),
  productId: uuid('product_id').notNull().references(() => product.id),
  batchId: uuid('batch_id').notNull().references(() => batch.id),

  // ── Snapshots, per §29.5 ────────────────────────────────
  clinicianNameSnapshot: text('clinician_name_snapshot').notNull(),
  registrationNumberSnapshot: text('registration_number_snapshot').notNull(),
  vaccineNameSnapshot: text('vaccine_name_snapshot').notNull(),
  batchNumberSnapshot: text('batch_number_snapshot').notNull(),
  expiryDateSnapshot: date('expiry_date_snapshot').notNull(),

  administeredOn: date('administered_on').notNull(),
  /**
   * Null for oral, nasal and topical routes. §27.4 is explicit that an
   * injection type must not be demanded where nothing is injected.
   */
  injectionType: injectionTypeEnum('injection_type'),
  site: administrationSiteEnum('site').notNull(),
  paymentType: text('payment_type'),
  adverseReaction: text('adverse_reaction'),
  notes: text('notes'),
  completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('vaccine_admin_patient_idx').on(t.patientId, t.administeredOn),
  index('vaccine_admin_branch_idx').on(t.branchId, t.administeredOn),
  index('vaccine_admin_batch_idx').on(t.batchId),
  uniqueIndex('vaccine_admin_submission_idx').on(t.submissionId),
]);

/**
 * §26.4 — each declaration stored as its own timestamped confirmation.
 *
 * A row per statement rather than a single boolean, because "the pharmacist
 * confirmed four things" and "the pharmacist ticked a box" are different
 * claims, and only the first survives being asked about later. The wording is
 * snapshotted for the same reason the vaccine name is.
 */
export const clinicianDeclaration = pgTable('clinician_declaration', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  submissionId: uuid('submission_id').references(() => submission.id),
  administrationId: uuid('administration_id').references(() => vaccineAdministration.id),
  clinicianId: uuid('clinician_id').references(() => clinician.id),
  /** Stable key, so reporting survives a rewording. */
  declarationKey: text('declaration_key').notNull(),
  declarationTextSnapshot: text('declaration_text_snapshot').notNull(),
  confirmed: boolean('confirmed').default(true).notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('clinician_declaration_admin_idx').on(t.administrationId),
  index('clinician_declaration_submission_idx').on(t.submissionId),
]);

// ─────────────────────────────────────────────────────────────
// Prescription lifecycle
//
// §8 and §18. A prescription was a PDF generated on demand with a number
// written onto the consultation. The specification treats it as a record with a
// lifecycle: raised, paid for, generated, routed to a branch, dispensed,
// collected — each step with a person and a time against it.
//
// Snapshotted for the same reason the vaccination record is: a price list or a
// medicine name edited next year must not change what a prescription issued
// today says it was for.
// ─────────────────────────────────────────────────────────────

export const prescriptionStatusEnum = pgEnum('prescription_status', [
  'PENDING_PAYMENT', 'ISSUED', 'DISPENSED', 'COLLECTED', 'CANCELLED',
]);

export const prescription = pgTable('prescription', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  submissionId: uuid('submission_id').references(() => submission.id),
  consultationId: uuid('consultation_id').references(() => consultation.id),
  patientId: uuid('patient_id').notNull().references(() => patient.id),
  /** Where the patient chose to collect — §8.5 routes the work by this. */
  branchId: uuid('branch_id').notNull().references(() => branch.id),
  /** The pharmacist who approved it. */
  clinicianId: uuid('clinician_id').references(() => clinician.id),
  medicineId: uuid('medicine_id').references(() => medicine.id),

  /** Human reference. Allocated per branch per year — see migration 14. */
  number: text('number'),
  status: prescriptionStatusEnum('status').default('PENDING_PAYMENT').notNull(),

  // Snapshots
  medicineNameSnapshot: text('medicine_name_snapshot').notNull(),
  strengthSnapshot: text('strength_snapshot'),
  quantity: text('quantity'),
  directions: text('directions'),
  priceMinorSnapshot: integer('price_minor_snapshot'),
  clinicianNameSnapshot: text('clinician_name_snapshot'),
  registrationNumberSnapshot: text('registration_number_snapshot'),
  /** Where the approving signature was captured from, at the moment of issue. */
  signatureSnapshot: text('signature_snapshot'),

  /** §8.1 keeps payment status independent of prescription status. */
  paidOnline: boolean('paid_online').default(false).notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  documentUrl: text('document_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('prescription_patient_idx').on(t.patientId, t.createdAt),
  index('prescription_branch_idx').on(t.branchId, t.status),
  uniqueIndex('prescription_number_idx').on(t.organisationId, t.number),
]);

/** §8.3 — the dispensing pharmacist reviews the consultation and signs off. */
export const dispensingSignoff = pgTable('dispensing_signoff', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  prescriptionId: uuid('prescription_id').notNull().references(() => prescription.id),
  clinicianId: uuid('clinician_id').notNull().references(() => clinician.id),
  clinicianNameSnapshot: text('clinician_name_snapshot').notNull(),
  registrationNumberSnapshot: text('registration_number_snapshot').notNull(),
  /** Whether the question a patient raised was actually put to them. */
  patientSpokenTo: boolean('patient_spoken_to').default(false).notNull(),
  notes: text('notes'),
  signedAt: timestamp('signed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('dispensing_signoff_prescription_idx').on(t.prescriptionId)]);

/** §8.4 — whoever collects prints their name, signs and dates it. */
export const collectionSignoff = pgTable('collection_signoff', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  prescriptionId: uuid('prescription_id').notNull().references(() => prescription.id),
  collectedByName: text('collected_by_name').notNull(),
  /** Not always the patient — a relative may collect. */
  isPatient: boolean('is_patient').default(true).notNull(),
  signatureUrl: text('signature_url'),
  collectedAt: timestamp('collected_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('collection_signoff_prescription_idx').on(t.prescriptionId)]);

// ─────────────────────────────────────────────────────────────
// Documents, consent, GP notifications, urgent work
// ─────────────────────────────────────────────────────────────

export const documentCategoryEnum = pgEnum('document_category', [
  'CONSULTATION_RECORD', 'PRESCRIPTION', 'APPROVAL_RECORD',
  'REJECTION_RECORD', 'PATIENT_EVIDENCE', 'TREATMENT_REVIEW', 'VACCINATION_RECORD',
]);

/**
 * §10 — the register.
 *
 * Files already live in private storage; what did not exist was a list of what
 * has been produced, in what category, for whom. Every row carries the patient
 * so "everything on file for this person" is one query rather than a sweep of
 * the bucket.
 */
export const document = pgTable('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  category: documentCategoryEnum('category').notNull(),
  patientId: uuid('patient_id').references(() => patient.id),
  submissionId: uuid('submission_id').references(() => submission.id),
  consultationId: uuid('consultation_id').references(() => consultation.id),
  prescriptionId: uuid('prescription_id').references(() => prescription.id),
  appointmentId: uuid('appointment_id'),
  title: text('title').notNull(),
  /** Object key in the private bucket. Never a public URL. */
  storagePath: text('storage_path').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  createdBy: uuid('created_by').references(() => appUser.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('document_patient_idx').on(t.patientId, t.createdAt),
  index('document_category_idx').on(t.organisationId, t.category),
]);

/**
 * §8A / §25.6 — consent as a record, not an answer.
 *
 * Consent lived inside the answers, which meant proving what someone agreed to
 * required reading the form version and reconstructing the wording. Stored here
 * with the text itself, so "what exactly did this patient consent to, on this
 * date" is answerable directly.
 */
export const consentRecord = pgTable('consent_record', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  patientId: uuid('patient_id').references(() => patient.id),
  submissionId: uuid('submission_id').references(() => submission.id),
  consentVersion: text('consent_version').notNull(),
  consentTextSnapshot: text('consent_text_snapshot').notNull(),
  accepted: boolean('accepted').default(true).notNull(),
  privacyPolicyVersion: text('privacy_policy_version'),
  privacyAcknowledged: boolean('privacy_acknowledged').default(false).notNull(),
  /** The patient, or the staff member who captured it on their behalf. */
  capturedBy: text('captured_by').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('consent_record_patient_idx').on(t.patientId, t.acceptedAt),
  index('consent_record_submission_idx').on(t.submissionId),
]);

/**
 * §8.6 — one row per notification attempt, with its result.
 *
 * The consultation carried a single `gp_notified_at` column, which can record
 * that something was sent but not that it failed, nor that it was sent twice,
 * nor what happened the second time.
 */
export const gpNotification = pgTable('gp_notification', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  consultationId: uuid('consultation_id').references(() => consultation.id),
  administrationId: uuid('administration_id').references(() => vaccineAdministration.id),
  gpSurgeryId: uuid('gp_surgery_id').references(() => gpSurgery.id),
  /** Where it actually went, even if the surgery address changes later. */
  recipientSnapshot: text('recipient_snapshot').notNull(),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  /** Batched sends group many patients into one message per surgery. */
  batchRef: text('batch_ref'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('gp_notification_consultation_idx').on(t.consultationId),
  index('gp_notification_created_idx').on(t.organisationId, t.createdAt),
]);

/** §6.3 — the RED queue, and the follow-up call it triggers. */
export const urgentTask = pgTable('urgent_task', {
  id: uuid('id').primaryKey().defaultRandom(),
  organisationId: uuid('organisation_id').notNull().references(() => organisation.id),
  submissionId: uuid('submission_id').references(() => submission.id),
  patientId: uuid('patient_id').references(() => patient.id),
  branchId: uuid('branch_id').references(() => branch.id),
  reason: text('reason').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => appUser.id),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('urgent_task_open_idx').on(t.organisationId, t.resolvedAt),
]);
