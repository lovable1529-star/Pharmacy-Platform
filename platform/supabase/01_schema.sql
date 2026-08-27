-- ═══════════════════════════════════════════════════════════
-- 01 · Tables
-- Karsons Pharmacy platform
-- ═══════════════════════════════════════════════════════════
-- Creates the 21 tables: four-level tenancy, patients, services, form and
-- ruleset versions, submissions, consultations, stock, and the audit log.
-- 
-- Run this first. It is safe on an empty database and will fail loudly if
-- objects already exist, rather than half-applying.
CREATE TYPE "public"."consultation_status" AS ENUM('BOOKED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'DID_NOT_ATTEND', 'CANCELLED');

CREATE TYPE "public"."outcome" AS ENUM('GREEN', 'AMBER', 'RED');

CREATE TYPE "public"."role" AS ENUM('OWNER', 'ADMIN', 'PHARMACIST', 'TECHNICIAN', 'RECEPTION', 'READ_ONLY');

CREATE TYPE "public"."service_kind" AS ENUM('VACCINATION', 'REPEAT_SUPPLY', 'CONSULTATION');

CREATE TYPE "public"."submission_status" AS ENUM('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'COMPLETED');

CREATE TABLE "allergy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"substance" text NOT NULL,
	"reaction" text,
	"severity" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid,
	"branch_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"previous_hash" text,
	"hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"expiry_date" date NOT NULL,
	"recalled_at" timestamp with time zone,
	"recall_reason" text
);


CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address_line1" text,
	"town" text,
	"postcode" text,
	"phone" text,
	"inbox_email" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "clinician" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"gphc_number" text NOT NULL,
	"signature_url" text,
	"archived_at" timestamp with time zone
);


CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trading_name" text,
	"gphc_number" text,
	"address_line1" text,
	"address_line2" text,
	"town" text,
	"postcode" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "consultation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"submission_id" uuid,
	"clinician_id" uuid,
	"status" "consultation_status" DEFAULT 'BOOKED' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"clinical_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"batch_id" uuid,
	"identity_verified" boolean DEFAULT false NOT NULL,
	"declarations_accepted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "form_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "gp_surgery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"archived_at" timestamp with time zone
);


CREATE TABLE "organisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_slug_unique" UNIQUE("slug")
);


CREATE TABLE "patient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" text,
	"gender_self_described" text,
	"email" text,
	"phone" text,
	"address_line1" text,
	"town" text,
	"postcode" text,
	"gp_surgery_id" uuid,
	"registered_branch_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp with time zone
);


CREATE TABLE "review_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "role_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"company_id" uuid,
	"branch_id" uuid,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "rule_evaluation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"ruleset_version_id" uuid NOT NULL,
	"outcome" "outcome" NOT NULL,
	"deciding_rule_id" text,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"advice" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "ruleset_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "service_kind" NOT NULL,
	"description" text,
	"price_minor" integer,
	"branch_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_form_version_id" uuid,
	"published_ruleset_version_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "stock_level" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"patient_id" uuid,
	"branch_id" uuid,
	"status" "submission_status" DEFAULT 'DRAFT' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"derived" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_version" text,
	"signature_url" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE "allergy" ADD CONSTRAINT "allergy_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "allergy" ADD CONSTRAINT "allergy_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "app_user" ADD CONSTRAINT "app_user_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "batch" ADD CONSTRAINT "batch_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "batch" ADD CONSTRAINT "batch_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "branch" ADD CONSTRAINT "branch_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "branch" ADD CONSTRAINT "branch_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "clinician" ADD CONSTRAINT "clinician_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "clinician" ADD CONSTRAINT "clinician_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "company" ADD CONSTRAINT "company_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultation" ADD CONSTRAINT "consultation_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultation" ADD CONSTRAINT "consultation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultation" ADD CONSTRAINT "consultation_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultation" ADD CONSTRAINT "consultation_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultation" ADD CONSTRAINT "consultation_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultation" ADD CONSTRAINT "consultation_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultation" ADD CONSTRAINT "consultation_clinician_id_clinician_id_fk" FOREIGN KEY ("clinician_id") REFERENCES "public"."clinician"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultation" ADD CONSTRAINT "consultation_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "form_version" ADD CONSTRAINT "form_version_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "form_version" ADD CONSTRAINT "form_version_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "form_version" ADD CONSTRAINT "form_version_published_by_app_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "gp_surgery" ADD CONSTRAINT "gp_surgery_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "patient" ADD CONSTRAINT "patient_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "patient" ADD CONSTRAINT "patient_gp_surgery_id_gp_surgery_id_fk" FOREIGN KEY ("gp_surgery_id") REFERENCES "public"."gp_surgery"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "patient" ADD CONSTRAINT "patient_registered_branch_id_branch_id_fk" FOREIGN KEY ("registered_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "product" ADD CONSTRAINT "product_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "review_event" ADD CONSTRAINT "review_event_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "review_event" ADD CONSTRAINT "review_event_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "review_event" ADD CONSTRAINT "review_event_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "rule_evaluation" ADD CONSTRAINT "rule_evaluation_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "rule_evaluation" ADD CONSTRAINT "rule_evaluation_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "rule_evaluation" ADD CONSTRAINT "rule_evaluation_ruleset_version_id_ruleset_version_id_fk" FOREIGN KEY ("ruleset_version_id") REFERENCES "public"."ruleset_version"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "ruleset_version" ADD CONSTRAINT "ruleset_version_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "ruleset_version" ADD CONSTRAINT "ruleset_version_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "ruleset_version" ADD CONSTRAINT "ruleset_version_published_by_app_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "service" ADD CONSTRAINT "service_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "submission" ADD CONSTRAINT "submission_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "submission" ADD CONSTRAINT "submission_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "submission" ADD CONSTRAINT "submission_form_version_id_form_version_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_version"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "submission" ADD CONSTRAINT "submission_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "submission" ADD CONSTRAINT "submission_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "allergy_patient_idx" ON "allergy" USING btree ("patient_id");

CREATE UNIQUE INDEX "app_user_email_idx" ON "app_user" USING btree ("organisation_id","email");

CREATE INDEX "audit_event_org_idx" ON "audit_event" USING btree ("organisation_id","occurred_at");

CREATE INDEX "batch_product_idx" ON "batch" USING btree ("product_id");

CREATE INDEX "branch_org_idx" ON "branch" USING btree ("organisation_id");

CREATE INDEX "branch_company_idx" ON "branch" USING btree ("company_id");

CREATE INDEX "clinician_org_idx" ON "clinician" USING btree ("organisation_id");

CREATE INDEX "company_org_idx" ON "company" USING btree ("organisation_id");

CREATE INDEX "consultation_branch_idx" ON "consultation" USING btree ("branch_id","scheduled_for");

CREATE INDEX "consultation_patient_idx" ON "consultation" USING btree ("patient_id");

CREATE UNIQUE INDEX "form_version_idx" ON "form_version" USING btree ("service_id","version");

CREATE INDEX "gp_surgery_org_idx" ON "gp_surgery" USING btree ("organisation_id");

CREATE INDEX "patient_org_idx" ON "patient" USING btree ("organisation_id");

CREATE INDEX "patient_name_idx" ON "patient" USING btree ("organisation_id","last_name","first_name");

CREATE INDEX "patient_dob_idx" ON "patient" USING btree ("organisation_id","date_of_birth");

CREATE INDEX "product_org_idx" ON "product" USING btree ("organisation_id");

CREATE INDEX "review_event_submission_idx" ON "review_event" USING btree ("submission_id");

CREATE INDEX "role_assignment_user_idx" ON "role_assignment" USING btree ("user_id");

CREATE INDEX "rule_evaluation_submission_idx" ON "rule_evaluation" USING btree ("submission_id");

CREATE UNIQUE INDEX "ruleset_version_idx" ON "ruleset_version" USING btree ("service_id","version");

CREATE UNIQUE INDEX "service_slug_idx" ON "service" USING btree ("organisation_id","slug");

CREATE UNIQUE INDEX "stock_level_branch_batch_idx" ON "stock_level" USING btree ("branch_id","batch_id");

CREATE INDEX "stock_movement_batch_idx" ON "stock_movement" USING btree ("batch_id");

CREATE INDEX "submission_org_idx" ON "submission" USING btree ("organisation_id");

CREATE INDEX "submission_patient_idx" ON "submission" USING btree ("patient_id");

CREATE INDEX "submission_status_idx" ON "submission" USING btree ("organisation_id","status");
